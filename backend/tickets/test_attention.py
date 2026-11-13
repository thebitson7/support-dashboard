"""
"Tickets waiting to be closed": classification at every boundary, the
attention endpoint (scope, involvement, the clock, caps, query count),
closure timing, the threshold settings and the demo seed.
"""

from datetime import datetime, timedelta, timezone as dt_timezone
from io import StringIO
from typing import Any
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import SimpleTestCase, TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from tickets import attention
from tickets.attention import Level, Thresholds, classify, parse_thresholds
from tickets.models import Customer, Site, Ticket, TicketActivity, WorkDoneCode
from working_hours.models import WorkLogEntry

URL = "/api/tickets/attention/"
UTC = dt_timezone.utc
NOW = datetime(2026, 11, 12, 12, 0, tzinfo=UTC)
DEFAULT = Thresholds(due_soon_hours=24, overdue_hours=48, critical_hours=72, no_activity_grace_hours=24)


def hours(h: int, m: int = 0) -> float:
    return h + m / 60


# --- classify (pure) -----------------------------------------------------------------


class ClassifyTests(SimpleTestCase):
    def test_every_boundary_with_activity(self):
        cases = [
            (hours(0), None),
            (hours(23, 59), None),
            (hours(24), Level.DUE_SOON),
            (hours(47, 59), Level.DUE_SOON),
            (hours(48), Level.OVERDUE),
            (hours(71, 59), Level.OVERDUE),
            (hours(72), Level.CRITICAL),
            (hours(500), Level.CRITICAL),
        ]
        for age, expected in cases:
            with self.subTest(age=age):
                self.assertEqual(classify(age, True, DEFAULT), expected)

    def test_no_activity_shifts_the_ladder_by_the_grace(self):
        cases = [
            (hours(47, 59), None),
            (hours(48), Level.DUE_SOON),
            (hours(71, 59), Level.DUE_SOON),
            (hours(72), Level.OVERDUE),
            (hours(95, 59), Level.OVERDUE),
            (hours(96), Level.CRITICAL),
        ]
        for age, expected in cases:
            with self.subTest(age=age):
                self.assertEqual(classify(age, False, DEFAULT), expected)

    def test_negative_age_counts_as_zero(self):
        self.assertIsNone(classify(-5, True, DEFAULT))
        self.assertIsNone(classify(-500, False, DEFAULT))

    def test_future_clock_start_is_age_zero(self):
        self.assertEqual(attention.age_hours(NOW + timedelta(hours=3), NOW), 0.0)
        self.assertEqual(attention.age_hours(NOW - timedelta(hours=3), NOW), 3.0)

    def test_uses_the_configured_thresholds_by_default(self):
        self.assertEqual(classify(24, True), Level.DUE_SOON)


class ThresholdSettingsTests(SimpleTestCase):
    def test_defaults(self):
        self.assertEqual(parse_thresholds({}), DEFAULT)

    def test_overrides(self):
        t = parse_thresholds(
            {
                "TICKET_DUE_SOON_HOURS": "8",
                "TICKET_OVERDUE_HOURS": "16",
                "TICKET_CRITICAL_HOURS": "40",
                "TICKET_NO_ACTIVITY_GRACE_HOURS": "4",
            }
        )
        self.assertEqual(t, Thresholds(8, 16, 40, 4))

    def test_rejects_bad_ordering(self):
        bad = [
            {"TICKET_DUE_SOON_HOURS": "48"},  # == overdue
            {"TICKET_OVERDUE_HOURS": "80"},  # > critical
            {"TICKET_DUE_SOON_HOURS": "30", "TICKET_OVERDUE_HOURS": "20"},
        ]
        for env in bad:
            with self.subTest(env=env), self.assertRaises(ImproperlyConfigured):
                parse_thresholds(env)

    def test_rejects_non_positive_and_non_numbers(self):
        for env in (
            {"TICKET_DUE_SOON_HOURS": "0"},
            {"TICKET_CRITICAL_HOURS": "-1"},
            {"TICKET_NO_ACTIVITY_GRACE_HOURS": "0"},
            {"TICKET_OVERDUE_HOURS": "two days"},
        ):
            with self.subTest(env=env), self.assertRaises(ImproperlyConfigured):
                parse_thresholds(env)


# --- The endpoint -----------------------------------------------------------------------


class AttentionFixtures(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            "boss", password="pw", role=User.Role.ADMIN, first_name="Ada", last_name="Min"
        )
        self.syed = User.objects.create_user("syed", password="pw", first_name="Syed", last_name="Hussain")
        self.naleefa = User.objects.create_user("naleefa", password="pw", first_name="Naleefa", last_name="Kareem")
        self.wahida = User.objects.create_user("wahida", password="pw", first_name="Wahida", last_name="Begum")
        self.outsider = User.objects.create_user("zed", password="pw", first_name="Zed")
        self.site = Site.objects.create(name="Tan Tock Seng Hospital", ocn="OCN05529-801-00")
        self.customer = Customer.objects.create(name="SingHealth")
        self.code = WorkDoneCode.objects.create(code="RMD", description="Remote Diagnostic")
        patcher = patch("tickets.views.timezone.now", return_value=NOW)
        patcher.start()
        self.addCleanup(patcher.stop)

    def ticket(self, number="T1", *, received_hours_ago=200, **fields):
        received = NOW - timedelta(hours=received_hours_ago)
        defaults = dict(
            received_at=received,
            cms_next_ticket_no=number,
            site=self.site,
            customer=self.customer,
            assigned_to=self.wahida,
            ticket_type="software",
            incoming_channel="email",
            cms_added_on=received,
            issue_description="i",
            notes="n",
            created_by=self.wahida,
        )
        defaults.update(fields)
        return Ticket.objects.create(**defaults)

    def activity(self, ticket, ended_hours_ago, resolver=None):
        end = NOW - timedelta(hours=ended_hours_ago)
        return TicketActivity.objects.create(
            ticket=ticket,
            activity_type="troubleshooting",
            start_at=end - timedelta(hours=1),
            end_at=end,
            work_done_code=self.code,
            resolved_by=resolver,
        )

    def get(self, user):
        self.client.force_authenticate(user)
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.content[:300])
        return response

    def numbers(self, user):
        return [r["cms_next_ticket_no"] for r in self.get(user).json()["results"]]


class AttentionEndpointTests(AttentionFixtures):
    def test_anonymous_is_refused(self):
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_response_shape_and_no_store(self):
        t = self.ticket("A")
        self.activity(t, 50, self.syed)
        response = self.get(self.syed)
        self.assertEqual(response["Cache-Control"], "no-store")
        body = response.json()
        self.assertEqual(set(body), {"generated_at", "thresholds", "scope", "counts", "total", "truncated", "results"})
        self.assertEqual(body["generated_at"], "2026-11-12T12:00:00Z")
        self.assertEqual(
            body["thresholds"],
            {"due_soon_hours": 24, "overdue_hours": 48, "critical_hours": 72, "no_activity_grace_hours": 24},
        )
        self.assertEqual(body["scope"], "mine")
        self.assertEqual(body["counts"], {"due_soon": 0, "overdue": 1, "critical": 0})
        self.assertEqual(body["total"], 1)
        self.assertFalse(body["truncated"])
        [item] = body["results"]
        self.assertEqual(
            item,
            {
                "id": t.pk,
                "cms_next_ticket_no": "A",
                "site_name": "Tan Tock Seng Hospital",
                "site_ocn": "OCN05529-801-00",
                "customer_name": "SingHealth",
                "level": "overdue",
                "age_hours": 50.0,
                "basis": "last_activity",
                "clock_started_at": "2026-11-10T10:00:00Z",
                "involved": [
                    {"id": self.wahida.pk, "name": "Wahida Begum", "roles": ["creator", "assignee"]},
                    {"id": self.syed.pk, "name": "Syed Hussain", "roles": ["resolver"]},
                ],
                "your_roles": ["resolver"],
            },
        )

    def test_only_open_tickets(self):
        self.ticket("OPEN", assigned_to=self.syed)
        self.ticket("CLOSED", assigned_to=self.syed, cms_closed_on=NOW - timedelta(hours=1))
        self.assertEqual(self.numbers(self.syed), ["OPEN"])

    def test_healthy_tickets_are_not_listed(self):
        fresh = self.ticket("FRESH", assigned_to=self.syed)
        self.activity(fresh, 23.9)
        new = self.ticket("NEW", assigned_to=self.syed, received_hours_ago=47.9)
        self.assertEqual(self.numbers(self.syed), [])
        self.assertTrue(new)

    def test_no_activity_uses_received_at_and_the_shifted_ladder(self):
        self.ticket("NOACT", assigned_to=self.syed, received_hours_ago=60)
        [item] = self.get(self.syed).json()["results"]
        self.assertEqual((item["level"], item["basis"], item["age_hours"]), ("due_soon", "received", 60.0))

    def test_future_activity_end_is_age_zero(self):
        t = self.ticket("FUTURE", assigned_to=self.syed)
        self.activity(t, 100)
        self.activity(t, -5)  # ends five hours from now
        self.assertEqual(self.numbers(self.syed), [])

    def test_each_involvement_role_on_its_own(self):
        roles: dict[str, dict[str, Any]] = {
            "creator": dict(created_by=self.syed),
            "assignee": dict(assigned_to=self.syed),
            "forwarded": dict(is_forwarded=True, forwarded_to=self.syed),
            "cms_added": dict(cms_added_by=self.syed),
        }
        for role, fields in roles.items():
            with self.subTest(role=role):
                Ticket.objects.all().delete()
                self.ticket(role, **fields)
                [item] = self.get(self.syed).json()["results"]
                self.assertEqual(item["your_roles"], [role])
        with self.subTest(role="resolver"):
            Ticket.objects.all().delete()
            t = self.ticket("resolver")
            self.activity(t, 60, self.syed)
            [item] = self.get(self.syed).json()["results"]
            self.assertEqual(item["your_roles"], ["resolver"])

    def test_forward_recipient_only_counts_while_forwarded(self):
        # Not reachable through the API (the serializer clears it), but the
        # database may still hold a stale recipient.
        self.ticket("STALE", is_forwarded=False, forwarded_to=self.syed)
        self.assertEqual(self.numbers(self.syed), [])
        names = [p["name"] for p in self.get(self.admin).json()["results"][0]["involved"]]
        self.assertNotIn("Syed Hussain", names)

    def test_staff_never_see_tickets_they_are_not_on(self):
        t = self.ticket("THEIRS")
        self.activity(t, 80, self.naleefa)
        body = self.get(self.outsider).json()
        self.assertEqual(body["results"], [])
        self.assertEqual(body["total"], 0)
        self.assertEqual(body["counts"], {"due_soon": 0, "overdue": 0, "critical": 0})
        self.assertNotIn("people", body)

    def test_clock_uses_the_last_activity_by_anyone_not_only_the_viewers(self):
        # The join pitfall: filtering activities by resolved_by=viewer and
        # taking Max(end_at) in the same queryset would start the clock at
        # syed's own (old) activity and call this ticket critical.
        t = self.ticket("JOIN")
        self.activity(t, 100, self.syed)
        self.activity(t, 30, self.naleefa)
        [item] = self.get(self.syed).json()["results"]
        self.assertEqual(item["level"], "due_soon")
        self.assertEqual(item["age_hours"], 30.0)
        self.assertEqual(item["clock_started_at"], "2026-11-11T06:00:00Z")

    def test_a_person_with_several_roles_appears_once(self):
        t = self.ticket(
            "MULTI",
            created_by=self.syed,
            assigned_to=self.syed,
            cms_added_by=self.syed,
            is_forwarded=True,
            forwarded_to=self.syed,
        )
        self.activity(t, 60, self.syed)
        self.activity(t, 70, self.syed)
        [item] = self.get(self.syed).json()["results"]
        self.assertEqual(
            item["involved"],
            [
                {
                    "id": self.syed.pk,
                    "name": "Syed Hussain",
                    "roles": ["creator", "assignee", "forwarded", "cms_added", "resolver"],
                }
            ],
        )
        self.assertEqual(item["your_roles"], ["creator", "assignee", "forwarded", "cms_added", "resolver"])
        [person] = self.get(self.admin).json()["people"]
        self.assertEqual(person["ticket_ids"], [t.pk])

    def test_deactivated_people_are_left_out(self):
        t = self.ticket("GONE", assigned_to=self.syed)
        self.activity(t, 60, self.naleefa)
        self.naleefa.is_active = False
        self.naleefa.save()
        body = self.get(self.admin).json()
        names = {p["name"] for p in body["results"][0]["involved"]}
        self.assertEqual(names, {"Wahida Begum", "Syed Hussain"})
        self.assertNotIn("Naleefa Kareem", {p["user"]["name"] for p in body["people"]})

    def test_admin_gets_everything_and_people(self):
        a = self.ticket("A", created_by=self.syed, assigned_to=self.syed)
        self.activity(a, 50, self.naleefa)
        b = self.ticket("B")  # wahida only
        self.activity(b, 80, self.wahida)
        self.ticket("C", created_by=self.naleefa, assigned_to=self.naleefa, received_hours_ago=60)
        body = self.get(self.admin).json()
        self.assertEqual(body["scope"], "all")
        self.assertEqual([r["cms_next_ticket_no"] for r in body["results"]], ["B", "A", "C"])
        self.assertEqual(body["counts"], {"due_soon": 1, "overdue": 1, "critical": 1})
        self.assertEqual(body["results"][0]["your_roles"], [])
        people = [(p["user"]["name"], p["counts"], sorted(p["ticket_ids"])) for p in body["people"]]
        self.assertEqual(
            people,
            [
                ("Wahida Begum", {"due_soon": 0, "overdue": 0, "critical": 1}, [b.pk]),
                (
                    "Naleefa Kareem",
                    {"due_soon": 1, "overdue": 1, "critical": 0},
                    sorted([a.pk, Ticket.objects.get(cms_next_ticket_no="C").pk]),
                ),
                ("Syed Hussain", {"due_soon": 0, "overdue": 1, "critical": 0}, [a.pk]),
            ],
        )

    def test_staff_get_neither_people_nor_others_tickets(self):
        self.ticket("SYED", assigned_to=self.syed)
        self.ticket("OTHER")
        body = self.get(self.syed).json()
        self.assertNotIn("people", body)
        self.assertEqual([r["cms_next_ticket_no"] for r in body["results"]], ["SYED"])

    def test_sorted_by_severity_then_age(self):
        for number, ago in (("D24", 25), ("O50", 50), ("C100", 100), ("O60", 60), ("C80", 80)):
            t = self.ticket(number, assigned_to=self.syed)
            self.activity(t, ago)
        self.assertEqual(self.numbers(self.syed), ["C100", "C80", "O60", "O50", "D24"])

    def test_capped_at_200_with_the_true_total(self):
        received = NOW - timedelta(hours=100)
        Ticket.objects.bulk_create(
            Ticket(
                received_at=received - timedelta(minutes=i),
                cms_next_ticket_no=f"N{i}",
                site=self.site,
                customer=self.customer,
                assigned_to=self.syed,
                ticket_type="software",
                incoming_channel="email",
                cms_added_on=received,
                issue_description="i",
                notes="n",
                created_by=self.syed,
            )
            for i in range(205)
        )
        body = self.get(self.syed).json()
        self.assertEqual(body["total"], 205)
        self.assertTrue(body["truncated"])
        self.assertEqual(len(body["results"]), 200)
        self.assertEqual(body["counts"]["critical"], 205)
        self.assertEqual(body["results"][0]["cms_next_ticket_no"], "N204")  # the oldest first

    def test_query_count_is_constant(self):
        def grow(n):
            for _ in range(n):
                t = self.ticket(
                    f"Q{Ticket.objects.count()}",
                    created_by=self.syed,
                    cms_added_by=self.naleefa,
                    is_forwarded=True,
                    forwarded_to=self.admin,
                )
                self.activity(t, 60, self.naleefa)
                self.activity(t, 70, self.wahida)

        def count(user):
            self.client.force_authenticate(user)
            with CaptureQueriesContext(connection) as ctx:
                self.assertEqual(self.client.get(URL).status_code, 200)
            return len(ctx)

        grow(2)
        few = (count(self.admin), count(self.syed))
        grow(18)
        many = (count(self.admin), count(self.syed))
        self.assertEqual(few, many)


# --- Closure timing ------------------------------------------------------------------------


class ClosureTimingTests(AttentionFixtures):
    def setUp(self):
        super().setUp()
        patcher = patch("tickets.serializers.timezone.now", return_value=NOW)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client.force_authenticate(self.syed)

    def close_payload(self) -> dict[str, Any]:
        when = (NOW - timedelta(days=10)).isoformat()  # backdated on purpose
        return {
            "resolution_verified_by": self.syed.pk,
            "resolution_verified_on": when,
            "cms_closed_by": self.syed.pk,
            "cms_closed_on": when,
            "service_closed_date": when,
        }

    def reopen_payload(self):
        return dict.fromkeys(self.close_payload())

    def patch_ticket(self, ticket, body):
        response = self.client.patch(f"/api/tickets/{ticket.pk}/", body, format="json")
        self.assertEqual(response.status_code, 200, response.content[:300])
        ticket.refresh_from_db()
        return ticket

    def test_closing_records_system_time_and_lag(self):
        t = self.ticket("L1")
        self.activity(t, 51, self.naleefa)
        self.patch_ticket(t, self.close_payload())
        self.assertEqual(t.closed_recorded_at, NOW)  # not the backdated cms_closed_on
        self.assertEqual(t.closure_lag_minutes, 51 * 60)

    def test_lag_is_measured_after_the_activities_in_the_same_edit(self):
        t = self.ticket("L2")
        self.activity(t, 100)
        end = NOW - timedelta(hours=2)
        body = self.close_payload() | {
            "activities": [
                {
                    "activity_type": "follow_up",
                    "start_at": (end - timedelta(hours=1)).isoformat(),
                    "end_at": end.isoformat(),
                    "work_done_code": self.code.pk,
                }
            ]
        }
        self.patch_ticket(t, body)
        self.assertEqual(t.closure_lag_minutes, 120)

    def test_without_activities_lag_runs_from_received_and_clamps_at_zero(self):
        t = self.ticket("L3", received_hours_ago=5)
        self.patch_ticket(t, self.close_payload())
        self.assertEqual(t.closure_lag_minutes, 300)
        future = self.ticket("L4")
        self.activity(future, -3)
        self.patch_ticket(future, self.close_payload())
        self.assertEqual(future.closure_lag_minutes, 0)

    def test_reopen_clears_and_closing_again_remeasures(self):
        t = self.ticket("L5")
        self.activity(t, 51)
        self.patch_ticket(t, self.close_payload())
        self.patch_ticket(t, self.reopen_payload())
        self.assertIsNone(t.closed_recorded_at)
        self.assertIsNone(t.closure_lag_minutes)
        later = NOW + timedelta(hours=10)
        with patch("tickets.serializers.timezone.now", return_value=later):
            self.patch_ticket(t, self.close_payload())
        self.assertEqual(t.closed_recorded_at, later)
        self.assertEqual(t.closure_lag_minutes, 61 * 60)

    def test_editing_a_closed_ticket_keeps_both(self):
        t = self.ticket("L6")
        self.activity(t, 51)
        self.patch_ticket(t, self.close_payload())
        with patch("tickets.serializers.timezone.now", return_value=NOW + timedelta(days=3)):
            self.patch_ticket(t, {"notes": "edited after closing"})
        self.assertEqual((t.closed_recorded_at, t.closure_lag_minutes), (NOW, 51 * 60))

    def test_editing_an_open_ticket_sets_nothing(self):
        t = self.ticket("L7")
        self.patch_ticket(t, {"notes": "still open"})
        self.assertIsNone(t.closed_recorded_at)
        self.assertIsNone(t.closure_lag_minutes)

    def test_created_closed_records_the_time_but_no_lag(self):
        when = (NOW - timedelta(days=3)).isoformat()
        body = {
            "received_at": when,
            "cms_next_ticket_no": "BACK-1",
            "site": self.site.pk,
            "customer": self.customer.pk,
            "assigned_to": self.syed.pk,
            "ticket_type": "software",
            "incoming_channel": "email",
            "cms_added_on": when,
            "issue_description": "i",
            "notes": "n",
            **self.close_payload(),
        }
        response = self.client.post("/api/tickets/", body, format="json")
        self.assertEqual(response.status_code, 201, response.content[:300])
        t = Ticket.objects.get(cms_next_ticket_no="BACK-1")
        self.assertEqual(t.closed_recorded_at, NOW)
        self.assertIsNone(t.closure_lag_minutes)

    def test_created_open_records_nothing(self):
        t = self.ticket("L8")
        self.assertIsNone(t.closed_recorded_at)

    def test_clients_cannot_write_the_fields(self):
        t = self.ticket("L9")
        self.patch_ticket(t, {"closed_recorded_at": NOW.isoformat(), "closure_lag_minutes": 5, "notes": "x"})
        self.assertIsNone(t.closed_recorded_at)
        self.assertIsNone(t.closure_lag_minutes)
        self.patch_ticket(t, self.close_payload() | {"closure_lag_minutes": 5})
        self.assertEqual(t.closure_lag_minutes, 200 * 60)  # measured, not the sent 5


# --- The demo seed ------------------------------------------------------------------------


class SeedAttentionDemoTests(TestCase):
    def seed_prerequisites(self):
        for name, first, last in (
            ("syed", "Syed", "Hussain"),
            ("naleefa", "Naleefa", "Kareem"),
            ("wahida", "Wahida", "Begum"),
        ):
            User.objects.create_user(name, password="pw", first_name=first, last_name=last)
        Site.objects.create(name="Tan Tock Seng Hospital", ocn="OCN1")
        Customer.objects.create(name="SingHealth")
        WorkDoneCode.objects.create(code="RMD", description="Remote Diagnostic")

    @override_settings(DEBUG=False)
    def test_refuses_with_debug_off(self):
        with self.assertRaisesMessage(CommandError, "DEBUG off"):
            call_command("seed_attention_demo", stdout=StringIO())

    @override_settings(DEBUG=True)
    def test_explains_missing_prerequisites(self):
        with self.assertRaisesMessage(CommandError, "seed_users"):
            call_command("seed_attention_demo", stdout=StringIO())
        for name in ("syed", "naleefa", "wahida"):
            User.objects.create_user(name, password="pw")
        with self.assertRaisesMessage(CommandError, "seed_tickets_support_data"):
            call_command("seed_attention_demo", stdout=StringIO())

    @override_settings(DEBUG=True)
    def test_creates_the_four_tickets_idempotently_with_synced_work_logs(self):
        self.seed_prerequisites()
        Ticket.objects.create(  # someone's real ticket: never touched
            received_at=timezone.now(),
            cms_next_ticket_no="REAL-1",
            site=Site.objects.get(),
            customer=Customer.objects.get(),
            assigned_to=User.objects.get(username="syed"),
            ticket_type="software",
            incoming_channel="email",
            cms_added_on=timezone.now(),
            issue_description="i",
            notes="n",
            created_by=User.objects.get(username="syed"),
        )
        call_command("seed_attention_demo", stdout=StringIO())
        call_command("seed_attention_demo", stdout=StringIO())

        demo = Ticket.objects.filter(cms_next_ticket_no__startswith="DEMO-ATT-")
        self.assertEqual(
            sorted(demo.values_list("cms_next_ticket_no", flat=True)),
            ["DEMO-ATT-1001", "DEMO-ATT-1002", "DEMO-ATT-1003", "DEMO-ATT-1004"],
        )
        self.assertTrue(Ticket.objects.filter(cms_next_ticket_no="REAL-1").exists())
        # One synced work-log entry per resolved activity (1001, 1002, 1003), not doubled by the re-run.
        self.assertEqual(WorkLogEntry.objects.filter(ticket_activity__ticket__in=demo).count(), 3)

        now = timezone.now()

        def level(number):
            t = demo.get(cms_next_ticket_no=number)
            start, has = attention.clock_start(t)
            return classify(attention.age_hours(start, now), has)

        self.assertEqual(
            {n: level(f"DEMO-ATT-{n}") for n in ("1001", "1002", "1003", "1004")},
            {"1001": Level.OVERDUE, "1002": None, "1003": Level.CRITICAL, "1004": Level.DUE_SOON},
        )
