"""Management commands: what the seeds generate, and which commands may run where."""

from collections import defaultdict
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from io import StringIO

from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings

from accounts.models import User
from tickets.models import Customer, Site, Ticket, TicketActivity, WorkDoneCode
from working_hours.models import WorkLogEntry, hours_between


class SeedWorkLogsTests(TestCase):
    def setUp(self):
        self.syed = User.objects.create_user("syed", password="pw")
        self.naleefa = User.objects.create_user("naleefa", password="pw", timezone="Asia/Manila")
        self.admin = User.objects.create_user("boss", password="pw", role=User.Role.ADMIN)

    @override_settings(DEBUG=True)
    def test_generates_only_non_ams_manual_entries(self):
        call_command("seed_work_logs", days=30, seed=1, stdout=StringIO())

        entries = WorkLogEntry.objects.all()
        self.assertGreater(entries.count(), 20)
        # AMS time only ever comes from ticket activities.
        self.assertEqual(set(entries.values_list("category", flat=True)), {"non_ams"})
        self.assertFalse(entries.filter(ticket_activity__isnull=False).exists())
        self.assertFalse(entries.filter(user=self.admin).exists())  # staff only

        per_day = defaultdict(Decimal)
        for e in entries:
            self.assertLess(e.start_time, e.end_time)
            self.assertEqual(e.hours, hours_between(e.start_time, e.end_time))
            per_day[(e.user_id, e.date)] += e.hours
        self.assertLessEqual(max(per_day.values()), Decimal(24))

    @override_settings(DEBUG=True)
    def test_rerunning_replaces_manual_entries_but_keeps_auto_ones(self):
        ticket = Ticket.objects.create(
            received_at=datetime(2026, 3, 2, tzinfo=dt_timezone.utc),
            cms_next_ticket_no="X",
            site=Site.objects.create(name="S", ocn="O"),
            customer=Customer.objects.create(name="C"),
            assigned_to=self.syed,
            ticket_type="software",
            incoming_channel="email",
            cms_added_on=datetime(2026, 3, 2, tzinfo=dt_timezone.utc),
            issue_description="i",
            notes="n",
            created_by=self.syed,
        )
        start = datetime(2026, 3, 2, 1, 0, tzinfo=dt_timezone.utc)
        TicketActivity.objects.create(
            ticket=ticket,
            activity_type="troubleshooting",
            start_at=start,
            end_at=start + timedelta(hours=1),
            work_done_code=WorkDoneCode.objects.create(code="RMD", description="d"),
            resolved_by=self.syed,
        )
        auto = WorkLogEntry.objects.get()

        call_command("seed_work_logs", days=10, seed=1, stdout=StringIO())
        first = set(WorkLogEntry.objects.filter(ticket_activity__isnull=True).values_list("pk", flat=True))
        call_command("seed_work_logs", days=10, seed=2, stdout=StringIO())
        second = set(WorkLogEntry.objects.filter(ticket_activity__isnull=True).values_list("pk", flat=True))

        self.assertTrue(first and second and not first & second)  # manual rows regenerated
        self.assertTrue(WorkLogEntry.objects.filter(pk=auto.pk).exists())  # the auto entry survives


@override_settings(DEBUG=False)
class DevOnlyGuardTests(TestCase):
    """Seeds reset passwords or replace data, so they refuse to run with DEBUG off."""

    def test_every_seed_command_refuses_without_debug(self):
        for command in ("seed_users", "seed_work_logs", "seed_tickets_support_data"):
            with self.subTest(command=command):
                with self.assertRaisesMessage(CommandError, "local development only"):
                    call_command(command, stdout=StringIO())
        self.assertFalse(User.objects.exists())

    def test_the_sync_command_is_safe_to_run_anywhere(self):
        # It only rebuilds auto entries from ticket activities: allowed in production.
        out = StringIO()
        call_command("sync_ticket_work_logs", stdout=out)
        self.assertIn("Synced 0 ticket activities", out.getvalue())
