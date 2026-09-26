"""
Regenerate ~90 days of realistic *manual* work-log entries for every staff user
(local dev only).

Manual entries are Non-AMS only: AMS time exists only as auto entries mirrored
from ticket activities (working_hours.sync), so this command never makes AMS
rows. To see AMS hours in dev, add ticket activities with a resolver.
"""

import random
from datetime import time, timedelta
from decimal import Decimal

from django.db import transaction

from core.management import DevOnlyCommand
from accounts.models import User
from working_hours.models import WorkLogEntry, hours_between
from working_hours.periods import local_today

NON_AMS = WorkLogEntry.Category.NON_AMS


def quarter(hours: float) -> Decimal:
    """Round to the nearest 15 minutes, as people actually log time."""
    return Decimal(round(hours * 4) / 4).quantize(Decimal("0.01"))


def day_total(rng: random.Random) -> float:
    """A day's Non-AMS time (meetings, training, admin): usually 1–5 h."""
    return min(6.0, max(0.5, rng.gauss(3, 1.2)))


def split_day(rng: random.Random, total: Decimal) -> list[tuple[str, Decimal]]:
    """1–3 Non-AMS entries whose hours sum exactly to `total`."""
    count = rng.choices([1, 2, 3], weights=[4, 4, 2])[0]
    parts, left = [], total
    for _ in range(count - 1):
        piece = quarter(float(left) * rng.uniform(0.3, 0.7))
        if Decimal(0) < piece < left:
            parts.append(piece)
            left -= piece
    return [(NON_AMS, hours) for hours in [*parts, left] if hours > 0]


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
    help = "Clear and regenerate the manual (Non-AMS) work-log entries of all staff users."

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

        # Manual entries only: auto entries belong to ticket activities.
        deleted, _ = WorkLogEntry.objects.filter(user__in=users, ticket_activity__isnull=True).delete()
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
