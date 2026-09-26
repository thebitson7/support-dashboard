import csv
import io
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from decimal import Decimal
from unittest.mock import patch

from rest_framework.test import APITestCase

from accounts.models import User
from tickets.models import Customer, Site, Ticket, TicketActivity, WorkDoneCode
from working_hours.models import WorkLogEntry

REPORT_URL = "/api/reports/team-activity/"
EXPORT_URL = "/api/reports/team-activity/export/"
TICKETS_EXPORT_URL = "/api/tickets/export/"
# 06:00 UTC on Wed 4 Mar 2026: 14:00 in Kuala Lumpur (the default zone).
NOW = datetime(2026, 3, 4, 6, 0, tzinfo=dt_timezone.utc)


def read_csv(response):
    """(header, rows) of a CSV response, checking it's a UTF-8 (BOM) attachment."""
    body = response.content.decode("utf-8")
    assert body.startswith("﻿"), "CSV should start with a UTF-8 BOM"
    rows = list(csv.reader(io.StringIO(body[1:])))
    return rows[0], rows[1:]


class ReportTestCase(APITestCase):
    def setUp(self):
        clock = patch("django.utils.timezone.now", return_value=NOW)
        clock.start()
        self.addCleanup(clock.stop)
        self.admin = User.objects.create_user("boss", password="pw", role=User.Role.ADMIN)
        self.alice = User.objects.create_user("alice", password="pw", first_name="Alice", last_name="Tan")
        self.bob = User.objects.create_user("bob", password="pw", first_name="Bob", last_name="Lim")
        self.site = Site.objects.create(name="Tan Tock Seng Hospital", ocn="OCN05529-801-00")
        self.customer = Customer.objects.create(name="SingHealth")
        self.code = WorkDoneCode.objects.create(code="RMD", description="Remote Diagnostic")
        self.client.force_authenticate(self.admin)

    def ticket(self, number="152172RA2778834", **fields):
        defaults = {
            "received_at": NOW,
            "cms_next_ticket_no": number,
            "site": self.site,
            "customer": self.customer,
            "assigned_to": self.alice,
            "ticket_type": "software",
            "incoming_channel": "email",
            "cms_added_on": NOW,
            "issue_description": "i",
            "notes": "n",
            "created_by": self.alice,
        }
        defaults.update(fields)
        return Ticket.objects.create(**defaults)

    def auto(self, user, start_utc, minutes, ticket=None):
        """An auto entry, through the real sync (a single activity save fires it)."""
        TicketActivity.objects.create(
            ticket=ticket or self.ticket(),
            activity_type="troubleshooting",
            start_at=start_utc,
            end_at=start_utc + timedelta(minutes=minutes),
            work_done_code=self.code,
            resolved_by=user,
        )

    def manual(self, user, day, start, end, note=""):
        return WorkLogEntry.objects.create(
            user=user, date=day, category="non_ams", start_time=start, end_time=end, note=note
        )


class TeamActivityPermissionTests(ReportTestCase):
    def test_admin_only(self):
        self.assertEqual(self.client.get(REPORT_URL).status_code, 200)
        self.assertEqual(self.client.get(EXPORT_URL).status_code, 200)

        self.client.force_authenticate(self.alice)
        for url in (REPORT_URL, EXPORT_URL, f"{REPORT_URL}?user_id={self.alice.pk}"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 403)

        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(REPORT_URL).status_code, 401)
        self.assertEqual(self.client.get(EXPORT_URL).status_code, 401)


class TeamActivityAggregationTests(ReportTestCase):
    """
    March 2026. Alice: two auto entries (2 h + 1 h 30 m) and one manual
    Non-AMS entry (45 m); plus one entry in February that must not count.
    Bob: one manual entry (8 h). Carol (deactivated) and the admin also have
    entries, which the "everyone" view leaves out.
    """

    def setUp(self):
        super().setUp()
        self.auto(self.alice, datetime(2026, 3, 2, 1, 0, tzinfo=dt_timezone.utc), 120)  # 09:00–11:00 KL
        self.auto(self.alice, datetime(2026, 3, 3, 6, 0, tzinfo=dt_timezone.utc), 90)  # 14:00–15:30 KL
        self.manual(self.alice, date(2026, 3, 3), time(16, 0), time(16, 45), note="Team meeting")
        self.manual(self.alice, date(2026, 2, 27), time(9, 0), time(12, 0))  # outside the range
        self.manual(self.bob, date(2026, 3, 4), time(9, 0), time(17, 0))
        self.carol = User.objects.create_user("carol", password="pw", first_name="Carol")
        self.manual(self.carol, date(2026, 3, 2), time(9, 0), time(10, 0))
        self.carol.is_active = False
        self.carol.save()
        self.manual(self.admin, date(2026, 3, 2), time(9, 0), time(10, 0))

    def get(self, **params):
        response = self.client.get(REPORT_URL, params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_everyone_totals_and_split(self):
        body = self.get(start_date="2026-03-01", end_date="2026-03-31")

        rows = {m["user"]["username"]: m for m in body["members"]}
        self.assertEqual(list(rows), ["alice", "bob"])  # active staff only, by name
        self.assertEqual(
            {k: rows["alice"][k] for k in ("total_hours", "ams_hours", "non_ams_hours", "entry_count")},
            {"total_hours": 4.25, "ams_hours": 3.5, "non_ams_hours": 0.75, "entry_count": 3},
        )
        self.assertEqual(
            {k: rows["bob"][k] for k in ("total_hours", "ams_hours", "non_ams_hours", "entry_count")},
            {"total_hours": 8.0, "ams_hours": 0.0, "non_ams_hours": 8.0, "entry_count": 1},
        )
        self.assertEqual(
            body["totals"],
            {
                "member_count": 2,
                "total_minutes": 735,
                "ams_minutes": 210,
                "non_ams_minutes": 525,
                "total_hours": 12.25,
                "ams_hours": 3.5,
                "non_ams_hours": 8.75,
                "entry_count": 4,
            },
        )
        self.assertEqual((body["start_date"], body["end_date"]), ("2026-03-01", "2026-03-31"))

    def test_staff_who_logged_nothing_are_listed_with_zeros(self):
        User.objects.create_user("dave", password="pw", first_name="Dave")
        dave = next(m for m in self.get()["members"] if m["user"]["username"] == "dave")
        self.assertEqual((dave["total_hours"], dave["entry_count"]), (0.0, 0))

    def test_the_range_bounds_are_inclusive(self):
        body = self.get(start_date="2026-03-03", end_date="2026-03-03")
        alice = body["members"][0]
        self.assertEqual((alice["total_hours"], alice["entry_count"]), (2.25, 2))  # 1 h 30 m + 45 m

    def test_everyone_is_one_query_however_many_people(self):
        for n in range(5):
            User.objects.create_user(f"extra{n}", password="pw")
        # The one grouped query (force_authenticate costs none); not one per person.
        with self.assertNumQueries(1):
            self.client.get(REPORT_URL)

    def test_drill_down_returns_that_persons_totals_and_entries(self):
        body = self.get(start_date="2026-03-01", end_date="2026-03-31", user_id=self.alice.pk)

        self.assertEqual(body["member"]["user"]["username"], "alice")
        self.assertEqual(
            (body["member"]["total_hours"], body["member"]["ams_hours"], body["member"]["non_ams_hours"]),
            (4.25, 3.5, 0.75),
        )
        self.assertEqual(
            [(e["date"], e["start_time"], e["end_time"], e["category"], e["is_auto"], e["ticket_reference"]) for e in body["entries"]],
            [
                ("2026-03-02", "09:00", "11:00", "ams", True, "Ticket #152172RA2778834 — Troubleshooting"),
                ("2026-03-03", "14:00", "15:30", "ams", True, "Ticket #152172RA2778834 — Troubleshooting"),
                ("2026-03-03", "16:00", "16:45", "non_ams", False, None),
            ],
        )

    def test_a_deactivated_users_history_is_still_reachable_by_id(self):
        body = self.get(user_id=self.carol.pk)
        self.assertEqual((body["member"]["is_active"], body["member"]["total_hours"]), (False, 1.0))
        self.assertEqual(len(body["entries"]), 1)

    def test_drill_down_errors(self):
        self.assertEqual(self.client.get(REPORT_URL, {"user_id": 999999}).status_code, 404)
        for bad in ["abc", "-1", "0", "²", "9" * 40]:
            with self.subTest(user_id=bad):
                self.assertEqual(self.client.get(REPORT_URL, {"user_id": bad}).status_code, 400)


class TeamActivityRangeTests(ReportTestCase):
    def test_defaults_to_the_current_month_in_the_admins_zone(self):
        body = self.client.get(REPORT_URL).json()
        self.assertEqual((body["start_date"], body["end_date"], body["timezone"]), ("2026-03-01", "2026-03-31", "Asia/Kuala_Lumpur"))

        # 17:30 UTC on 28 Feb: already 1 March in Manila, still February in Malé.
        late = datetime(2026, 2, 28, 17, 30, tzinfo=dt_timezone.utc)
        for zone, month in [("Asia/Manila", ("2026-03-01", "2026-03-31")), ("Indian/Maldives", ("2026-02-01", "2026-02-28"))]:
            with self.subTest(zone=zone):
                self.admin.timezone = zone
                self.admin.save()
                with patch("django.utils.timezone.now", return_value=late):
                    body = self.client.get(REPORT_URL).json()
                self.assertEqual((body["start_date"], body["end_date"]), month)

    def test_validation(self):
        cases = [
            ({"start_date": "2026-03-10", "end_date": "2026-03-09"}, "end_date"),
            ({"start_date": "2025-01-01", "end_date": "2026-01-02"}, "end_date"),  # 367 days
            ({"start_date": "2026-02-30"}, "start_date"),
            ({"end_date": "March"}, "end_date"),
        ]
        for params, field in cases:
            with self.subTest(params=params):
                for url in (REPORT_URL, EXPORT_URL):
                    response = self.client.get(url, params)
                    self.assertEqual(response.status_code, 400)
                    self.assertIn(field, response.json())

    def test_a_full_year_is_allowed(self):
        response = self.client.get(REPORT_URL, {"start_date": "2025-03-05", "end_date": "2026-03-05"})  # 366 days
        self.assertEqual(response.status_code, 200)


class TeamActivityExportTests(ReportTestCase):
    def setUp(self):
        super().setUp()
        self.auto(self.alice, datetime(2026, 3, 2, 1, 0, tzinfo=dt_timezone.utc), 120)
        self.manual(self.alice, date(2026, 3, 3), time(16, 0), time(16, 45), note="=HYPERLINK(\"x\")")
        self.manual(self.bob, date(2026, 3, 4), time(9, 0), time(17, 0), note="Site visit, Penang")
        self.manual(self.bob, date(2026, 4, 1), time(9, 0), time(10, 0))  # outside the range

    def test_everyone(self):
        response = self.client.get(EXPORT_URL, {"start_date": "2026-03-01", "end_date": "2026-03-31"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/csv; charset=utf-8")
        self.assertEqual(
            response["Content-Disposition"], 'attachment; filename="team-activity_2026-03-01_2026-03-31.csv"'
        )
        header, rows = read_csv(response)
        self.assertEqual(
            header, ["User", "Date", "Start Time", "End Time", "Category", "Hours", "Minutes", "Source", "Note"]
        )
        self.assertEqual(
            rows,
            [
                ["Alice Tan", "2026-03-02", "09:00", "11:00", "AMS", "2.00", "120", "Ticket #152172RA2778834 — Troubleshooting", ""],
                # A note that looks like a formula is kept as text.
                ["Alice Tan", "2026-03-03", "16:00", "16:45", "Non-AMS", "0.75", "45", "Manual", "'=HYPERLINK(\"x\")"],
                ["Bob Lim", "2026-03-04", "09:00", "17:00", "Non-AMS", "8.00", "480", "Manual", "Site visit, Penang"],
            ],
        )

    def test_one_person(self):
        response = self.client.get(
            EXPORT_URL, {"start_date": "2026-03-01", "end_date": "2026-04-30", "user_id": self.bob.pk}
        )
        self.assertEqual(
            response["Content-Disposition"], 'attachment; filename="team-activity_bob_2026-03-01_2026-04-30.csv"'
        )
        _, rows = read_csv(response)
        self.assertEqual([(r[0], r[1]) for r in rows], [("Bob Lim", "2026-03-04"), ("Bob Lim", "2026-04-01")])


class TicketExportTests(ReportTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.alice)  # any signed-in user may export
        self.open = self.ticket("100OPEN", received_at=datetime(2026, 3, 1, 1, 30, tzinfo=dt_timezone.utc))
        self.closed = self.ticket(
            "200CLOSED",
            received_at=datetime(2026, 3, 2, 2, 0, tzinfo=dt_timezone.utc),
            is_pre=True,
            total_duration_hours=1.5,
            resolution_verified_by=self.bob,
            resolution_verified_on=NOW,
            cms_closed_by=self.bob,
            cms_closed_on=datetime(2026, 3, 3, 10, 0, tzinfo=dt_timezone.utc),
            service_closed_date=NOW,
        )
        self.other_site = self.ticket(
            "300ELSEWHERE", site=Site.objects.create(name="=cmd|' /C calc'!A0", ocn="OCN1")
        )

    def test_all_matching_rows_with_the_tables_columns(self):
        response = self.client.get(TICKETS_EXPORT_URL, {"page_size": 1, "ordering": "received_at"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Disposition"], 'attachment; filename="tickets-2026-03-04.csv"')
        header, rows = read_csv(response)
        self.assertEqual(
            header,
            [
                "Site Name",
                "Site OCN",
                "CMS Next Ticket No",
                "Ticket Received Date Time (Asia/Kuala_Lumpur)",
                "Status",
                "Pre",
                "Ticket Closed By",
                "Created By",
                "Total Duration (Hours)",
                "CMS Ticket Closed On (Asia/Kuala_Lumpur)",
                "Service Closed Date (Asia/Kuala_Lumpur)",
            ],
        )
        # Every row despite page_size=1, in the requested order.
        self.assertEqual([r[2] for r in rows], ["100OPEN", "200CLOSED", "300ELSEWHERE"])
        self.assertEqual(
            rows[1],
            [
                "Tan Tock Seng Hospital",
                "OCN05529-801-00",
                "200CLOSED",
                "2026-03-02 10:00",  # 02:00 UTC in Kuala Lumpur
                "Closed",
                "Yes",
                "Bob Lim",
                "Alice Tan",
                "1.50",
                "2026-03-03 18:00",
                "2026-03-04 14:00",
            ],
        )
        self.assertEqual(rows[0][4:7], ["Open", "No", ""])
        self.assertEqual(rows[2][0], "'=cmd|' /C calc'!A0")  # formula-looking text neutralised

    def test_the_lists_filters_and_search_apply(self):
        _, closed = read_csv(self.client.get(TICKETS_EXPORT_URL, {"status": "closed"}))
        self.assertEqual([r[2] for r in closed], ["200CLOSED"])

        _, by_site = read_csv(self.client.get(TICKETS_EXPORT_URL, {"site": self.site.pk, "search": "open"}))
        self.assertEqual([r[2] for r in by_site], ["100OPEN"])

        _, by_date = read_csv(
            self.client.get(TICKETS_EXPORT_URL, {"received_before": "2026-03-01T12:00:00+08:00"})
        )
        self.assertEqual([r[2] for r in by_date], ["100OPEN"])

    def test_the_lists_validation_applies(self):
        self.assertEqual(self.client.get(TICKETS_EXPORT_URL, {"status": "pending"}).status_code, 400)
        self.assertEqual(self.client.get(TICKETS_EXPORT_URL, {"ordering": "nope"}).status_code, 400)

    def test_times_follow_the_requesters_zone(self):
        self.alice.timezone = "Indian/Maldives"
        self.alice.save()
        header, rows = read_csv(self.client.get(TICKETS_EXPORT_URL, {"status": "closed"}))
        self.assertEqual(header[3], "Ticket Received Date Time (Indian/Maldives)")
        self.assertEqual(rows[0][3], "2026-03-02 07:00")

    def test_requires_authentication(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(TICKETS_EXPORT_URL).status_code, 401)


class ExactTotalsRegressionTests(ReportTestCase):
    """
    Regression: totals used to be summed from each entry's stored `hours`,
    rounded to 0.01 h, so short entries drifted (six 20-minute entries gave
    1.98 h, shown as 1h 59m, while the drill-down, built from the times,
    said 2h 00m). Totals now come from exact minutes.
    """

    def setUp(self):
        super().setUp()
        ticket = self.ticket()
        for n in range(3):  # three 20-minute ticket activities: auto AMS entries
            self.auto(self.alice, datetime(2026, 3, 5, 1 + n, 0, tzinfo=dt_timezone.utc), 20, ticket=ticket)
        for n in range(3):  # three 20-minute manual entries
            self.manual(self.alice, date(2026, 3, 6), time(9, 20 * n), time(9 + (20 * n + 20) // 60, (20 * n + 20) % 60))
        self.assertEqual(sum(WorkLogEntry.objects.values_list("hours", flat=True)), Decimal("1.98"))

    def test_overview_and_totals_row_are_exact(self):
        body = self.client.get(REPORT_URL, {"start_date": "2026-03-01", "end_date": "2026-03-31"}).json()
        alice = next(m for m in body["members"] if m["user"]["username"] == "alice")
        self.assertEqual(
            (alice["total_minutes"], alice["ams_minutes"], alice["non_ams_minutes"], alice["total_hours"]),
            (120, 60, 60, 2.0),
        )
        self.assertEqual((body["totals"]["total_minutes"], body["totals"]["total_hours"]), (120, 2.0))

    def test_overview_row_equals_its_drill_down(self):
        params = {"start_date": "2026-03-01", "end_date": "2026-03-31"}
        overview = next(
            m for m in self.client.get(REPORT_URL, params).json()["members"] if m["user"]["username"] == "alice"
        )
        detail = self.client.get(REPORT_URL, {**params, "user_id": self.alice.pk}).json()

        def span(e):
            (sh, sm), (eh, em) = map(int, e["start_time"].split(":")), map(int, e["end_time"].split(":"))
            return eh * 60 + em - (sh * 60 + sm)

        self.assertEqual(detail["member"]["total_minutes"], overview["total_minutes"])
        self.assertEqual(sum(span(e) for e in detail["entries"]), overview["total_minutes"])

    def test_csv_minutes_add_up_to_the_report(self):
        _, rows = read_csv(self.client.get(EXPORT_URL, {"start_date": "2026-03-01", "end_date": "2026-03-31"}))
        self.assertEqual(sum(int(r[6]) for r in rows), 120)
        self.assertEqual({r[5] for r in rows}, {"0.33"})  # each row still reads in hours


class TicketExportZoneRegressionTests(ReportTestCase):
    """
    Regression: the table on screen shows times in the browser's zone, but the
    CSV used the profile's, so the two disagreed whenever they differed. The
    page now passes its zone as `tz`.
    """

    def setUp(self):
        super().setUp()
        self.ticket("Z1", received_at=datetime(2026, 3, 2, 2, 0, tzinfo=dt_timezone.utc))

    def test_times_follow_the_given_zone(self):
        header, rows = read_csv(self.client.get(TICKETS_EXPORT_URL, {"tz": "Asia/Manila"}))
        self.assertEqual(header[3], "Ticket Received Date Time (Asia/Manila)")
        self.assertEqual(rows[0][3], "2026-03-02 10:00")
        header, rows = read_csv(self.client.get(TICKETS_EXPORT_URL, {"tz": "Europe/London"}))
        self.assertEqual((header[3], rows[0][3]), ("Ticket Received Date Time (Europe/London)", "2026-03-02 02:00"))

    def test_without_tz_the_profile_zone_is_used(self):
        header, rows = read_csv(self.client.get(TICKETS_EXPORT_URL))
        self.assertEqual((header[3], rows[0][3]), ("Ticket Received Date Time (Asia/Kuala_Lumpur)", "2026-03-02 10:00"))

    def test_a_bad_zone_is_a_400(self):
        for bad in ["Mars/Olympus", "../../etc/passwd", "UTC+8"]:
            with self.subTest(tz=bad):
                response = self.client.get(TICKETS_EXPORT_URL, {"tz": bad})
                self.assertEqual(response.status_code, 400)
                self.assertIn("tz", response.json())

