"""Regenerate ~90 days of realistic work-log entries for every staff user (local dev only)."""

import random
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import User
from working_hours.models import WorkLogEntry
from working_hours.periods import local_today

AMS = WorkLogEntry.Category.AMS
NON_AMS = WorkLogEntry.Category.NON_AMS


def quarter(hours: float) -> Decimal:
    """Round to the nearest 15 minutes, as people actually log time."""
    return Decimal(round(hours * 4) / 4).quantize(Decimal("0.01"))


def day_total(rng: random.Random) -> float:
    """Mostly a ~8h day with some variance; occasionally a short one."""
    if rng.random() < 0.1:
        return rng.uniform(2, 5)
    return min(9.0, max(4.0, rng.gauss(8, 0.75)))


def split_day(rng: random.Random, total: Decimal) -> list[tuple[str, Decimal]]:
    """1–3 entries whose hours sum exactly to `total`, split between AMS and Non-AMS."""
    count = rng.choices([1, 2, 3], weights=[2, 5, 3])[0]
    if count == 1:
        return [(AMS if rng.random() < 0.65 else NON_AMS, total)]

    ams = min(total, max(Decimal("0.25"), quarter(float(total) * rng.uniform(0.4, 0.8))))
    non_ams = total - ams
    entries = [(AMS, ams), (NON_AMS, non_ams)]
    if count == 3:
        # Split the larger bucket into two separate log lines.
        category, hours = max(entries, key=lambda e: e[1])
        first = quarter(float(hours) * rng.uniform(0.3, 0.7))
        if Decimal(0) < first < hours:
            entries.remove((category, hours))
            entries += [(category, first), (category, hours - first)]
    return [e for e in entries if e[1] > 0]


class Command(BaseCommand):
    help = "Clear and regenerate WorkLogEntry rows for all staff users."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=90, help="How many days back to fill.")
        parser.add_argument("--seed", type=int, default=None, help="RNG seed for repeatable data.")

    @transaction.atomic
    def handle(self, *args, days, seed, **options):
        rng = random.Random(seed)
        users = list(User.objects.filter(role=User.Role.STAFF))
        if not users:
            self.stderr.write("No staff users found. Run `python manage.py seed_users` first.")
            return

        deleted, _ = WorkLogEntry.objects.filter(user__in=users).delete()
        rows = []
        for user in users:
            today = local_today(user)  # each user's own calendar day
            for offset in range(days):
                day = today - timedelta(days=offset)
                weekend = day.weekday() >= 5
                # Weekends are usually off (a rare Saturday shift); weekdays
                # have the odd day of leave.
                if (weekend and rng.random() > 0.05) or (not weekend and rng.random() < 0.08):
                    continue
                total = quarter(day_total(rng))
                rows += [
                    WorkLogEntry(user=user, date=day, category=category, hours=hours)
                    for category, hours in split_day(rng, total)
                ]

        WorkLogEntry.objects.bulk_create(rows)
        self.stdout.write(
            self.style.SUCCESS(
                f"Removed {deleted} old entries; created {len(rows)} entries across "
                f"{len(users)} staff users ({days} days up to each user's local today)."
            )
        )
