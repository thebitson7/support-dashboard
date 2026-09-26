from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Sum
from rest_framework import serializers

from accounts.models import User
from accounts.serializers import UserRefSerializer
from working_hours.sync import sync_ticket

from .models import Customer, Site, Ticket, TicketActivity, WorkDoneCode

MAX_PDF_BYTES = 10 * 1024 * 1024

# All five together close a ticket; a partial set is rejected (see validate()).
VERIFICATION_FIELDS = (
    "resolution_verified_by",
    "resolution_verified_on",
    "cms_closed_by",
    "cms_closed_on",
    "service_closed_date",
)


def active_user_field(**kwargs):
    """A user reference by id; deactivated accounts can't be newly assigned anything."""
    return serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True), **kwargs)


def minutes_to_hours(minutes: int) -> Decimal:
    return (Decimal(minutes) / Decimal(60)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# --- Reference data ------------------------------------------------------------


class SiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Site
        fields = ["id", "name", "ocn"]

    def validate_name(self, value):
        return value.strip()

    def validate_ocn(self, value):
        return value.strip().upper()


class CustomerSerializer(serializers.ModelSerializer):
    # Explicit field: the automatic unique validator would compare the raw,
    # case-sensitive input and let "singhealth" in beside "SingHealth".
    name = serializers.CharField(max_length=200)

    class Meta:
        model = Customer
        fields = ["id", "name"]

    def validate_name(self, value):
        value = value.strip()
        if Customer.objects.filter(name__iexact=value).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("A customer with this name already exists.")
        return value


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
    duration_minutes = serializers.IntegerField(
        required=False, allow_null=True, min_value=0, max_value=60 * 24 * 31
    )

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
            attrs["duration_minutes"] = TicketActivity.minutes_between(
                attrs["start_at"], attrs["end_at"]
            )
        return attrs


class TicketWriteSerializer(serializers.ModelSerializer):
    """
    Creates or updates a ticket together with its activities, in one
    transaction and under the same rules. `created_by` is not a field here:
    the view sets it from the authenticated user on create, and nothing can
    change it afterwards.

    Activities are replaced as a set: the list sent becomes the ticket's
    activities (on PATCH, omit the key to leave them untouched).
    """

    assigned_to = active_user_field()
    forwarded_to = active_user_field(required=False, allow_null=True)
    cms_added_by = active_user_field(required=False, allow_null=True)
    resolution_verified_by = active_user_field(required=False, allow_null=True)
    cms_closed_by = active_user_field(required=False, allow_null=True)
    activities = TicketActivityWriteSerializer(many=True, required=False)

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
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        activities = validated_data.pop("activities", [])
        ticket = Ticket.objects.create(**validated_data)
        self._replace_activities(ticket, activities)
        # Mirror resolved activities into their resolvers' work logs.
        sync_ticket(ticket)
        return ticket

    @transaction.atomic
    def update(self, instance, validated_data):
        # Row lock for the whole update: two concurrent edits of one ticket
        # queue up (last write wins) instead of interleaving their "delete
        # activities, insert activities" steps, which on PostgreSQL could
        # leave both sets behind. (A no-op on SQLite, which serialises writes.)
        Ticket.objects.select_for_update().filter(pk=instance.pk).exists()
        activities = validated_data.pop("activities", None)
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

        if old_pdf and instance.pdf_attachment.name != old_pdf:
            # Replaced or removed: delete the old file once the update commits.
            storage = instance.pdf_attachment.storage
            transaction.on_commit(lambda: storage.delete(old_pdf))
        return instance

    def _replace_activities(self, ticket, activities):
        """The sent list becomes the complete set (added, edited and removed at once)."""
        ticket.activities.all().delete()
        TicketActivity.objects.bulk_create(
            TicketActivity(ticket=ticket, **activity) for activity in activities
        )
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
    f for f in TicketWriteSerializer.Meta.fields if f not in ("pdf_attachment", "activities")
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
