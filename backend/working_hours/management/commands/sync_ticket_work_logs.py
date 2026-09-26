"""
Bring every ticket activity's auto work-log entry up to date.

The backfill for activities that existed before auto entries did, and a
repair tool afterwards (e.g. after changing someone's time zone, which only
applies to their activities at the next sync). Safe to re-run, and safe on
real data: it only touches auto entries, through the same working_hours.sync
the app uses. Manual entries are never changed.
"""

from collections import Counter

from django.core.management.base import BaseCommand
from django.db import transaction

from tickets.models import TicketActivity
from working_hours.sync import sync_activity


class Command(BaseCommand):
    help = "Create, update or remove the AMS work-log entries mirrored from ticket activities."

    @transaction.atomic
    def handle(self, *args, **options):
        outcomes = Counter(
            sync_activity(activity)
            for activity in TicketActivity.objects.select_related("ticket", "resolved_by")
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Synced {sum(outcomes.values())} ticket activities: "
                f"{outcomes['created']} entries created, {outcomes['updated']} updated, "
                f"{outcomes['removed']} removed, {outcomes['none']} without an entry "
                "(no resolver or no time)."
            )
        )
