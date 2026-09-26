from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from decimal import Decimal
from unittest.mock import patch

from rest_framework.test import APITestCase

from accounts.models import User
from working_hours.models import WorkLogEntry
from working_hours.periods import build_periods, local_today

SUMMARY_URL = "/api/working-hours/summary/"
USERS_URL = "/api/working-hours/users/"


def make_entry(*, user, date, category, hours, start=time(9, 0)):
    """An entry lasting `hours` from `start` (entries are logged as start/end times)."""
    end = datetime.combine(date, start) + timedelta(minutes=round(float(hours) * 60))
    assert end.date() == date, "a test entry must not cross midnight"
    return WorkLogEntry.objects.create(
        user=user, date=date, category=category, start_time=start, end_time=end.time()
    )


class WorkingHoursPermissionTests(APITestCase):
    """Who may read whose summary / the user list, and how bad input is rejected."""

    def setUp(self):
        self.admin = User.objects.create_user("boss", password="pw", role=User.Role.ADMIN)
        self.alice = User.objects.create_user("alice", password="pw")
        self.bob = User.objects.create_user("bob", password="pw")
        # Everyone here shares the default zone, so this is "today" for every
        # viewer (the server's UTC date would differ for part of each day).
        today = local_today(self.alice)
        make_entry(
            user=self.alice, date=today, category="ams", hours=Decimal("5.50")
        )
        make_entry(
            user=self.alice, date=today, category="non_ams", hours=Decimal("2.25")
        )
        make_entry(user=self.bob, date=today, category="ams", hours=Decimal(3))

    def periods(self, response):
        return {p["key"]: p for p in response.json()["periods"]}

    def test_requires_authentication(self):
        self.assertEqual(self.client.get(SUMMARY_URL).status_code, 401)
        self.assertEqual(self.client.get(USERS_URL).status_code, 401)

    def test_staff_gets_own_summary_without_user_id(self):
        self.client.force_authenticate(self.alice)
        response = self.client.get(SUMMARY_URL)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["username"], "alice")
        today = self.periods(response)["today"]
        self.assertEqual(today["ams_hours"], 5.5)
        self.assertEqual(today["non_ams_hours"], 2.25)
        self.assertEqual(today["total_hours"], 7.75)
        self.assertEqual(today["goal_hours"], 8)
        self.assertEqual(today["percent_complete"], 97)

    def test_staff_may_name_themselves(self):
        self.client.force_authenticate(self.alice)
        response = self.client.get(SUMMARY_URL, {"user_id": self.alice.pk})
        self.assertEqual(response.status_code, 200)

    def test_staff_naming_another_user_is_forbidden(self):
        self.client.force_authenticate(self.alice)
        response = self.client.get(SUMMARY_URL, {"user_id": self.bob.pk})
        self.assertEqual(response.status_code, 403)

    def test_staff_cannot_list_users(self):
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.get(USERS_URL).status_code, 403)

    def test_admin_must_supply_user_id(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(SUMMARY_URL).status_code, 400)
        self.assertEqual(self.client.get(SUMMARY_URL, {"user_id": "abc"}).status_code, 400)
        self.assertEqual(self.client.get(SUMMARY_URL, {"user_id": 999999}).status_code, 404)

    def test_admin_can_read_any_user(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get(SUMMARY_URL, {"user_id": self.bob.pk})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["username"], "bob")
        self.assertEqual(self.periods(response)["today"]["total_hours"], 3.0)

    def test_admin_gets_400_not_500_for_malformed_user_ids(self):
        self.client.force_authenticate(self.admin)
        for bad in ["", " ", "abc", "-1", "0", "1.5", "1e3", "²", "١", "9" * 40, "1;DROP"]:
            with self.subTest(user_id=bad):
                response = self.client.get(SUMMARY_URL, {"user_id": bad})
                self.assertEqual(response.status_code, 400)
                self.assertIn("user_id", response.json())

    def test_inactive_user_is_not_found_even_for_admin(self):
        self.bob.is_active = False
        self.bob.save()
        self.client.force_authenticate(self.admin)

        response = self.client.get(SUMMARY_URL, {"user_id": self.bob.pk})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "User not found.")

    def test_user_list_excludes_inactive_users_and_admins(self):
        self.bob.is_active = False
        self.bob.save()
        User.objects.create_user("boss2", password="pw", role=User.Role.ADMIN)
        self.client.force_authenticate(self.admin)

        usernames = [u["username"] for u in self.client.get(USERS_URL).json()]

        self.assertEqual(usernames, ["alice"])

    def test_staff_with_garbage_user_id_is_forbidden(self):
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.get(SUMMARY_URL, {"user_id": "abc"}).status_code, 403)

    def test_admin_lists_staff_users_only(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get(USERS_URL)

        self.assertEqual(response.status_code, 200)
        self.assertEqual([u["username"] for u in response.json()], ["alice", "bob"])
        self.assertEqual(
            set(response.json()[0]),
            {"id", "username", "first_name", "last_name", "role", "timezone"},
        )


class PeriodBoundaryTests(APITestCase):
    """Calendar arithmetic for the six periods, independent of time zones."""

    def test_boundaries_for_a_mid_week_day(self):
        periods = {p.key: p for p in build_periods(date(2026, 3, 4))}  # a Wednesday

        self.assertEqual(periods["yesterday"].start, date(2026, 3, 3))
        self.assertEqual(
            (periods["currentWeek"].start, periods["currentWeek"].end),
            (date(2026, 3, 2), date(2026, 3, 8)),
        )
        self.assertEqual(
            (periods["lastWeek"].start, periods["lastWeek"].end),
            (date(2026, 2, 23), date(2026, 3, 1)),
        )
        self.assertEqual(periods["currentMonth"].end, date(2026, 3, 31))
        self.assertEqual(
            (periods["previousMonth"].start, periods["previousMonth"].end),
            (date(2026, 2, 1), date(2026, 2, 28)),
        )

    def test_january_previous_month_is_last_december(self):
        periods = {p.key: p for p in build_periods(date(2026, 1, 1))}
        self.assertEqual(periods["previousMonth"].start, date(2025, 12, 1))
        self.assertEqual(periods["yesterday"].start, date(2025, 12, 31))

    def test_entries_outside_a_period_are_not_counted(self):
        user = User.objects.create_user("carol", password="pw")
        today = local_today(user)
        make_entry(
            user=user, date=today - timedelta(days=400), category="ams", hours=Decimal(8)
        )
        self.client.force_authenticate(user)

        periods = self.client.get(SUMMARY_URL).json()["periods"]
        self.assertTrue(all(p["total_hours"] == 0 for p in periods))


class TimezoneBoundaryTests(APITestCase):
    """
    Period boundaries follow the VIEWER's time zone (the requester's), not the
    viewed user's. Fixture: 17:30 UTC on Mar 4 is already 01:30 on Mar 5 in
    Manila (UTC+8) but still 22:30 on Mar 4 in Malé (UTC+5).
    """

    INSTANT = datetime(2026, 3, 4, 17, 30, tzinfo=dt_timezone.utc)

    def setUp(self):
        self.manila = User.objects.create_user("manila", password="pw", timezone="Asia/Manila")
        self.male = User.objects.create_user("male", password="pw", timezone="Indian/Maldives")
        self.admin_in_male = User.objects.create_user(
            "boss", password="pw", role=User.Role.ADMIN, timezone="Indian/Maldives"
        )
        for user in (self.manila, self.male):
            make_entry(user=user, date=date(2026, 3, 4), category="ams", hours=3)
            make_entry(user=user, date=date(2026, 3, 5), category="ams", hours=5)

    def summary(self, viewer, instant=INSTANT, target=None):
        """GET the summary as `viewer` at a frozen instant; returns (body, periods by key)."""
        self.client.force_authenticate(viewer)
        params = {"user_id": target.pk} if target else {}
        with patch("django.utils.timezone.now", return_value=instant):
            response = self.client.get(SUMMARY_URL, params)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        return body, {p["key"]: p for p in body["periods"]}

    def test_staff_today_is_their_own_local_date(self):
        manila_body, manila = self.summary(self.manila)
        male_body, male = self.summary(self.male)

        self.assertEqual(manila_body["timezone"], "Asia/Manila")
        self.assertEqual(manila["today"]["start_date"], "2026-03-05")
        self.assertEqual(manila["today"]["total_hours"], 5.0)
        self.assertEqual(manila["yesterday"]["total_hours"], 3.0)
        self.assertEqual(male_body["timezone"], "Indian/Maldives")
        self.assertEqual(male["today"]["start_date"], "2026-03-04")
        self.assertEqual(male["today"]["total_hours"], 3.0)

    def test_staff_month_boundary_follows_their_own_zone(self):
        instant = datetime(2026, 2, 28, 17, 30, tzinfo=dt_timezone.utc)

        _, manila = self.summary(self.manila, instant)  # already Mar 1
        _, male = self.summary(self.male, instant)  # still Feb 28

        self.assertEqual(manila["currentMonth"]["start_date"], "2026-03-01")
        self.assertEqual(manila["previousMonth"]["start_date"], "2026-02-01")
        self.assertEqual(male["currentMonth"]["start_date"], "2026-02-01")

    def test_admin_sees_periods_in_their_own_zone(self):
        body, periods = self.summary(self.admin_in_male, target=self.manila)

        self.assertEqual(body["user"]["username"], "manila")  # whose data
        self.assertEqual(body["timezone"], "Indian/Maldives")  # whose calendar
        self.assertEqual(periods["today"]["start_date"], "2026-03-04")

    def test_admin_and_viewed_staff_get_different_boundaries_for_the_same_data(self):
        admin_body, as_admin = self.summary(self.admin_in_male, target=self.manila)
        own_body, as_self = self.summary(self.manila)

        # Same person's entries in both responses...
        self.assertEqual(admin_body["user"]["id"], own_body["user"]["id"])
        # ...but "Today" is Mar 4 (3h) for the admin in Malé and Mar 5 (5h)
        # for the staff member in Manila.
        self.assertEqual(
            (as_admin["today"]["start_date"], as_admin["today"]["total_hours"]),
            ("2026-03-04", 3.0),
        )
        self.assertEqual(
            (as_self["today"]["start_date"], as_self["today"]["total_hours"]),
            ("2026-03-05", 5.0),
        )
        self.assertEqual(as_admin["yesterday"]["start_date"], "2026-03-03")
        self.assertEqual(as_self["yesterday"]["start_date"], "2026-03-04")


ENTRIES_URL = "/api/working-hours/entries/"


def entry_url(entry_id):
    return f"{ENTRIES_URL}{entry_id}/"


def span(start, end, category="non_ams", **extra):
    """
    A manual entry body: {"start_time": "09:00", "end_time": "10:30", ...}.
    Non-AMS: AMS time only arrives from ticket activities (test_auto_entries.py).
    """
    return {"start_time": start, "end_time": end, "category": category, **extra}


class EntryTestCase(APITestCase):
    """
    Logging hours. Time is frozen at 06:00 UTC on Wed 4 Mar 2026 (14:00 in
    Kuala Lumpur, everyone's default zone), so "today" can't roll over mid-test.
    """

    INSTANT = datetime(2026, 3, 4, 6, 0, tzinfo=dt_timezone.utc)
    TODAY = date(2026, 3, 4)

    def setUp(self):
        clock = patch("django.utils.timezone.now", return_value=self.INSTANT)
        clock.start()
        self.addCleanup(clock.stop)
        self.admin = User.objects.create_user("boss", password="pw", role=User.Role.ADMIN)
        self.alice = User.objects.create_user("alice", password="pw")
        self.bob = User.objects.create_user("bob", password="pw")

    def log(self, body, user_id=None):
        url = f"{ENTRIES_URL}?user_id={user_id}" if user_id is not None else ENTRIES_URL
        return self.client.post(url, body, format="json")

    def periods(self, params=None):
        response = self.client.get(SUMMARY_URL, params or {})
        self.assertEqual(response.status_code, 200, response.content)
        return {p["key"]: p for p in response.json()["periods"]}


class StaffEntryTests(EntryTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.alice)

    def test_logs_own_entry_with_date_defaulting_to_their_today(self):
        response = self.log(span("09:15", "11:45", note="  LIS outage  "))

        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(
            {k: body[k] for k in ("user", "date", "start_time", "end_time", "category", "hours", "note")},
            {
                "user": self.alice.pk,
                "date": "2026-03-04",
                "start_time": "09:15",
                "end_time": "11:45",
                "category": "non_ams",
                "hours": 2.5,
                "note": "LIS outage",
            },
        )
        self.assertEqual(WorkLogEntry.objects.get().user, self.alice)

    def test_may_name_themselves(self):
        self.assertEqual(self.log(span("09:00", "10:00"), user_id=self.alice.pk).status_code, 201)

    def test_lists_own_entries_for_a_day_in_time_order(self):
        self.log(span("13:00", "15:00", "non_ams"))
        self.log(span("09:00", "10:00"))
        self.log(span("09:00", "12:00", date="2026-03-02"))
        make_entry(user=self.bob, date=self.TODAY, category="ams", hours=4)

        today = self.client.get(ENTRIES_URL).json()
        self.assertEqual(
            [(e["start_time"], e["end_time"], e["hours"]) for e in today],
            [("09:00", "10:00", 1.0), ("13:00", "15:00", 2.0)],
        )
        monday = self.client.get(ENTRIES_URL, {"date": "2026-03-02"}).json()
        self.assertEqual([e["hours"] for e in monday], [3.0])

    def test_edits_and_deletes_own_entry(self):
        entry_id = self.log(span("09:00", "11:00")).json()["id"]

        edited = self.client.patch(
            entry_url(entry_id), {"end_time": "12:45", "category": "non_ams"}, format="json"
        )
        self.assertEqual(edited.status_code, 200, edited.content)
        self.assertEqual(
            (edited.json()["end_time"], edited.json()["hours"], edited.json()["category"]),
            ("12:45", 3.75, "non_ams"),
        )

        self.assertEqual(self.client.delete(entry_url(entry_id)).status_code, 204)
        self.assertFalse(WorkLogEntry.objects.exists())

    def test_cannot_move_an_entry_to_someone_else(self):
        entry_id = self.log(span("09:00", "11:00")).json()["id"]
        self.client.patch(entry_url(entry_id), {"user": self.bob.pk}, format="json")
        self.assertEqual(WorkLogEntry.objects.get().user, self.alice)

    def test_targeting_another_user_is_forbidden(self):
        bobs = make_entry(user=self.bob, date=self.TODAY, category="ams", hours=4)

        self.assertEqual(self.log(span("09:00", "10:00"), user_id=self.bob.pk).status_code, 403)
        self.assertEqual(self.client.get(ENTRIES_URL, {"user_id": self.bob.pk}).status_code, 403)
        self.assertEqual(self.client.get(entry_url(bobs.pk)).status_code, 403)
        self.assertEqual(
            self.client.patch(entry_url(bobs.pk), {"end_time": "10:00"}, format="json").status_code, 403
        )
        self.assertEqual(self.client.delete(entry_url(bobs.pk)).status_code, 403)
        # Nothing was logged for, or changed on, Bob.
        self.assertEqual(list(WorkLogEntry.objects.values_list("user", "hours")), [(self.bob.pk, Decimal(4))])

    def test_garbage_user_id_is_forbidden_not_a_crash(self):
        self.assertEqual(self.log(span("09:00", "10:00"), user_id="abc").status_code, 403)

    def test_requires_authentication(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(ENTRIES_URL).status_code, 401)
        self.assertEqual(self.log(span("09:00", "10:00")).status_code, 401)


class AdminEntryTests(EntryTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.admin)

    def test_logs_for_any_active_user(self):
        response = self.log(span("14:00", "15:30", "non_ams"), user_id=self.bob.pk)

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["user"], self.bob.pk)
        self.assertEqual(WorkLogEntry.objects.get().user, self.bob)  # not the admin
        listed = self.client.get(ENTRIES_URL, {"user_id": self.bob.pk}).json()
        self.assertEqual([e["hours"] for e in listed], [1.5])

    def test_edits_and_deletes_anyones_entry(self):
        entry = make_entry(user=self.alice, date=self.TODAY, category="ams", hours=2)
        edited = self.client.patch(entry_url(entry.pk), {"end_time": "14:00"}, format="json")
        self.assertEqual((edited.status_code, edited.json()["hours"]), (200, 5.0))  # 09:00–14:00
        self.assertEqual(self.client.delete(entry_url(entry.pk)).status_code, 204)

    def test_must_name_a_user(self):
        self.assertEqual(self.log(span("09:00", "10:00")).status_code, 400)
        self.assertEqual(self.client.get(ENTRIES_URL).status_code, 400)
        self.assertEqual(self.log(span("09:00", "10:00"), user_id="-1").status_code, 400)
        self.assertEqual(self.log(span("09:00", "10:00"), user_id=999999).status_code, 404)
        self.assertFalse(WorkLogEntry.objects.exists())

    def test_deactivated_target_is_not_found(self):
        entry = make_entry(user=self.bob, date=self.TODAY, category="ams", hours=2)
        self.bob.is_active = False
        self.bob.save()

        self.assertEqual(self.log(span("09:00", "10:00"), user_id=self.bob.pk).status_code, 404)
        self.assertEqual(self.client.get(ENTRIES_URL, {"user_id": self.bob.pk}).status_code, 404)
        self.assertEqual(
            self.client.patch(entry_url(entry.pk), {"end_time": "10:00"}, format="json").status_code, 404
        )
        self.assertEqual(self.client.delete(entry_url(entry.pk)).status_code, 404)
        self.assertEqual(WorkLogEntry.objects.get().hours, 2)

    def test_default_date_is_the_admins_today_not_the_targets(self):
        # 17:30 UTC on Mar 4: already Mar 5 for an admin in Manila, still Mar 4 in Malé.
        manila_admin = User.objects.create_user(
            "manila_boss", password="pw", role=User.Role.ADMIN, timezone="Asia/Manila"
        )
        male = User.objects.create_user("male", password="pw", timezone="Indian/Maldives")
        self.client.force_authenticate(manila_admin)
        late = datetime(2026, 3, 4, 17, 30, tzinfo=dt_timezone.utc)
        with patch("django.utils.timezone.now", return_value=late):
            response = self.log(span("09:00", "10:00"), user_id=male.pk)
        self.assertEqual(response.json()["date"], "2026-03-05")


class EntryTimesTests(EntryTestCase):
    """Start/end times in, hours out: the duration is always the server's."""

    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.alice)

    def test_hours_are_computed_from_the_times(self):
        for start, end, hours in [
            ("09:00", "10:45", 1.75),
            ("09:00", "09:20", 0.33),  # 2 decimal places, rounded half up
            ("09:00", "09:10", 0.17),
            ("13:30", "13:31", 0.02),
            ("00:00", "23:59", 23.98),
        ]:
            with self.subTest(start=start, end=end):
                WorkLogEntry.objects.all().delete()
                response = self.log(span(start, end))
                self.assertEqual(response.status_code, 201, response.content)
                self.assertEqual(response.json()["hours"], hours)
                self.assertEqual(WorkLogEntry.objects.get().hours, Decimal(str(hours)))

    def test_client_supplied_hours_are_ignored(self):
        created = self.log(span("09:00", "10:00", hours=8))
        self.assertEqual(created.json()["hours"], 1.0)

        edited = self.client.patch(entry_url(created.json()["id"]), {"hours": 5}, format="json")
        self.assertEqual(edited.json()["hours"], 1.0)
        self.assertEqual(WorkLogEntry.objects.get().hours, Decimal("1.00"))

    def test_start_and_end_are_required(self):
        response = self.log({"category": "non_ams", "hours": 2})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.json()), {"start_time", "end_time"})
        self.assertIn("end_time", self.log({"category": "non_ams", "start_time": "09:00"}).json())

    def test_malformed_times_are_rejected(self):
        for bad in ["25:00", "9am", "", "12:60", None]:
            with self.subTest(end_time=bad):
                response = self.log({"category": "non_ams", "start_time": "09:00", "end_time": bad})
                self.assertEqual(response.status_code, 400)
                self.assertIn("end_time", response.json())

    def test_seconds_are_dropped(self):
        body = self.log(span("09:00:59", "10:30:10")).json()
        self.assertEqual((body["start_time"], body["end_time"], body["hours"]), ("09:00", "10:30", 1.5))

    def test_end_must_be_after_start_and_midnight_crossings_are_refused(self):
        for start, end in [("10:00", "10:00"), ("10:00", "09:00"), ("23:30", "00:15")]:
            with self.subTest(start=start, end=end):
                response = self.log(span(start, end))
                self.assertEqual(response.status_code, 400)
                self.assertEqual(
                    response.json(),
                    {
                        "end_time": [
                            "End time must be after the start time. For a shift that crosses "
                            "midnight, log it as two entries, one on each date."
                        ]
                    },
                )
        self.assertFalse(WorkLogEntry.objects.exists())

    def test_a_midnight_shift_as_two_entries_is_fine(self):
        self.assertEqual(self.log(span("23:30", "23:59", date="2026-03-03")).status_code, 201)
        self.assertEqual(self.log(span("00:00", "00:15")).status_code, 201)
        self.assertEqual(
            sorted(WorkLogEntry.objects.values_list("hours", flat=True)), [Decimal("0.25"), Decimal("0.48")]
        )

    def test_a_partial_edit_is_checked_against_the_stored_other_time(self):
        entry_id = self.log(span("09:00", "11:00")).json()["id"]
        refused = self.client.patch(entry_url(entry_id), {"start_time": "11:30"}, format="json")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("end_time", refused.json())
        moved = self.client.patch(entry_url(entry_id), {"start_time": "10:30"}, format="json")
        self.assertEqual(moved.json()["hours"], 0.5)

    def test_the_model_derives_hours_on_every_save(self):
        entry = WorkLogEntry.objects.create(
            user=self.alice, date=self.TODAY, category="ams", start_time=time(8, 0), end_time=time(9, 30), hours=99
        )
        self.assertEqual(entry.hours, Decimal("1.50"))
        entry.end_time = time(12, 0)
        entry.save(update_fields=["end_time"])
        entry.refresh_from_db()
        self.assertEqual(entry.hours, Decimal("4.00"))


class EntryValidationTests(EntryTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.alice)

    def test_a_day_cannot_exceed_24_hours_across_entries(self):
        make_entry(user=self.alice, date=self.TODAY, category="ams", hours=10, start=time(0, 0))
        make_entry(user=self.alice, date=self.TODAY, category="non_ams", hours=10, start=time(10, 0))

        fits = self.log(span("20:00", "23:59"))  # 3.98 h: 23.98 h in all
        self.assertEqual(fits.status_code, 201)
        full = self.log(span("20:00", "20:03"))  # 0.05 h more would be 24.03 h
        self.assertEqual(full.status_code, 400)
        self.assertEqual(
            full.json()["end_time"],
            ["23.98 h is already logged on this day; adding 0.05 h would go over the 24 h a day can hold."],
        )
        # Other days don't count toward this one.
        self.assertEqual(self.log(span("09:00", "17:00", date="2026-03-03")).status_code, 201)

    def test_other_peoples_hours_do_not_count_toward_the_limit(self):
        make_entry(user=self.bob, date=self.TODAY, category="ams", hours=20, start=time(0, 0))
        self.assertEqual(self.log(span("08:00", "18:00")).status_code, 201)

    def test_editing_an_entry_does_not_count_it_twice(self):
        make_entry(user=self.alice, date=self.TODAY, category="ams", hours=12, start=time(0, 0))
        first = self.log(span("12:00", "20:00")).json()["id"]  # 8 h; 20 h logged

        self.assertEqual(
            self.client.patch(entry_url(first), {"end_time": "23:59"}, format="json").status_code, 200
        )  # 11.98 h + 12 h: fits because its own 8 h isn't counted again

    def test_moving_an_entry_to_a_full_day_is_refused(self):
        make_entry(user=self.alice, date=date(2026, 3, 3), category="ams", hours=20, start=time(0, 0))
        entry = self.log(span("09:00", "14:00")).json()["id"]
        response = self.client.patch(entry_url(entry), {"date": "2026-03-03"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("end_time", response.json())

    def test_future_dates_are_refused(self):
        response = self.log(span("09:00", "10:00", date="2026-03-05"))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"date": ["You can't log hours for a future date."]})

    def test_category_and_date_format(self):
        self.assertIn("category", self.log(span("09:00", "10:00", "overtime")).json())
        self.assertIn("category", self.log({"start_time": "09:00", "end_time": "10:00"}).json())
        self.assertIn("date", self.log(span("09:00", "10:00", date="04/03/2026")).json())
        for bad in ["yesterday", "2026-02-30"]:
            with self.subTest(date=bad):
                self.assertEqual(self.client.get(ENTRIES_URL, {"date": bad}).status_code, 400)

    def test_note_is_optional_and_bounded(self):
        self.assertEqual(self.log(span("09:00", "10:00")).json()["note"], "")
        self.assertEqual(self.log(span("10:00", "11:00", note="x" * 201)).status_code, 400)

    def test_put_is_not_offered(self):
        entry = self.log(span("09:00", "10:00")).json()["id"]
        response = self.client.put(entry_url(entry), span("09:00", "11:00"), format="json")
        self.assertEqual(response.status_code, 405)


class LoggedHoursReachTheSummaryTests(EntryTestCase):
    """The write path (entries) and the read path (summary) see the same data."""

    def test_logged_edited_and_deleted_entries_show_in_the_period_totals(self):
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.periods()["today"]["total_hours"], 0)

        first = self.log(span("09:00", "11:30")).json()["id"]  # 2.5 h
        self.log(span("13:00", "14:15"))  # 1.25 h
        self.log(span("09:00", "12:00", date="2026-03-03"))  # yesterday, 3 h
        self.log(span("08:00", "12:00", date="2026-02-27"))  # last week + last month, 4 h

        periods = self.periods()
        today = periods["today"]
        self.assertEqual(
            (today["ams_hours"], today["non_ams_hours"], today["total_hours"], today["percent_complete"]),
            (0.0, 3.75, 3.75, 47),
        )
        self.assertEqual(periods["yesterday"]["total_hours"], 3.0)
        self.assertEqual(periods["currentWeek"]["total_hours"], 6.75)  # Mon 2 – Sun 8 Mar
        self.assertEqual(periods["lastWeek"]["total_hours"], 4.0)
        self.assertEqual(periods["currentMonth"]["total_hours"], 6.75)
        self.assertEqual(periods["previousMonth"]["total_hours"], 4.0)

        # Editing a time and deleting an entry are reflected just the same.
        self.client.patch(entry_url(first), {"end_time": "12:00"}, format="json")  # now 3 h
        self.assertEqual(self.periods()["today"]["non_ams_hours"], 4.25)
        self.client.delete(entry_url(first))
        self.assertEqual(self.periods()["today"]["total_hours"], 1.25)

    def test_hours_an_admin_logs_for_staff_count_for_that_staff_member_only(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.log(span("08:00", "14:00"), user_id=self.bob.pk).status_code, 201)
        self.assertEqual(self.periods({"user_id": self.bob.pk})["today"]["non_ams_hours"], 6.0)

        self.client.force_authenticate(self.bob)
        self.assertEqual(self.periods()["today"]["non_ams_hours"], 6.0)
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.periods()["today"]["total_hours"], 0)
