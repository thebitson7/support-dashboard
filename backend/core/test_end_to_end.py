"""
End-to-end: one piece of work, seen from every layer that shows it.

A ticket activity with a resolver must agree, to the minute, across the
ticket's own total, the resolver's Job Sheet (entries for the day), their
Working Hours summary and the Reports team activity (JSON and CSV). A manual
entry must show up as Non-AMS everywhere, and a deactivated user must leave
the "everyone" views while their history stays readable.

Everything goes through the real API, as the frontend calls it.
"""

import csv
import io
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

from rest_framework.test import APITestCase

from accounts.models import User
from tickets.models import Customer, Site, WorkDoneCode

UTC = dt_timezone.utc
# 06:00 UTC on Wed 4 Mar 2026 = 14:00 in Kuala Lumpur (everyone's zone here).
NOW = datetime(2026, 3, 4, 6, 0, tzinfo=UTC)
DAY = "2026-03-04"
MARCH = {"start_date": "2026-03-01", "end_date": "2026-03-31"}


def csv_rows(response):
    return list(csv.reader(io.StringIO(response.content.decode("utf-8").lstrip("﻿"))))


class WorkAcrossLayersTests(APITestCase):
    def setUp(self):
        clock = patch("django.utils.timezone.now", return_value=NOW)
        clock.start()
        self.addCleanup(clock.stop)
        self.admin = User.objects.create_user("boss", password="pw", role=User.Role.ADMIN)
        self.syed = User.objects.create_user("syed", password="pw", first_name="Syed", last_name="Hussain")
        self.site = Site.objects.create(name="Tan Tock Seng Hospital", ocn="OCN05529-801-00")
        self.customer = Customer.objects.create(name="SingHealth")
        self.code = WorkDoneCode.objects.create(code="RMD", description="Remote Diagnostic")

    # --- helpers: the same calls the pages make ----------------------------------

    def as_user(self, user):
        self.client.force_authenticate(user)

    def activity(self, start_utc, minutes, resolver):
        return {
            "activity_type": "troubleshooting",
            "start_at": start_utc.isoformat(),
            "end_at": (start_utc + timedelta(minutes=minutes)).isoformat(),
            "work_done_code": self.code.pk,
            "resolved_by": resolver.pk if resolver else None,
        }

    def create_ticket(self, activities):
        response = self.client.post(
            "/api/tickets/",
            {
                "received_at": NOW.isoformat(),
                "cms_next_ticket_no": "152172RA2778834",
                "site": self.site.pk,
                "customer": self.customer.pk,
                "assigned_to": self.syed.pk,
                "ticket_type": "software",
                "incoming_channel": "email",
                "cms_added_on": NOW.isoformat(),
                "issue_description": "Analyzer stops sending results.",
                "notes": "Reported this morning.",
                "activities": activities,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["id"]

    def job_sheet(self, user, day=DAY):
        self.as_user(self.admin)
        response = self.client.get("/api/working-hours/entries/", {"date": day, "user_id": user.pk})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def today(self, user):
        self.as_user(self.admin)
        periods = self.client.get("/api/working-hours/summary/", {"user_id": user.pk}).json()["periods"]
        return {p["key"]: p for p in periods}["today"]

    def report_row(self, user):
        self.as_user(self.admin)
        members = self.client.get("/api/reports/team-activity/", MARCH).json()["members"]
        return next((m for m in members if m["user"]["id"] == user.pk), None)

    @staticmethod
    def minutes(entry):
        (sh, sm), (eh, em) = (map(int, entry[k].split(":")) for k in ("start_time", "end_time"))
        return eh * 60 + em - (sh * 60 + sm)

    # --- the walkthroughs ------------------------------------------------------------

    def test_a_ticket_activity_agrees_everywhere(self):
        self.as_user(self.syed)  # staff create tickets
        ticket_id = self.create_ticket(
            [
                self.activity(datetime(2026, 3, 4, 1, 0, tzinfo=UTC), 105, self.syed),  # 09:00–10:45 KL
                self.activity(datetime(2026, 3, 4, 3, 0, tzinfo=UTC), 20, self.syed),  # 11:00–11:20
                self.activity(datetime(2026, 3, 4, 4, 0, tzinfo=UTC), 60, None),  # nobody's time
            ]
        )

        # 1. The ticket's own total: all three activities, 185 min.
        ticket = self.client.get(f"/api/tickets/{ticket_id}/").json()
        self.assertEqual(ticket["total_duration_hours"], 3.08)  # 185 / 60, to 2 decimals

        # 2. Syed's Job Sheet: his two resolved activities, as AMS auto entries.
        sheet = self.job_sheet(self.syed)
        self.assertEqual(
            [(e["start_time"], e["end_time"], e["category"], e["is_auto"]) for e in sheet],
            [("09:00", "10:45", "ams", True), ("11:00", "11:20", "ams", True)],
        )
        self.assertEqual(sum(self.minutes(e) for e in sheet), 125)

        # 3. His Working Hours summary, Today.
        today = self.today(self.syed)
        self.assertEqual((today["ams_minutes"], today["non_ams_minutes"], today["total_minutes"]), (125, 0, 125))

        # 4. Reports, for a range including the day.
        row = self.report_row(self.syed)
        self.assertEqual((row["ams_minutes"], row["total_minutes"], row["entry_count"]), (125, 125, 2))

        # The ticket counts the unresolved hour; the people it resolved don't.
        self.assertEqual(round(185 / 60, 2), ticket["total_duration_hours"])
        self.assertEqual(sum(self.minutes(e) for e in sheet) + 60, 185)

    def test_a_manual_entry_is_non_ams_everywhere(self):
        self.as_user(self.syed)
        self.create_ticket([self.activity(datetime(2026, 3, 4, 1, 0, tzinfo=UTC), 60, self.syed)])
        logged = self.client.post(
            "/api/working-hours/entries/",
            {"start_time": "15:00", "end_time": "15:40", "note": "Team meeting"},
            format="json",
        )
        self.assertEqual((logged.status_code, logged.json()["category"]), (201, "non_ams"))

        sheet = self.job_sheet(self.syed)
        manual = [e for e in sheet if not e["is_auto"]]
        self.assertEqual([(e["category"], self.minutes(e), e["note"]) for e in manual], [("non_ams", 40, "Team meeting")])

        today = self.today(self.syed)
        self.assertEqual((today["ams_minutes"], today["non_ams_minutes"]), (60, 40))
        row = self.report_row(self.syed)
        self.assertEqual((row["ams_minutes"], row["non_ams_minutes"], row["entry_count"]), (60, 40, 2))

        # And never as AMS: the manual API refuses AMS outright.
        self.as_user(self.syed)
        refused = self.client.post(
            "/api/working-hours/entries/",
            {"category": "ams", "start_time": "16:00", "end_time": "17:00"},
            format="json",
        )
        self.assertEqual(refused.status_code, 400)

    def test_a_deactivated_user_leaves_lists_but_keeps_their_history(self):
        self.as_user(self.syed)
        ticket_id = self.create_ticket([self.activity(datetime(2026, 3, 4, 1, 0, tzinfo=UTC), 90, self.syed)])
        self.syed.is_active = False
        self.syed.save()

        self.as_user(self.admin)
        # Gone from the "everyone" views...
        staff = self.client.get("/api/working-hours/users/").json()
        self.assertNotIn(self.syed.pk, [u["id"] for u in staff])
        self.assertIsNone(self.report_row(self.syed))
        self.assertNotIn(self.syed.pk, [u["id"] for u in self.client.get("/api/accounts/users/").json()])
        # ...but their history is where it was.
        self.assertEqual(sum(self.minutes(e) for e in self.job_sheet(self.syed)), 90)
        self.assertEqual(self.today(self.syed)["ams_minutes"], 90)
        drill = self.client.get("/api/reports/team-activity/", {**MARCH, "user_id": self.syed.pk}).json()
        self.assertEqual((drill["member"]["is_active"], drill["member"]["ams_minutes"]), (False, 90))
        ticket = self.client.get(f"/api/tickets/{ticket_id}/").json()
        self.assertEqual(ticket["assigned_to"]["username"], "syed")
        self.assertEqual(ticket["activities"][0]["resolved_by"]["username"], "syed")

    def test_both_csv_exports_add_up_to_the_database(self):
        self.as_user(self.syed)
        self.create_ticket(
            [
                self.activity(datetime(2026, 3, 4, 1, 0, tzinfo=UTC), 20, self.syed),
                self.activity(datetime(2026, 3, 4, 2, 0, tzinfo=UTC), 20, self.syed),
                self.activity(datetime(2026, 3, 4, 3, 0, tzinfo=UTC), 20, self.syed),
            ]
        )
        self.client.post("/api/working-hours/entries/", {"start_time": "15:00", "end_time": "15:20"}, format="json")

        self.as_user(self.admin)
        row = self.report_row(self.syed)
        team = csv_rows(self.client.get("/api/reports/team-activity/export/", MARCH))
        header, lines = team[0], team[1:]
        self.assertEqual(len(lines), row["entry_count"])
        # Exact: 4 x 20 min = 80 min, even though each row's Hours reads 0.33.
        self.assertEqual(sum(int(r[header.index("Minutes")]) for r in lines), row["total_minutes"])
        self.assertEqual(row["total_minutes"], 80)
        # Regression: the Working Hours summary used to add the rounded hours
        # (4 x 0.33 = 1.32 h, shown as 1h 19m); it now agrees with Reports.
        today = self.today(self.syed)
        self.assertEqual((today["total_minutes"], today["total_hours"]), (80, 1.33))

        tickets = csv_rows(self.client.get("/api/tickets/export/"))
        self.assertEqual(len(tickets) - 1, 1)
        self.assertEqual(tickets[1][tickets[0].index("Total Duration (Hours)")], "1.00")  # 60 min
