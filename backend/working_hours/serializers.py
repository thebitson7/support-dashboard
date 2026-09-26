from decimal import Decimal

from django.db.models import Sum
from rest_framework import serializers

from .models import WorkLogEntry, hours_between
from .periods import local_today
from .sync import ticket_reference

MAX_DAY_HOURS = Decimal(24)


def _fmt(hours: Decimal) -> str:
    """Decimal(7.50) -> "7.5"."""
    return f"{hours.normalize():f}"


class WorkLogEntrySerializer(serializers.ModelSerializer):
    """
    One logged block of time: a date plus a start and end time on it. `hours`
    is read-only: the model derives it from the times on every save, so a
    client-sent value is ignored (server-authoritative, like a ticket's total
    duration once it has activities).

    Whose entry it is never comes from the body: the view passes the target
    user in the context (create) or it's the entry's existing owner (update),
    and that can't be changed.

    Dates are checked against the *viewer's* calendar, the same zone the
    summary cuts its periods in: omitted means the viewer's today, and a date
    after it is refused.

    Writes here are manual entries, which are Non-AMS only: AMS time comes
    from ticket activities (auto entries, see working_hours.sync), which this
    serializer never writes; the view refuses to change them. `category` may
    be omitted (it defaults to Non-AMS) but can't be set to AMS. An older
    hand-logged AMS entry can still be edited without resending its category.
    Reads mark auto entries (`is_auto`) and name their ticket.
    """

    date = serializers.DateField(required=False)
    start_time = serializers.TimeField(format="%H:%M")
    end_time = serializers.TimeField(format="%H:%M")
    hours = serializers.DecimalField(
        max_digits=5, decimal_places=2, coerce_to_string=False, read_only=True
    )
    category = serializers.ChoiceField(choices=WorkLogEntry.Category.choices, required=False)
    is_auto = serializers.BooleanField(read_only=True)
    ticket = serializers.SerializerMethodField()
    ticket_reference = serializers.SerializerMethodField()

    class Meta:
        model = WorkLogEntry
        fields = [
            "id",
            "user",
            "date",
            "start_time",
            "end_time",
            "category",
            "hours",
            "note",
            "is_auto",
            "ticket",
            "ticket_reference",
            "created_at",
        ]
        read_only_fields = ["id", "user", "created_at"]

    # Entries are logged to the minute: "09:15:42" is stored as 09:15.
    def validate_start_time(self, value):
        return value.replace(second=0, microsecond=0)

    def validate_end_time(self, value):
        return value.replace(second=0, microsecond=0)

    def validate_note(self, value):
        return value.strip()

    def validate_category(self, value):
        if value == WorkLogEntry.Category.AMS:
            raise serializers.ValidationError(
                "AMS time is recorded automatically from ticket activities. "
                "Only Non-AMS work can be logged here."
            )
        return value

    def get_ticket(self, entry) -> int | None:
        """The linked ticket's id (auto entries), for linking to it."""
        return entry.ticket_activity.ticket_id if entry.ticket_activity_id else None

    def get_ticket_reference(self, entry) -> str | None:
        """"Ticket #… — Troubleshooting", read live from the ticket (auto entries)."""
        return ticket_reference(entry.ticket_activity) if entry.ticket_activity_id else None

    def validate(self, attrs):
        instance = self.instance

        def final(field):
            return attrs[field] if field in attrs else getattr(instance, field)

        if instance is None:
            attrs.setdefault("category", WorkLogEntry.Category.NON_AMS)

        today = local_today(self.context["request"].user)
        day = attrs.get("date", instance.date if instance else today)
        if day > today:
            raise serializers.ValidationError({"date": "You can't log hours for a future date."})
        attrs["date"] = day

        # Midnight policy: an entry lies within its one date, so the end must
        # be strictly after the start. A shift crossing midnight (e.g. 11:30 PM
        # – 12:15 AM) is refused rather than guessed at, and is logged as two
        # entries instead, one on each date. That keeps "the hours on a date"
        # unambiguous for the summaries and the 24 h daily cap. (It costs the
        # day's last minute: a time can't be 24:00, so the first half ends at
        # 11:59 PM.)
        start, end = final("start_time"), final("end_time")
        if end <= start:
            raise serializers.ValidationError(
                {
                    "end_time": "End time must be after the start time. For a shift that "
                    "crosses midnight, log it as two entries, one on each date."
                }
            )

        # Same limits as before, applied to the computed duration. A same-day
        # span tops out at 23 h 59 m, so the per-entry cap is a safety net.
        hours = hours_between(start, end)
        if hours > MAX_DAY_HOURS:
            raise serializers.ValidationError(
                {"end_time": "A single entry can't be more than 24 hours."}
            )

        # A day holds at most 24 h across all its entries (a plain sum; no
        # overlap detection).
        owner = instance.user if instance else self.context["target"]
        others = WorkLogEntry.objects.filter(user=owner, date=day)
        if instance:
            others = others.exclude(pk=instance.pk)
        logged = others.aggregate(total=Sum("hours"))["total"] or Decimal(0)
        if logged + hours > MAX_DAY_HOURS:
            raise serializers.ValidationError(
                {
                    "end_time": f"{_fmt(logged)} h is already logged on this day; adding "
                    f"{_fmt(hours)} h would go over the 24 h a day can hold."
                }
            )
        return attrs
