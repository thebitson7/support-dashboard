"""
Demo tickets for "Tickets waiting to be closed", dated relative to NOW.

Idempotent: its own tickets (CMS number starting DEMO-ATT-) and their synced
work-log entries are removed and recreated on every run. They are created
through the app's own ticket write serializer, so the work-log auto-sync
runs exactly as it does for a ticket saved from the UI. Local development
only (refuses to run with DEBUG off); needs `seed_users` and
`seed_tickets_support_data` first.

  DEMO-ATT-1001  by syed, last activity ended 51 h ago, resolved by naleefa  -> overdue
  DEMO-ATT-1002  by syed, last activity ended 23 h ago                       -> not listed
  DEMO-ATT-1003  by and resolved by wahida, last activity ended 77 h ago     -> critical
  DEMO-ATT-1004  no activities, received 60 h ago, assigned to naleefa       -> due soon
"""

from datetime import datetime, timedelta

from django.core.management.base import CommandError
from django.db import transaction
from django.utils import timezone

from accounts.models import User
from core.management import DevOnlyCommand
from tickets.models import Customer, Site, Ticket, WorkDoneCode
from tickets.serializers import TicketWriteSerializer
from working_hours.models import WorkLogEntry

PREFIX = "DEMO-ATT-"
USERNAMES = ("syed", "naleefa", "wahida")


class Command(DevOnlyCommand):
    help = "Create (or replace) the DEMO-ATT- tickets that show the attention alerts."

    @transaction.atomic
    def handle(self, *args, **options):
        users = {u.username: u for u in User.objects.filter(username__in=USERNAMES, is_active=True)}
        missing = [name for name in USERNAMES if name not in users]
        if missing:
            raise CommandError(
                f"Missing active user(s): {', '.join(missing)}. Run `python manage.py seed_users` first."
            )
        site = Site.objects.filter(is_active=True).first()
        customer = Customer.objects.first()
        code = WorkDoneCode.objects.filter(is_active=True).first()
        if not (site and customer and code):
            raise CommandError(
                "No sites, customers or work-done codes yet. Run `python manage.py seed_tickets_support_data` first."
            )

        # Replace whatever an earlier run left (the entries also go by CASCADE;
        # deleted explicitly so the intent is visible).
        old = Ticket.objects.filter(cms_next_ticket_no__startswith=PREFIX)
        replaced = old.count()
        entries, _ = WorkLogEntry.objects.filter(ticket_activity__ticket__in=old).delete()
        old.delete()

        now = timezone.now()
        syed, naleefa, wahida = users["syed"], users["naleefa"], users["wahida"]

        def activity(ended_hours_ago: float, resolver: User) -> dict:
            end = now - timedelta(hours=ended_hours_ago)
            return {
                "activity_type": "remote_support",
                "start_at": end - timedelta(hours=1),
                "end_at": end,
                "work_done_code": code.pk,
                "resolved_by": resolver.pk,
            }

        def create(number: str, *, creator: User, assignee: User, received: datetime, activities: list[dict]):
            data = {
                "received_at": received,
                "cms_next_ticket_no": f"{PREFIX}{number}",
                "site": site.pk,
                "customer": customer.pk,
                "assigned_to": assignee.pk,
                "ticket_type": "software",
                "incoming_channel": "email",
                "cms_added_on": received,
                "issue_description": "Demo ticket for the 'Tickets waiting to be closed' alerts.",
                "notes": "Created by seed_attention_demo; replaced on every run.",
                "activities": activities,
            }
            serializer = TicketWriteSerializer(data=data)
            serializer.is_valid(raise_exception=True)
            return serializer.save(created_by=creator)

        create(
            "1001", creator=syed, assignee=syed, received=now - timedelta(hours=60), activities=[activity(51, naleefa)]
        )
        create("1002", creator=syed, assignee=syed, received=now - timedelta(hours=30), activities=[activity(23, syed)])
        create(
            "1003",
            creator=wahida,
            assignee=wahida,
            received=now - timedelta(hours=90),
            activities=[activity(77, wahida)],
        )
        create("1004", creator=naleefa, assignee=naleefa, received=now - timedelta(hours=60), activities=[])

        self.stdout.write(
            self.style.SUCCESS(
                f"Attention demo ready: 4 {PREFIX} tickets at {site.name} "
                f"(replaced {replaced} earlier demo ticket(s) and {entries} of their work-log entries)."
            )
        )
        for line in (
            "  1001 overdue  (syed, naleefa; last activity 51 h ago)",
            "  1002 healthy  (syed; last activity 23 h ago)",
            "  1003 critical (wahida; last activity 77 h ago)",
            "  1004 due soon (naleefa; no activities, received 60 h ago)",
        ):
            self.stdout.write(line)
