"""
Delete audit entries older than N days. Deliberately not scheduled: an audit
trail shouldn't be pruned casually, so this only runs when someone decides to
(e.g. under a written retention policy). Safe in production; not dev-only.
"""

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from audit.models import AuditLogEntry


class Command(BaseCommand):
    help = "Delete audit log entries older than --older-than-days (use --dry-run to count first)."

    def add_arguments(self, parser):
        parser.add_argument("--older-than-days", type=int, required=True, help="Keep this many days; delete older.")
        parser.add_argument("--dry-run", action="store_true", help="Only report how many would be deleted.")

    def handle(self, *args, older_than_days, dry_run, **options):
        if older_than_days < 1:
            raise CommandError("--older-than-days must be at least 1.")
        cutoff = timezone.now() - timedelta(days=older_than_days)
        old = AuditLogEntry.objects.filter(created_at__lt=cutoff)
        count = old.count()
        if dry_run:
            self.stdout.write(f"{count} audit entries are older than {older_than_days} days (nothing deleted).")
            return
        old.delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {count} audit entries older than {older_than_days} days."))
