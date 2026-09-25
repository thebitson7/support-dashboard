from datetime import date, datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from unittest.mock import patch

from rest_framework.test import APITestCase

from accounts.models import User
from working_hours.models import WorkLogEntry
from working_hours.periods import build_periods, local_today

SUMMARY_URL = "/api/working-hours/summary/"
USERS_URL = "/api/working-hours/users/"


class WorkingHoursPermissionTests(APITestCase):
    """Who may read whose summary / the user list, and how bad input is rejected."""

    def setUp(self):
        self.admin = User.objects.create_user("boss", password="pw", role=User.Role.ADMIN)
        self.alice = User.objects.create_user("alice", password="pw")
        self.bob = User.objects.create_user("bob", password="pw")
        # Everyone here shares the default zone, so this is "today" for every
        # viewer (the server's UTC date would differ for part of each day).
        today = local_today(self.alice)
        WorkLogEntry.objects.create(
            user=self.alice, date=today, category="ams", hours=Decimal("5.50")
        )
        WorkLogEntry.objects.create(
            user=self.alice, date=today, category="non_ams", hours=Decimal("2.25")
        )
        WorkLogEntry.objects.create(user=self.bob, date=today, category="ams", hours=Decimal(3))

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
        WorkLogEntry.objects.create(
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
            WorkLogEntry.objects.create(user=user, date=date(2026, 3, 4), category="ams", hours=3)
            WorkLogEntry.objects.create(user=user, date=date(2026, 3, 5), category="ams", hours=5)

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
