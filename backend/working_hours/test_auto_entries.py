"""
AMS time from ticket activities ("auto" entries), and how it meets manual
logging, the Job Sheet's day list and the period summary.
"""

from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from rest_framework.test import APITestCase

from accounts.models import User
from tickets.models import Customer, Site, Ticket, TicketActivity, WorkDoneCode
from working_hours.models import WorkLogEntry

TICKETS_URL = "/api/tickets/"
ENTRIES_URL = "/api/working-hours/entries/"
SUMMARY_URL = "/api/working-hours/summary/"
# 01:00 UTC on Wed 4 Mar 2026 = 09:00 in Kuala Lumpur (everyone's default zone).
T0 = datetime(2026, 3, 4, 1, 0, tzinfo=dt_timezone.utc)
MARCH_4 = date(2026, 3, 4)


def iso(moment: datetime) -> str:
    return moment.isoformat()


class AutoEntryTestCase(APITestCase):
    def setUp(self):
        # 14:00 in Kuala Lumpur on Mar 4, so "today" is fixed.
        clock = patch("django.utils.timezone.now", return_value=datetime(2026, 3, 4, 6, 0, tzinfo=dt_timezone.utc))
        clock.start()
        self.addCleanup(clock.stop)
        self.admin = User.objects.create_user("boss", password="pw", role=User.Role.ADMIN)
        self.alice = User.objects.create_user("alice", password="pw", first_name="Alice")
        self.bob = User.objects.create_user("bob", password="pw", first_name="Bob")
        self.site = Site.objects.create(name="Tan Tock Seng Hospital", ocn="OCN05529-801-00")
        self.customer = Customer.objects.create(name="SingHealth")
        self.code = WorkDoneCode.objects.create(code="RMD", description="Remote Diagnostic")
        self.client.force_authenticate(self.alice)

    def activity(self, start=T0, minutes=120, resolved_by=None, **overrides):
        data = {
            "activity_type": "troubleshooting",
            "start_at": iso(start),
            "end_at": iso(start + timedelta(minutes=minutes)),
            "work_done_code": self.code.pk,
            "resolved_by": resolved_by.pk if resolved_by else None,
        }
        data.update(overrides)
        return data

    def create_ticket(self, activities, number="152172RA2778834"):
        response = self.client.post(
            TICKETS_URL,
            {
                "received_at": iso(T0),
                "cms_next_ticket_no": number,
                "site": self.site.pk,
                "customer": self.customer.pk,
                "assigned_to": self.alice.pk,
                "ticket_type": "software",
                "incoming_channel": "email",
                "cms_added_on": iso(T0),
                "issue_description": "Analyzer stops sending results to the LIS.",
                "notes": "Reported this morning.",
                "activities": activities,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        return Ticket.objects.get(pk=response.json()["id"])

    def patch_ticket(self, ticket, body):
        response = self.client.patch(f"{TICKETS_URL}{ticket.pk}/", body, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        return response

    def auto_entries(self):
        return list(
            WorkLogEntry.objects.filter(ticket_activity__isnull=False)
            .order_by("start_time")
            .values_list("user__username", "date", "start_time", "end_time", "category", "hours")
        )


class ActivitySyncTests(AutoEntryTestCase):
    def test_a_resolved_activity_becomes_an_ams_entry_for_the_resolver(self):
        ticket = self.create_ticket([self.activity(resolved_by=self.bob)])

        entry = WorkLogEntry.objects.get()
        activity = ticket.activities.get()
        self.assertEqual(
            (entry.user, entry.date, entry.start_time, entry.end_time, entry.category, entry.hours),
            (self.bob, MARCH_4, time(9, 0), time(11, 0), "ams", Decimal("2.00")),
        )
        self.assertEqual(entry.ticket_activity, activity)
        self.assertEqual(entry.note, "Ticket #152172RA2778834 — Troubleshooting")

    def test_an_activity_without_a_resolver_has_no_entry(self):
        self.create_ticket([self.activity()])
        self.assertFalse(WorkLogEntry.objects.exists())

    def test_editing_the_activity_time_updates_its_entry(self):
        ticket = self.create_ticket([self.activity(resolved_by=self.bob)])
        self.patch_ticket(ticket, {"activities": [self.activity(minutes=45, resolved_by=self.bob)]})

        self.assertEqual(self.auto_entries(), [("bob", MARCH_4, time(9, 0), time(9, 45), "ams", Decimal("0.75"))])

    def test_clearing_the_resolver_removes_the_entry(self):
        ticket = self.create_ticket([self.activity(resolved_by=self.bob)])
        self.patch_ticket(ticket, {"activities": [self.activity()]})

        self.assertFalse(WorkLogEntry.objects.exists())
        self.assertEqual(ticket.activities.count(), 1)

    def test_changing_the_resolver_moves_the_entry_without_duplicates(self):
        ticket = self.create_ticket([self.activity(resolved_by=self.bob)])
        self.patch_ticket(ticket, {"activities": [self.activity(resolved_by=self.alice)]})

        self.assertEqual([row[0] for row in self.auto_entries()], ["alice"])

    def test_removing_or_deleting_activities_removes_their_entries(self):
        ticket = self.create_ticket(
            [self.activity(resolved_by=self.bob), self.activity(start=T0 + timedelta(hours=3), resolved_by=self.alice)]
        )
        self.assertEqual(WorkLogEntry.objects.count(), 2)

        # Replacing the set deletes the old activities in bulk; CASCADE takes
        # their entries along, and the new set is synced once.
        self.patch_ticket(ticket, {"activities": [self.activity(resolved_by=self.bob)]})
        self.assertEqual([row[0] for row in self.auto_entries()], ["bob"])
        self.patch_ticket(ticket, {"activities": []})
        self.assertFalse(WorkLogEntry.objects.exists())

        ticket = self.create_ticket([self.activity(resolved_by=self.bob)], number="2")
        ticket.delete()
        self.assertFalse(WorkLogEntry.objects.exists())

    def test_edits_that_leave_activities_alone_keep_entries_and_refresh_the_reference(self):
        ticket = self.create_ticket([self.activity(resolved_by=self.bob)])
        entry_id = WorkLogEntry.objects.get().pk

        self.patch_ticket(ticket, {"cms_next_ticket_no": "999NEW"})

        entry = WorkLogEntry.objects.get()
        self.assertEqual(entry.pk, entry_id)
        self.assertEqual(entry.note, "Ticket #999NEW — Troubleshooting")

    def test_manual_entries_are_never_touched_by_the_sync(self):
        manual = WorkLogEntry.objects.create(
            user=self.bob, date=MARCH_4, category="non_ams", start_time=time(13, 0), end_time=time(14, 0)
        )
        ticket = self.create_ticket([self.activity(resolved_by=self.bob)])
        self.patch_ticket(ticket, {"activities": []})
        self.assertEqual(list(WorkLogEntry.objects.values_list("pk", flat=True)), [manual.pk])

    def test_a_single_activity_save_is_synced_by_the_signal(self):
        ticket = self.create_ticket([])
        activity = TicketActivity.objects.create(
            ticket=ticket,
            activity_type="follow_up",
            start_at=T0,
            end_at=T0 + timedelta(minutes=30),
            work_done_code=self.code,
            resolved_by=self.alice,
        )
        self.assertEqual(self.auto_entries(), [("alice", MARCH_4, time(9, 0), time(9, 30), "ams", Decimal("0.50"))])

        activity.resolved_by = None
        activity.save()
        self.assertFalse(WorkLogEntry.objects.exists())


class AutoEntryTimeTests(AutoEntryTestCase):
    def test_date_and_times_are_in_the_resolvers_own_zone(self):
        # 17:30–18:30 UTC on Mar 4 is 01:30–02:30 on Mar 5 in Manila.
        manila = User.objects.create_user("manila", password="pw", timezone="Asia/Manila")
        start = datetime(2026, 3, 4, 17, 30, tzinfo=dt_timezone.utc)
        self.create_ticket([self.activity(start=start, minutes=60, resolved_by=manila)])

        self.assertEqual(
            self.auto_entries(), [("manila", date(2026, 3, 5), time(1, 30), time(2, 30), "ams", Decimal("1.00"))]
        )

    def test_an_activity_past_midnight_is_clipped_to_its_start_date(self):
        # 15:00–17:30 UTC = 23:00–01:30 in Kuala Lumpur.
        start = datetime(2026, 3, 4, 15, 0, tzinfo=dt_timezone.utc)
        ticket = self.create_ticket([self.activity(start=start, minutes=150, resolved_by=self.bob)])

        self.assertEqual(self.auto_entries(), [("bob", MARCH_4, time(23, 0), time(23, 59), "ams", Decimal("0.98"))])
        # The ticket's own total still counts the whole activity.
        ticket.refresh_from_db()
        self.assertEqual(ticket.total_duration_hours, Decimal("2.50"))

    def test_an_activity_under_a_minute_has_no_entry(self):
        self.create_ticket([self.activity(minutes=0, resolved_by=self.bob)])
        self.assertFalse(WorkLogEntry.objects.exists())


class AutoEntryApiTests(AutoEntryTestCase):
    def setUp(self):
        super().setUp()
        self.create_ticket([self.activity(resolved_by=self.alice)])
        self.auto = WorkLogEntry.objects.get()

    def test_entries_list_marks_auto_entries_and_names_their_ticket(self):
        self.client.post(ENTRIES_URL, {"start_time": "13:00", "end_time": "14:30"}, format="json")

        rows = self.client.get(ENTRIES_URL, {"date": "2026-03-04"}).json()
        self.assertEqual(
            [(r["start_time"], r["category"], r["is_auto"], r["ticket_reference"]) for r in rows],
            [
                ("09:00", "ams", True, "Ticket #152172RA2778834 — Troubleshooting"),
                ("13:00", "non_ams", False, None),
            ],
        )
        self.assertEqual(rows[0]["ticket"], Ticket.objects.get().pk)
        self.assertIsNone(rows[1]["ticket"])

    def test_auto_entries_cannot_be_edited_or_deleted_here(self):
        message = "This entry comes from Ticket #152172RA2778834 — edit the ticket's activity instead."
        for user in (self.alice, self.admin):
            self.client.force_authenticate(user)
            with self.subTest(user=user.username):
                edited = self.client.patch(f"{ENTRIES_URL}{self.auto.pk}/", {"end_time": "12:00"}, format="json")
                deleted = self.client.delete(f"{ENTRIES_URL}{self.auto.pk}/")
                self.assertEqual((edited.status_code, edited.json()), (409, {"detail": message}))
                self.assertEqual((deleted.status_code, deleted.json()), (409, {"detail": message}))
                self.assertEqual(self.client.get(f"{ENTRIES_URL}{self.auto.pk}/").status_code, 200)
        self.auto.refresh_from_db()
        self.assertEqual((self.auto.end_time, self.auto.hours), (time(11, 0), Decimal("2.00")))

    def test_someone_elses_auto_entry_is_still_a_403_for_staff(self):
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.delete(f"{ENTRIES_URL}{self.auto.pk}/").status_code, 403)


class ManualEntriesAreNonAmsTests(AutoEntryTestCase):
    MESSAGE = ["AMS time is recorded automatically from ticket activities. Only Non-AMS work can be logged here."]

    def test_manual_ams_entries_cannot_be_created(self):
        response = self.client.post(
            ENTRIES_URL, {"category": "ams", "start_time": "09:00", "end_time": "10:00"}, format="json"
        )
        self.assertEqual((response.status_code, response.json()), (400, {"category": self.MESSAGE}))
        # Admins neither.
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            f"{ENTRIES_URL}?user_id={self.bob.pk}",
            {"category": "ams", "start_time": "09:00", "end_time": "10:00"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(WorkLogEntry.objects.exists())

    def test_category_defaults_to_non_ams(self):
        response = self.client.post(ENTRIES_URL, {"start_time": "09:00", "end_time": "10:00"}, format="json")
        self.assertEqual((response.status_code, response.json()["category"]), (201, "non_ams"))

    def test_a_manual_entry_cannot_be_switched_to_ams(self):
        entry = self.client.post(ENTRIES_URL, {"start_time": "09:00", "end_time": "10:00"}, format="json").json()
        response = self.client.patch(f"{ENTRIES_URL}{entry['id']}/", {"category": "ams"}, format="json")
        self.assertEqual((response.status_code, response.json()), (400, {"category": self.MESSAGE}))

    def test_an_older_hand_logged_ams_entry_can_still_be_edited_and_stays_ams(self):
        legacy = WorkLogEntry.objects.create(
            user=self.alice, date=MARCH_4, category="ams", start_time=time(8, 0), end_time=time(9, 0)
        )
        response = self.client.patch(f"{ENTRIES_URL}{legacy.pk}/", {"note": "fixed"}, format="json")
        self.assertEqual((response.status_code, response.json()["category"]), (200, "ams"))

    def test_auto_hours_count_toward_the_24_hour_day(self):
        self.create_ticket([self.activity(start=T0 - timedelta(hours=9), minutes=20 * 60, resolved_by=self.alice)])
        # 00:00–20:00 of auto time: 5 more manual hours would pass 24.
        response = self.client.post(ENTRIES_URL, {"start_time": "20:00", "end_time": "23:59"}, format="json")
        self.assertEqual(response.status_code, 201)
        response = self.client.post(ENTRIES_URL, {"start_time": "21:00", "end_time": "21:05"}, format="json")
        self.assertEqual(response.status_code, 400)


class BackfillCommandTests(AutoEntryTestCase):
    def test_existing_activities_get_their_entries_and_reruns_are_harmless(self):
        ticket = self.create_ticket([])
        # bulk_create fires no signal: these stand in for activities made
        # before auto entries existed.
        TicketActivity.objects.bulk_create(
            [
                TicketActivity(
                    ticket=ticket,
                    activity_type="troubleshooting",
                    start_at=T0 + timedelta(hours=n),
                    end_at=T0 + timedelta(hours=n, minutes=30),
                    duration_minutes=30,
                    work_done_code=self.code,
                    resolved_by=resolver,
                )
                for n, resolver in enumerate([self.alice, self.bob, None])
            ]
        )
        self.assertFalse(WorkLogEntry.objects.exists())

        out = StringIO()
        call_command("sync_ticket_work_logs", stdout=out)
        self.assertIn("3 ticket activities: 2 entries created, 0 updated, 0 removed, 1 without", out.getvalue())
        self.assertEqual(
            self.auto_entries(),
            [
                ("alice", MARCH_4, time(9, 0), time(9, 30), "ams", Decimal("0.50")),
                ("bob", MARCH_4, time(10, 0), time(10, 30), "ams", Decimal("0.50")),
            ],
        )

        out = StringIO()
        call_command("sync_ticket_work_logs", stdout=out)
        self.assertIn("0 entries created, 2 updated", out.getvalue())
        self.assertEqual(WorkLogEntry.objects.count(), 2)


class JobSheetMatchesTheSummaryTests(AutoEntryTestCase):
    """A job-sheet day (the entries list) and the period summary add up the same."""

    def test_ticket_activity_plus_manual_work_on_one_day(self):
        # The acceptance scenario: a ticket with one 2-hour activity resolved
        # by a staff member...
        self.create_ticket([self.activity(resolved_by=self.alice)])
        # ...plus 1 h 30 m of Non-AMS work logged by hand.
        self.client.post(ENTRIES_URL, {"start_time": "13:00", "end_time": "14:30"}, format="json")

        day = self.client.get(ENTRIES_URL, {"date": "2026-03-04"}).json()
        ams = [e for e in day if e["category"] == "ams"]
        self.assertEqual(len(ams), 1)
        self.assertEqual((ams[0]["hours"], ams[0]["is_auto"]), (2.0, True))
        self.assertEqual(ams[0]["ticket_reference"], "Ticket #152172RA2778834 — Troubleshooting")

        today = {p["key"]: p for p in self.client.get(SUMMARY_URL).json()["periods"]}["today"]
        self.assertEqual((today["ams_hours"], today["non_ams_hours"]), (2.0, 1.5))
        self.assertEqual(today["total_hours"], sum(e["hours"] for e in day))

        # An admin sees the same day for her.
        self.client.force_authenticate(self.admin)
        as_admin = self.client.get(ENTRIES_URL, {"date": "2026-03-04", "user_id": self.alice.pk}).json()
        self.assertEqual(as_admin, day)
