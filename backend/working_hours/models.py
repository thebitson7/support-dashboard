from datetime import time
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db import models


def minutes_of_day(value: time) -> int:
    """09:45 -> 585. Seconds are ignored: entries are logged to the minute."""
    return value.hour * 60 + value.minute


def hours_between(start: time, end: time) -> Decimal:
    """
    Duration of start–end within one day, in hours to 2 decimal places
    (1h 45m -> 1.75; 20m -> 0.33). Never negative: an end at or before the
    start is refused by the serializer, so it only reaches here via the admin
    or the shell, and counts as 0.
    """
    minutes = max(0, minutes_of_day(end) - minutes_of_day(start))
    return (Decimal(minutes) / Decimal(60)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class WorkLogEntry(models.Model):
    class Category(models.TextChoices):
        AMS = "ams", "AMS"
        NON_AMS = "non_ams", "Non-AMS"

    # PROTECT, like every user reference in the project: people who have
    # logged hours are deactivated, never deleted (which would erase history).
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="work_logs"
    )
    date = models.DateField()
    # Both on `date`: an entry never crosses midnight (see the serializer).
    start_time = models.TimeField()
    end_time = models.TimeField()
    category = models.CharField(max_length=10, choices=Category.choices)
    # Computed from start/end on every save (server-authoritative), and kept
    # as a column because the period summaries aggregate it directly.
    hours = models.DecimalField(max_digits=5, decimal_places=2, editable=False)
    # Optional context ("Tan Tock Seng LIS outage"), shown in the entries list.
    # Auto entries carry their ticket reference here.
    note = models.CharField(max_length=200, blank=True)
    # Set = an "auto" entry, mirrored from this ticket activity by
    # working_hours.sync and changed only through it; unset = logged by hand.
    ticket_activity = models.OneToOneField(
        "tickets.TicketActivity",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        editable=False,
        related_name="work_log_entry",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "user", "start_time"]
        indexes = [models.Index(fields=["user", "date"])]
        verbose_name_plural = "work log entries"

    def __str__(self):
        return f"{self.user} · {self.date} · {self.get_category_display()} · {self.hours}h"

    @property
    def is_auto(self) -> bool:
        return self.ticket_activity_id is not None

    def save(self, *args, **kwargs):
        # Always recomputed, whatever `hours` was set to: the times are the truth.
        self.hours = hours_between(self.start_time, self.end_time)
        update_fields = kwargs.get("update_fields")
        if update_fields is not None and {"start_time", "end_time"} & set(update_fields):
            kwargs["update_fields"] = {*update_fields, "hours"}
        super().save(*args, **kwargs)
