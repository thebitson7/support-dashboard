from collections import Counter
from decimal import ROUND_HALF_UP, Decimal
from types import SimpleNamespace

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from drf_spectacular.utils import extend_schema_serializer
from rest_framework import serializers

from accounts.models import User
from accounts.serializers import UserRefSerializer
from working_hours.overlaps import (
    CONFIRM_FIELD_HELP,
    PersonCandidate,
    TimeRange,
    person_overlaps,
    require_confirmation,
)
from working_hours.sync import local_span, sync_ticket

from . import audit
from .attention import ROLE_ORDER, Level, closure_lag_minutes
from .models import VERIFICATION_FIELDS, Customer, Site, Ticket, TicketActivity, WorkDoneCode

MAX_PDF_BYTES = 10 * 1024 * 1024


def active_user_field(**kwargs):
    """A user reference by id; deactivated accounts can't be newly assigned anything."""
    return serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True), **kwargs)


def minutes_to_hours(minutes: int) -> Decimal:
    return (Decimal(minutes) / Decimal(60)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# --- Reference data ------------------------------------------------------------
# The ticket form's compact shapes. Lookups has fuller serializers of the same
# models, so these get their own names in the OpenAPI schema.


@extend_schema_serializer(component_name="TicketFormSite")
class SiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Site
        fields = ["id", "name", "ocn"]

    def validate_name(self, value):
        return value.strip()

    def validate_ocn(self, value):
        return value.strip().upper()


@extend_schema_serializer(component_name="TicketFormCustomer")
class CustomerSerializer(serializers.ModelSerializer):
    # Explicit field: the automatic unique validator would compare the raw,
    # case-sensitive input and let "singhealth" in beside "SingHealth".
    name = serializers.CharField(max_length=200)

    class Meta:
        model = Customer
        fields = ["id", "name"]

    def validate_name(self, value):
        value = value.strip()
        clashes = Customer.objects.filter(name__iexact=value)
        if self.instance is not None:
            clashes = clashes.exclude(pk=self.instance.pk)
        if clashes.exists():
            raise serializers.ValidationError("A customer with this name already exists.")
        return value


@extend_schema_serializer(component_name="TicketFormWorkDoneCode")
class WorkDoneCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkDoneCode
        fields = ["id", "code", "description", "is_active"]


# --- List (the AMS Tickets table) ----------------------------------------------


class TicketListSerializer(serializers.ModelSerializer):
    """Exactly what the 11-column tickets table shows, plus `id`."""

    site_name = serializers.CharField(source="site.name")
    site_ocn = serializers.CharField(source="site.ocn")
    status = serializers.CharField()
    cms_closed_by = serializers.CharField(source="cms_closed_by.display_name", default=None)
    created_by = serializers.CharField(source="created_by.display_name")
    total_duration_hours = serializers.FloatField()

    class Meta:
        model = Ticket
        fields = [
            "id",
            "site_name",
            "site_ocn",
            "cms_next_ticket_no",
            "received_at",
            "status",
            "is_pre",
            "cms_closed_by",
            "created_by",
            "total_duration_hours",
            "cms_closed_on",
            "service_closed_date",
        ]
        read_only_fields = fields


# --- Write (create + update) ---------------------------------------------------


class TicketActivityWriteSerializer(serializers.ModelSerializer):
    resolved_by = active_user_field(required=False, allow_null=True)
    # Optional: computed from start/end when omitted; an explicit value wins.
    duration_minutes = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=60 * 24 * 31)

    class Meta:
        model = TicketActivity
        fields = [
            "activity_type",
            "start_at",
            "end_at",
            "duration_minutes",
            "work_done_code",
            "is_likely_cause",
            "resolved_by",
        ]

    def validate(self, attrs):
        if attrs["end_at"] < attrs["start_at"]:
            raise serializers.ValidationError({"end_at": "End must be after the start."})
        if attrs.get("duration_minutes") is None:
            attrs["duration_minutes"] = TicketActivity.minutes_between(attrs["start_at"], attrs["end_at"])
        return attrs


class TicketWriteSerializer(serializers.ModelSerializer):
    """
    Creates or updates a ticket together with its activities, in one
    transaction and under the same rules. `created_by` is not a field here:
    the view sets it from the authenticated user on create, and nothing can
    change it afterwards.

    Activities are replaced as a set: the list sent becomes the ticket's
    activities (on PATCH, omit the key to leave them untouched).

    Overlapping time: an activity with a resolver is that person's time (its
    auto work-log entry). When a new or changed activity would overlap the
    resolver's other logged time, or another activity in the same request for
    the same resolver, the save is refused with 409 unless `confirm_overlaps`
    is true. See _check_overlaps for exactly which activities are checked.
    """

    assigned_to = active_user_field()
    forwarded_to = active_user_field(required=False, allow_null=True)
    cms_added_by = active_user_field(required=False, allow_null=True)
    resolution_verified_by = active_user_field(required=False, allow_null=True)
    cms_closed_by = active_user_field(required=False, allow_null=True)
    activities = TicketActivityWriteSerializer(many=True, required=False)
    confirm_overlaps = serializers.BooleanField(write_only=True, required=False, help_text=CONFIRM_FIELD_HELP)

    class Meta:
        model = Ticket
        fields = [
            "pdf_attachment",
            "received_at",
            "cms_next_ticket_no",
            "site",
            "customer",
            "assigned_to",
            "ticket_type",
            "incoming_channel",
            "is_forwarded",
            "forwarded_to",
            "cms_added_by",
            "cms_added_on",
            "issue_description",
            "possible_root_cause",
            "notes",
            "total_duration_hours",
            "is_pre",
            *VERIFICATION_FIELDS,
            "activities",
            "confirm_overlaps",
        ]
        extra_kwargs = {
            # null = "remove the current attachment" (on update).
            "pdf_attachment": {"allow_null": True},
            "total_duration_hours": {"min_value": Decimal(0)},
            "cms_next_ticket_no": {"trim_whitespace": True},
        }

    def validate_pdf_attachment(self, upload):
        if upload is None:
            return upload
        if upload.size > MAX_PDF_BYTES:
            raise serializers.ValidationError("The PDF must be 10 MB or smaller.")
        # The extension is checked by the model; this checks it really is a PDF.
        header = upload.read(5)
        upload.seek(0)
        if header != b"%PDF-":
            raise serializers.ValidationError("The file isn't a valid PDF.")
        return upload

    def validate(self, attrs):
        # The rules apply to the ticket as it will be once saved: on a partial
        # update, fields that weren't sent keep their stored values.
        def final(field):
            if field in attrs:
                return attrs[field]
            return getattr(self.instance, field, None) if self.instance else None

        errors = {}
        confirmed = attrs.pop("confirm_overlaps", False)

        if final("is_forwarded"):
            if not final("forwarded_to"):
                errors["forwarded_to"] = "Choose who the ticket was forwarded to."
        else:
            # Not forwarded: never keep (or accept) a recipient.
            attrs["forwarded_to"] = None

        # Verification is all-or-nothing: an open ticket leaves every field
        # empty, closing it needs every field. Clearing all five reopens a
        # closed ticket, which is allowed.
        if any(final(f) is not None for f in VERIFICATION_FIELDS):
            for field in VERIFICATION_FIELDS:
                if final(field) is None:
                    errors[field] = "Required to close the ticket."

        if errors:
            raise serializers.ValidationError(errors)

        # The column can't hold NULL; an empty name is how "no file" is stored.
        if "pdf_attachment" in attrs and attrs["pdf_attachment"] is None:
            attrs["pdf_attachment"] = ""

        # Last, so any 400 above wins; and before anything is written, so a
        # 409 leaves the database (work logs and audit log included) untouched.
        self.confirmed_overlaps = 0
        if attrs.get("activities") is not None:
            self.confirmed_overlaps = self._check_overlaps(attrs["activities"], confirmed)
        return attrs

    def _check_overlaps(self, activities: list[dict], confirmed: bool) -> int:
        """
        Which activities are checked: only new or changed ones. An activity
        counts as unchanged when the stored set has one with the same start,
        end and resolver (matched one for one, like the audit's multiset
        diff); a change to its type, code or flags doesn't make it changed.
        Unchanged activities aren't checked against anything, so overlaps
        confirmed earlier don't come back on every later edit, but checked
        ones are still compared with them (same request, same resolver).
        The ticket's stored activities and their auto entries are being
        replaced, so they're never "other" time.

        Each activity is compared as its would-be auto entry, exactly as
        working_hours.sync cuts it: in the resolver's zone, clipped at 23:59,
        none under a minute, none without a resolver.
        """
        stored: Counter = Counter()
        if self.instance is not None:
            stored = Counter(self.instance.activities.values_list("start_at", "end_at", "resolved_by_id"))
        candidates, peers = [], []
        for position, activity in enumerate(activities, start=1):
            user = activity.get("resolved_by")
            if user is None:
                continue
            span = SimpleNamespace(start_at=activity["start_at"], end_at=activity["end_at"])
            day, start, end = local_span(span, user.tzinfo)
            if end <= start:
                continue
            item = PersonCandidate(user, TimeRange(day, start, end, ref=position))
            signature = (activity["start_at"], activity["end_at"], user.pk)
            if stored[signature] > 0:
                stored[signature] -= 1
                peers.append(item)
            else:
                candidates.append(item)
        found = person_overlaps(
            candidates,
            peers=peers,
            exclude_activity_ids=self.instance.activities.values("pk") if self.instance is not None else None,
        )
        return require_confirmation(found, confirmed)

    @transaction.atomic
    def create(self, validated_data):
        activities = validated_data.pop("activities", [])
        if validated_data.get("cms_closed_on") is not None:
            # Created already closed (a back-entry): when it was recorded is
            # known, but its closure lag is meaningless (the work and the
            # closing happened before it was ever in this app), so it stays NULL.
            validated_data["closed_recorded_at"] = timezone.now()
        ticket = Ticket.objects.create(**validated_data)
        self._replace_activities(ticket, activities)
        # Mirror resolved activities into their resolvers' work logs.
        sync_ticket(ticket)
        if request := self.context.get("request"):
            audit.log_created(ticket, request, len(activities), overlaps=self.confirmed_overlaps)
        return ticket

    @transaction.atomic
    def update(self, instance, validated_data):
        # Row lock for the whole update: two concurrent edits of one ticket
        # queue up (last write wins) instead of interleaving their "delete
        # activities, insert activities" steps, which on PostgreSQL could
        # leave both sets behind. (A no-op on SQLite, which serialises writes.)
        Ticket.objects.select_for_update().filter(pk=instance.pk).exists()
        activities = validated_data.pop("activities", None)
        # For the audit trail: the ticket (and its activities) as they were.
        before = audit.snapshot(instance)
        old_activities = audit.stored_activities(instance) if activities is not None else None
        old_pdf = instance.pdf_attachment.name
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        if activities is not None:
            self._replace_activities(instance, activities)
        elif instance.activities.exists():
            # Activities untouched: a sent total still can't contradict them.
            self._sync_total(instance)
        # Work logs follow the activities (replaced ones' entries went with
        # them by CASCADE) and the ticket number shown in their reference.
        sync_ticket(instance)
        self._record_closure(instance, was=before["status"])
        if request := self.context.get("request"):
            new_activities = audit.sent_activities(activities) if activities is not None else None
            audit.log_updated(
                instance, request, before, old_activities, new_activities, overlaps=self.confirmed_overlaps
            )

        if old_pdf and instance.pdf_attachment.name != old_pdf:
            # Replaced or removed: delete the old file once the update commits.
            storage = instance.pdf_attachment.storage
            transaction.on_commit(lambda: storage.delete(old_pdf))
        return instance

    @staticmethod
    def _record_closure(ticket, was: str) -> None:
        """
        Closure timing on a status transition (the same before/after status
        the audit log's closed / reopened entries use). Open -> closed: the
        system time it happened, and the minutes since the ticket's clock
        started, measured after the activities were saved so the ones sent
        with this edit count. Closed -> open: both cleared. No transition (an
        edit of a closed or an open ticket): untouched.
        """
        if was == ticket.status:
            return
        if ticket.status == "closed":
            now = timezone.now()
            ticket.closed_recorded_at = now
            ticket.closure_lag_minutes = closure_lag_minutes(ticket, now)
        else:
            ticket.closed_recorded_at = None
            ticket.closure_lag_minutes = None
        ticket.save(update_fields=["closed_recorded_at", "closure_lag_minutes", "updated_at"])

    def _replace_activities(self, ticket, activities):
        """The sent list becomes the complete set (added, edited and removed at once)."""
        ticket.activities.all().delete()
        TicketActivity.objects.bulk_create(TicketActivity(ticket=ticket, **activity) for activity in activities)
        if activities:
            self._sync_total(ticket)
        # No activities: the manually entered total stands as saved.

    @staticmethod
    def _sync_total(ticket):
        """Server-authoritative: with activities, the total is their summed duration."""
        minutes = ticket.activities.aggregate(total=Sum("duration_minutes"))["total"] or 0
        ticket.total_duration_hours = minutes_to_hours(minutes)
        ticket.save(update_fields=["total_duration_hours", "updated_at"])

    def to_representation(self, instance):
        return TicketListSerializer(instance, context=self.context).data


# --- Detail (pre-fills the edit dialog) -----------------------------------------


class TicketActivityReadSerializer(serializers.ModelSerializer):
    resolved_by = UserRefSerializer(allow_null=True)

    class Meta:
        model = TicketActivity
        fields = [
            "id",
            "activity_type",
            "start_at",
            "end_at",
            "duration_minutes",
            "work_done_code",
            "is_likely_cause",
            "resolved_by",
        ]
        read_only_fields = fields


# Every writable field except the two represented differently on read.
_DETAIL_WRITE_FIELDS = [
    f for f in TicketWriteSerializer.Meta.fields if f not in ("pdf_attachment", "activities", "confirm_overlaps")
]


class TicketDetailSerializer(serializers.ModelSerializer):
    """Everything the write serializer accepts, with references expanded for display."""

    site = SiteSerializer()
    customer = CustomerSerializer()
    assigned_to = UserRefSerializer()
    forwarded_to = UserRefSerializer(allow_null=True)
    cms_added_by = UserRefSerializer(allow_null=True)
    resolution_verified_by = UserRefSerializer(allow_null=True)
    cms_closed_by = UserRefSerializer(allow_null=True)
    created_by = UserRefSerializer()
    activities = TicketActivityReadSerializer(many=True)
    status = serializers.CharField()
    total_duration_hours = serializers.FloatField()
    # Only the file's name: the form shows it; it isn't downloaded from there.
    pdf_attachment_name = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = [
            "id",
            "status",
            "pdf_attachment_name",
            *_DETAIL_WRITE_FIELDS,
            "activities",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_pdf_attachment_name(self, ticket) -> str | None:
        name = ticket.pdf_attachment.name
        return name.rsplit("/", 1)[-1] if name else None


# --- Tickets waiting to be closed (GET /api/tickets/attention/) ------------------------
# Output only: they document the response and format its values (ISO date-times).

# Named once in the schema (ENUM_NAME_OVERRIDES): AttentionRoleEnum, AttentionLevelEnum.
ATTENTION_ROLES = list(ROLE_ORDER)
ATTENTION_LEVELS = Level.choices


class AttentionThresholdsSerializer(serializers.Serializer):
    due_soon_hours = serializers.IntegerField()
    overdue_hours = serializers.IntegerField()
    critical_hours = serializers.IntegerField()
    no_activity_grace_hours = serializers.IntegerField(
        help_text="Added to every threshold for a ticket with no activities (its clock starts at received_at)."
    )


class AttentionCountsSerializer(serializers.Serializer):
    due_soon = serializers.IntegerField()
    overdue = serializers.IntegerField()
    critical = serializers.IntegerField()


class AttentionPersonRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class AttentionInvolvedSerializer(AttentionPersonRefSerializer):
    roles = serializers.ListField(child=serializers.ChoiceField(choices=ATTENTION_ROLES))


class AttentionTicketSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    cms_next_ticket_no = serializers.CharField()
    site_name = serializers.CharField()
    site_ocn = serializers.CharField()
    customer_name = serializers.CharField()
    level = serializers.ChoiceField(choices=ATTENTION_LEVELS)
    age_hours = serializers.FloatField(help_text="Calendar hours since the clock started, one decimal.")
    basis = serializers.ChoiceField(
        choices=["last_activity", "received"],
        help_text="last_activity: the end of the latest activity (by anyone); received: no activities yet.",
    )
    clock_started_at = serializers.DateTimeField()
    involved = AttentionInvolvedSerializer(many=True, help_text="Active people named on the ticket.")
    your_roles = serializers.ListField(
        child=serializers.ChoiceField(choices=ATTENTION_ROLES),
        help_text="The requester's own roles on it (may be empty for admins).",
    )


class AttentionPersonSerializer(serializers.Serializer):
    user = AttentionPersonRefSerializer()
    counts = AttentionCountsSerializer()
    ticket_ids = serializers.ListField(child=serializers.IntegerField())


class AttentionResponseSerializer(serializers.Serializer):
    generated_at = serializers.DateTimeField()
    thresholds = AttentionThresholdsSerializer()
    scope = serializers.ChoiceField(choices=["mine", "all"])
    counts = AttentionCountsSerializer(help_text="Every ticket in the viewer's scope, not only the listed ones.")
    total = serializers.IntegerField()
    truncated = serializers.BooleanField(help_text="True when `results` was cut at 200.")
    results = AttentionTicketSerializer(many=True)
    people = AttentionPersonSerializer(
        many=True,
        required=False,
        help_text="Admins only (absent for staff): one row per person; a ticket counts for everyone named on it.",
    )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if "people" not in instance:
            data.pop("people", None)  # absent, not null, for staff
        return data
