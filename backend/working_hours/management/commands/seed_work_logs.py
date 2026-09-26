"""Regenerate ~90 days of realistic work-log entries for every staff user (local dev only)."""

import random
from datetime import time, timedelta
from decimal import Decimal

from django.db import transaction

from core.management import DevOnlyCommand
from accounts.models import User
from working_hours.models import WorkLogEntry, hours_between
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


def timed_entries(rng: random.Random, user, day, parts) -> list[WorkLogEntry]:
    """
    Lays a day's (category, hours) parts out back to back from a start
    between 08:00 and 09:30, in random order, as start/end times.
    """
    parts = list(parts)
    rng.shuffle(parts)
    cursor = 8 * 60 + 15 * rng.randint(0, 6)  # minutes since midnight
    entries = []
    for category, hours in parts:
        end = cursor + int(hours * 60)
        start_time, end_time = time(*divmod(cursor, 60)), time(*divmod(end, 60))
        entries.append(
            WorkLogEntry(
                user=user,
                date=day,
                start_time=start_time,
                end_time=end_time,
                category=category,
                # bulk_create skips save(), which normally derives this.
                hours=hours_between(start_time, end_time),
            )
        )
        cursor = end
    return entries


class Command(DevOnlyCommand):
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
                rows += timed_entries(rng, user, day, split_day(rng, total))

        WorkLogEntry.objects.bulk_create(rows)
        self.stdout.write(
            self.style.SUCCESS(
                f"Removed {deleted} old entries; created {len(rows)} entries across "
                f"{len(users)} staff users ({days} days up to each user's local today)."
            )
        )
