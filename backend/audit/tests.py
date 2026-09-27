import csv
import io
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from io import StringIO
from unittest.mock import patch

from django.core.cache import cache
from django.core.management import CommandError, call_command
from django.db import DatabaseError
from rest_framework.test import APITestCase
from rest_framework.throttling import SimpleRateThrottle

from accounts.models import User
from audit.log import log_action
from audit.models import ACTION_GROUPS, AuditLogEntry
from tickets.models import Country, Customer, Holiday, Site, Ticket, WorkDoneCode
from working_hours.models import WorkLogEntry

UTC = dt_timezone.utc
NOW = datetime(2026, 3, 4, 6, 0, tzinfo=UTC)  # 14:00 in Kuala Lumpur
A = AuditLogEntry.Action
STRONG = "Correct-Horse-9-Battery"
LOGS = "/api/audit/logs/"


class AuditTestCase(APITestCase):
    def setUp(self):
        cache.clear()
        clock = patch("django.utils.timezone.now", return_value=NOW)
        clock.start()
        self.addCleanup(clock.stop)
        self.admin = User.objects.create_user("admin", password=STRONG, first_name="Admin", last_name="User", role=User.Role.ADMIN)
        self.syed = User.objects.create_user("syed", password=STRONG, first_name="Syed", last_name="Hussain")
        self.naleefa = User.objects.create_user("naleefa", password=STRONG, first_name="Naleefa", last_name="Kareem")
        self.site = Site.objects.create(name="Tan Tock Seng Hospital", ocn="OCN05529-801-00")
        self.customer = Customer.objects.create(name="SingHealth")
        self.code = WorkDoneCode.objects.create(code="RMD", description="Remote Diagnostic")

    def entries(self, **filters):
        return list(AuditLogEntry.objects.filter(**filters).order_by("id"))

    def descriptions(self, **filters):
        return [e.description for e in self.entries(**filters)]

    def activity(self, start, minutes, resolver=None, kind="troubleshooting"):
        return {
            "activity_type": kind,
            "start_at": start.isoformat(),
            "end_at": (start + timedelta(minutes=minutes)).isoformat(),
            "work_done_code": self.code.pk,
            "resolved_by": resolver.pk if resolver else None,
        }

    def ticket_body(self, **overrides):
        body = {
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
        }
        body.update(overrides)
        return body


# --- Sign-in / sign-out ------------------------------------------------------------------


class AuthEventTests(AuditTestCase):
    def sign_in(self, username, password, **extra):
        return self.client.post("/api/auth/token/", {"username": username, "password": password}, format="json", **extra)

    def test_sign_in_is_logged_with_the_browser_ip(self):
        # Through the Next.js server (a trusted proxy): the forwarded IP is recorded.
        self.assertEqual(self.sign_in("syed", STRONG, HTTP_X_FORWARDED_FOR="203.0.113.9").status_code, 200)
        entry = AuditLogEntry.objects.get()
        self.assertEqual(
            (entry.action, entry.actor, entry.actor_username, entry.description, entry.ip_address),
            (A.LOGIN, self.syed, "syed", "Syed Hussain signed in", "203.0.113.9"),
        )
        self.assertEqual((entry.target_type, entry.target_id, entry.target_label), ("user", str(self.syed.pk), "User: Syed Hussain"))

    def test_failed_sign_in_for_a_real_account(self):
        self.assertEqual(self.sign_in("syed", "wrong-password").status_code, 401)
        self.assertEqual(self.sign_in("SYED", "wrong-password").status_code, 401)  # still that account
        self.naleefa.is_active = False
        self.naleefa.save()
        self.sign_in("naleefa", STRONG)

        failed = self.entries(action=A.LOGIN_FAILED)
        self.assertEqual([e.description for e in failed], ["Failed sign-in attempt for Syed Hussain"] * 2 + ["Failed sign-in attempt for Naleefa Kareem"])
        self.assertEqual([e.metadata["reason"] for e in failed], ["wrong password", "wrong password", "account deactivated"])

    def test_unknown_usernames_and_throttled_attempts_are_not_logged(self):
        self.sign_in("nobody", "x")
        self.assertFalse(AuditLogEntry.objects.exists())
        for _ in range(5):
            self.sign_in("syed", "wrong")
        self.assertEqual(self.sign_in("syed", "wrong").status_code, 429)  # refused before the view
        self.assertEqual(AuditLogEntry.objects.filter(action=A.LOGIN_FAILED).count(), 5)

    def test_sign_out(self):
        refresh = self.sign_in("syed", STRONG).json()["refresh"]
        self.assertEqual(self.client.post("/api/auth/token/blacklist/", {"refresh": refresh}, format="json").status_code, 200)
        self.assertEqual(self.descriptions(action=A.LOGOUT), ["Syed Hussain signed out"])
        # Signing out with a dead token changes nothing, so it logs nothing.
        self.client.post("/api/auth/token/blacklist/", {"refresh": refresh}, format="json")
        self.client.post("/api/auth/token/blacklist/", {"refresh": "garbage"}, format="json")
        self.assertEqual(AuditLogEntry.objects.filter(action=A.LOGOUT).count(), 1)


# --- Tickets ---------------------------------------------------------------------------------


class TicketEventTests(AuditTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.syed)
        self.first = self.activity(datetime(2026, 3, 4, 1, 0, tzinfo=UTC), 120)  # 9:00–11:00 KL
        response = self.client.post("/api/tickets/", self.ticket_body(activities=[self.first]), format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.ticket = Ticket.objects.get()
        self.url = f"/api/tickets/{self.ticket.pk}/"

    def patch(self, body):
        response = self.client.patch(self.url, body, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def test_created(self):
        entry = AuditLogEntry.objects.get()
        self.assertEqual(entry.description, "Syed Hussain created ticket #152172RA2778834 for Tan Tock Seng Hospital with 1 activity")
        self.assertEqual((entry.action, entry.actor, entry.target_type, entry.target_id, entry.target_label),
                         (A.TICKET_CREATED, self.syed, "ticket", str(self.ticket.pk), "Ticket #152172RA2778834"))

    def test_edits_name_the_changed_fields(self):
        self.patch({"notes": "Replaced the LIS cable.", "assigned_to": self.naleefa.pk})
        entry = self.entries(action=A.TICKET_UPDATED)[0]
        self.assertEqual(entry.description, "Syed Hussain updated ticket #152172RA2778834: assigned to and notes")
        self.assertEqual(entry.metadata, {"fields": ["assigned_to", "notes"]})

    def test_saving_without_changes_logs_nothing(self):
        before = AuditLogEntry.objects.count()
        self.patch({"notes": "Reported this morning."})
        self.assertEqual(AuditLogEntry.objects.count(), before)

    def test_closing_and_reopening(self):
        verification = {
            "resolution_verified_by": self.naleefa.pk,
            "resolution_verified_on": NOW.isoformat(),
            "cms_closed_by": self.naleefa.pk,
            "cms_closed_on": NOW.isoformat(),
            "service_closed_date": NOW.isoformat(),
        }
        self.client.force_authenticate(self.naleefa)
        self.patch(verification)
        self.patch(dict.fromkeys(verification))
        self.assertEqual(
            [(e.action, e.description) for e in self.entries(actor=self.naleefa)],
            [
                (A.TICKET_CLOSED, "Naleefa Kareem closed ticket #152172RA2778834"),
                (A.TICKET_REOPENED, "Naleefa Kareem reopened ticket #152172RA2778834"),
            ],
        )  # the verification fields aren't repeated as a separate "updated" entry

    def test_only_genuinely_added_or_removed_activities_are_logged(self):
        second = self.activity(datetime(2026, 3, 4, 5, 0, tzinfo=UTC), 45, kind="follow_up")  # 13:00–13:45
        self.patch({"activities": [self.first, second]})  # the first is unchanged
        self.assertEqual(
            self.descriptions(action=A.TICKET_ACTIVITY_ADDED),
            ["Syed Hussain added a Follow-up activity (4 Mar 2026, 1:00 PM – 1:45 PM, 45m) to ticket #152172RA2778834"],
        )
        self.patch({"activities": [second]})
        self.assertEqual(
            self.descriptions(action=A.TICKET_ACTIVITY_REMOVED),
            ["Syed Hussain removed a Troubleshooting activity (4 Mar 2026, 9:00 AM – 11:00 AM, 2h 00m) from ticket #152172RA2778834"],
        )
        self.patch({"activities": [second]})  # the same set again
        self.assertEqual(AuditLogEntry.objects.filter(action__in=[A.TICKET_ACTIVITY_ADDED, A.TICKET_ACTIVITY_REMOVED]).count(), 2)
        # The total follows the activities, so it isn't reported as a field edit.
        self.assertFalse(AuditLogEntry.objects.filter(action=A.TICKET_UPDATED).exists())


# --- Work logs -------------------------------------------------------------------------------


class WorkLogEventTests(AuditTestCase):
    def log(self, body, user_id=None):
        url = "/api/working-hours/entries/" + (f"?user_id={user_id}" if user_id else "")
        return self.client.post(url, body, format="json")

    def test_manual_entries(self):
        self.client.force_authenticate(self.syed)
        entry_id = self.log({"start_time": "09:00", "end_time": "10:30", "note": "Team meeting"}).json()["id"]
        self.client.patch(f"/api/working-hours/entries/{entry_id}/", {"end_time": "11:00"}, format="json")
        self.client.delete(f"/api/working-hours/entries/{entry_id}/")

        self.assertEqual(
            [(e.action, e.description) for e in self.entries()],
            [
                (A.WORK_LOG_CREATED, "Syed Hussain logged 1h 30m of Non-AMS work (9:00 AM – 10:30 AM) on 4 Mar 2026"),
                (A.WORK_LOG_UPDATED, "Syed Hussain edited hours: now 2h 00m of Non-AMS work (9:00 AM – 11:00 AM) on 4 Mar 2026"),
                (A.WORK_LOG_DELETED, "Syed Hussain deleted 2h 00m of Non-AMS work (9:00 AM – 11:00 AM) on 4 Mar 2026"),
            ],
        )
        deleted = self.entries(action=A.WORK_LOG_DELETED)[0]
        self.assertEqual((deleted.target_type, deleted.target_id, deleted.target_label), ("work_log", str(entry_id), "Work log: Syed Hussain · 4 Mar 2026"))
        self.assertIn("before", self.entries(action=A.WORK_LOG_UPDATED)[0].metadata)

    def test_an_admin_logging_for_someone_names_them(self):
        self.client.force_authenticate(self.admin)
        self.log({"start_time": "14:00", "end_time": "14:20"}, user_id=self.syed.pk)
        self.assertEqual(self.descriptions(), ["Admin User logged 20m of Non-AMS work (2:00 PM – 2:20 PM) on 4 Mar 2026 for Syed Hussain"])

    def test_auto_entries_are_covered_by_the_ticket_not_logged_again(self):
        self.client.force_authenticate(self.syed)
        self.client.post("/api/tickets/", self.ticket_body(activities=[self.activity(NOW - timedelta(hours=3), 60, resolver=self.syed)]), format="json")
        self.assertTrue(WorkLogEntry.objects.filter(ticket_activity__isnull=False).exists())
        self.assertEqual([e.action for e in self.entries()], [A.TICKET_CREATED])


# --- Lookups -----------------------------------------------------------------------------------


class LookupEventTests(AuditTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.admin)

    def test_create_edit_delete_on_every_lookup(self):
        cases = [
            ("countries", {"name": "Malaysia", "code": "MY"}, {"name": "Malaysia (Federation)"}, "country Malaysia (MY)", "Country: Malaysia"),
            ("sites", {"name": "Penang Adventist", "ocn": "OCN1"}, {"address": "465 Jalan Burma"}, "site Penang Adventist (OCN1)", "Site: Penang Adventist (OCN1)"),
            ("customers", {"name": "KPJ Healthcare"}, {"name": "KPJ Healthcare Berhad"}, "customer KPJ Healthcare", "Customer: KPJ Healthcare"),
            ("work-done-codes", {"code": "CAL", "description": "Calibration"}, {"is_active": False}, "work done code CAL — Calibration", "Work done code: CAL — Calibration"),
            ("holidays", {"name": "Deepavali", "date": "2026-11-08", "is_recurring_annually": False}, {"name": "Deepavali Day"}, "holiday Deepavali (8 Nov 2026)", "Holiday: Deepavali (8 Nov 2026)"),
        ]
        for path, create, change, named, label in cases:
            with self.subTest(path=path):
                AuditLogEntry.objects.all().delete()
                pk = self.client.post(f"/api/lookups/{path}/", create, format="json").json()["id"]
                self.client.patch(f"/api/lookups/{path}/{pk}/", change, format="json")
                self.client.delete(f"/api/lookups/{path}/{pk}/")
                created, updated, deleted = self.entries()
                self.assertEqual(created.description, f"Admin User added {named}")
                self.assertTrue(created.target_label.startswith(label), created.target_label)
                self.assertEqual((updated.action, deleted.action), (A.LOOKUP_UPDATED, A.LOOKUP_DELETED))
                self.assertIn(": ", updated.description)  # names the changed field
                self.assertEqual(set(updated.metadata["changes"]), set(change))
                self.assertEqual(deleted.target_id, str(pk))

    def test_no_op_edits_and_refused_deletes_log_nothing(self):
        site = self.site
        Ticket.objects.create(**{**{k: v for k, v in self.ticket_body().items() if k not in ("site", "customer", "assigned_to")},
                                 "site": site, "customer": self.customer, "assigned_to": self.syed, "created_by": self.syed})
        self.client.patch(f"/api/lookups/sites/{site.pk}/", {"name": site.name}, format="json")
        self.assertEqual(self.client.delete(f"/api/lookups/sites/{site.pk}/").status_code, 409)
        self.assertFalse(AuditLogEntry.objects.exists())

    def test_ticket_form_quick_add(self):
        self.client.post("/api/tickets/sites/", {"name": "Quick Lab", "ocn": "OCN9"}, format="json")
        self.client.post("/api/tickets/customers/", {"name": "Quick Health"}, format="json")
        self.assertEqual(self.descriptions(), ["Admin User added site Quick Lab (OCN9)", "Admin User added customer Quick Health"])

    def test_edit_description_names_the_field(self):
        country = Country.objects.create(name="Malaysia", code="MY")
        self.client.patch(f"/api/lookups/countries/{country.pk}/", {"name": "Malaysia Federation"}, format="json")
        entry = self.entries()[0]
        self.assertEqual(entry.description, "Admin User edited country Malaysia Federation (MY): name")
        self.assertEqual(entry.metadata, {"changes": {"name": {"from": "Malaysia", "to": "Malaysia Federation"}}})


# --- Administration ----------------------------------------------------------------------------


class UserEventTests(AuditTestCase):
    URL = "/api/accounts/admin/users/"

    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.admin)

    def patch(self, user, body):
        response = self.client.patch(f"{self.URL}{user.pk}/", body, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def test_every_account_change(self):
        self.client.post(self.URL, {"username": "wahida", "first_name": "Wahida", "last_name": "Begum", "role": "staff", "timezone": "Indian/Maldives", "password": STRONG}, format="json")
        wahida = User.objects.get(username="wahida")
        self.patch(wahida, {"role": "admin"})
        self.patch(wahida, {"is_active": False})
        self.patch(wahida, {"is_active": True})
        self.patch(wahida, {"new_password": "Another-Strong-7-Passphrase"})
        self.patch(wahida, {"timezone": "Asia/Manila", "last_name": "Begum-Rahman"})

        self.assertEqual(
            [(e.action, e.description) for e in self.entries()],
            [
                (A.USER_CREATED, "Admin User created an account for Wahida Begum (wahida, Staff)"),
                (A.USER_ROLE_CHANGED, "Admin User changed Wahida Begum's role from Staff to Admin"),
                (A.USER_DEACTIVATED, "Admin User deactivated Wahida Begum's account"),
                (A.USER_REACTIVATED, "Admin User reactivated Wahida Begum's account"),
                (A.USER_PASSWORD_RESET, "Admin User reset Wahida Begum's password"),
                (A.USER_UPDATED, "Admin User edited Wahida Begum-Rahman's account: last name Begum → Begum-Rahman, time zone Indian/Maldives → Asia/Manila"),
            ],
        )
        role = self.entries(action=A.USER_ROLE_CHANGED)[0]
        self.assertEqual(role.metadata, {"from": "staff", "to": "admin"})
        self.assertEqual((role.target_type, role.target_id), ("user", str(wahida.pk)))

    def test_one_edit_with_several_changes_gives_one_entry_each(self):
        self.patch(self.syed, {"role": "admin", "is_active": False, "first_name": "Syed A."})
        self.assertEqual(
            [e.action for e in self.entries()],
            [A.USER_ROLE_CHANGED, A.USER_DEACTIVATED, A.USER_UPDATED],
        )

    def test_passwords_never_reach_the_log(self):
        new = "Brand-New-Secret-42x"
        self.client.post(self.URL, {"username": "temp", "role": "staff", "timezone": "UTC", "password": STRONG}, format="json")
        self.patch(self.syed, {"new_password": new})
        self.client.post("/api/auth/token/", {"username": "syed", "password": new}, format="json")
        self.client.post("/api/auth/token/", {"username": "syed", "password": "wrong-" + new}, format="json")

        self.assertGreaterEqual(AuditLogEntry.objects.count(), 4)
        for entry in AuditLogEntry.objects.all():
            blob = " ".join(str(v) for v in (entry.description, entry.metadata, entry.target_label, entry.actor_username, entry.target_id))
            for secret in (STRONG, new):
                self.assertNotIn(secret, blob, f"{entry.action} leaked a password")
            self.assertNotIn("pbkdf2", blob)
        reset = self.entries(action=A.USER_PASSWORD_RESET)[0]
        self.assertEqual(reset.metadata, {})


# --- Best-effort logging ----------------------------------------------------------------------------


class LoggingFailureTests(AuditTestCase):
    def test_a_failed_log_write_never_breaks_the_action(self):
        self.client.force_authenticate(self.syed)
        for error in (RuntimeError("boom"), DatabaseError("table gone")):
            with self.subTest(error=type(error).__name__):
                Ticket.objects.all().delete()
                with patch("audit.log.AuditLogEntry.objects.create", side_effect=error), self.assertLogs("audit.log", "ERROR"):
                    response = self.client.post("/api/tickets/", self.ticket_body(), format="json")
                self.assertEqual(response.status_code, 201, response.content)
                self.assertTrue(Ticket.objects.exists())

    def test_log_action_on_its_own(self):
        entry = log_action(None, A.LOGIN, description="System event")
        self.assertEqual((entry.actor, entry.actor_username, entry.ip_address, entry.target_type), (None, "", "", ""))
        with patch("audit.log.AuditLogEntry.objects.create", side_effect=RuntimeError), self.assertLogs("audit.log", "ERROR"):
            self.assertIsNone(log_action(self.syed, A.LOGIN, description="x"))

    def test_the_username_is_a_snapshot(self):
        log_action(self.syed, A.LOGIN, description="Syed Hussain signed in")
        self.syed.username = "syed.hussain"
        self.syed.first_name = "S."
        self.syed.save()
        entry = AuditLogEntry.objects.get()
        self.assertEqual((entry.actor_username, entry.description), ("syed", "Syed Hussain signed in"))


# --- The API -----------------------------------------------------------------------------------------


class AuditApiTests(AuditTestCase):
    def setUp(self):
        super().setUp()
        base = dict(target_type="ticket", target_label="Ticket #1")
        self.a = log_action(self.syed, A.TICKET_CREATED, target_id="1", description="Syed Hussain created ticket #1", **base)
        self.b = log_action(self.naleefa, A.TICKET_CLOSED, target_id="1", description="Naleefa Kareem closed ticket #1", **base)
        self.c = log_action(self.naleefa, A.LOGIN, target=self.naleefa, description="Naleefa Kareem signed in")
        # Two older ones: 40 days ago (outside the default 30) and 10 days ago.
        with patch("django.utils.timezone.now", return_value=NOW - timedelta(days=40)):
            self.old = log_action(self.syed, A.LOGIN, target=self.syed, description="Syed Hussain signed in")
        with patch("django.utils.timezone.now", return_value=NOW - timedelta(days=10)):
            self.recent = log_action(self.syed, A.LOGOUT, target=self.syed, description="Syed Hussain signed out")
        self.client.force_authenticate(self.admin)

    def ids(self, **params):
        response = self.client.get(LOGS, params)
        self.assertEqual(response.status_code, 200, response.content)
        return [row["id"] for row in response.json()["results"]]

    def test_staff_have_no_access_at_all(self):
        self.client.force_authenticate(self.syed)
        for path in (LOGS, f"{LOGS}export/", f"{LOGS}actions/"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(LOGS).status_code, 401)

    def test_default_is_the_last_30_days_newest_first(self):
        body = self.client.get(LOGS).json()
        self.assertEqual([r["id"] for r in body["results"]], [self.c.pk, self.b.pk, self.a.pk, self.recent.pk])
        self.assertEqual((body["start_date"], body["end_date"], body["count"]), ("2026-02-03", "2026-03-04", 4))
        row = body["results"][0]
        self.assertEqual((row["action"], row["action_label"], row["actor_username"]), ("login", "Signed in", "naleefa"))

    def test_filters(self):
        self.assertEqual(self.ids(actor=self.naleefa.pk), [self.c.pk, self.b.pk])
        self.assertEqual(self.ids(action="ticket_created,ticket_closed"), [self.b.pk, self.a.pk])
        self.assertEqual(self.ids(target_type="ticket", target_id="1"), [self.b.pk, self.a.pk])
        self.assertEqual(self.ids(start_date="2026-01-01", end_date="2026-01-31"), [self.old.pk])
        self.assertEqual(self.ids(start_date="2026-01-01"), [self.c.pk, self.b.pk, self.a.pk, self.recent.pk, self.old.pk])
        self.assertEqual(self.ids(search="closed"), [self.b.pk])
        self.assertEqual(self.ids(search="naleefa"), [self.c.pk, self.b.pk])  # username too
        self.assertEqual(self.ids(ordering="created_at"), [self.recent.pk, self.a.pk, self.b.pk, self.c.pk])
        self.assertEqual(self.ids(ordering="action"), [self.c.pk, self.recent.pk, self.b.pk, self.a.pk])
        self.assertEqual(self.ids(page_size=2), [self.c.pk, self.b.pk])

    def test_bad_filters_are_400s(self):
        for params in ({"actor": "x"}, {"action": "hacked"}, {"start_date": "2026-02-30"}, {"start_date": "2026-03-05", "end_date": "2026-03-01"}, {"ordering": "password"}):
            with self.subTest(params=params):
                self.assertEqual(self.client.get(LOGS, params).status_code, 400)

    def test_actions_endpoint_matches_the_model(self):
        actions = self.client.get(f"{LOGS}actions/").json()
        self.assertEqual({a["value"] for a in actions}, set(AuditLogEntry.Action.values))
        self.assertEqual(actions[0], {"value": "login", "label": "Signed in", "group": "Sign-in"})
        self.assertEqual({a["group"] for a in actions}, set(ACTION_GROUPS))

    def test_csv_export(self):
        log_action(self.syed, A.LOOKUP_CREATED, description="=HYPERLINK(\"evil\")", metadata={"k": "v"})
        response = self.client.get(f"{LOGS}export/", {"tz": "Asia/Kuala_Lumpur"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Disposition"], 'attachment; filename="audit-log_2026-02-03_2026-03-04.csv"')
        rows = list(csv.reader(io.StringIO(response.content.decode("utf-8").lstrip("﻿"))))
        self.assertEqual(rows[0], ["Timestamp (Asia/Kuala_Lumpur)", "User", "Action", "Description", "Target", "Target type", "Target ID", "IP address", "Details"])
        self.assertEqual(len(rows) - 1, 5)  # the 30-day default applies
        self.assertEqual(rows[1][:4], ["2026-03-04 14:00:00", "syed", "Lookup added", "'=HYPERLINK(\"evil\")"])
        self.assertEqual(rows[1][8], '{"k": "v"}')
        filtered = list(csv.reader(io.StringIO(self.client.get(f"{LOGS}export/", {"actor": self.naleefa.pk}).content.decode("utf-8").lstrip("﻿"))))
        self.assertEqual(len(filtered) - 1, 2)

    def test_csv_export_is_rate_limited(self):
        with patch.dict(SimpleRateThrottle.THROTTLE_RATES, {"exports": "1/h"}):
            self.assertEqual(self.client.get(f"{LOGS}export/").status_code, 200)
            self.assertEqual(self.client.get(f"{LOGS}export/").status_code, 429)
            self.assertEqual(self.client.get(LOGS).status_code, 200)  # the list isn't


class PruneCommandTests(AuditTestCase):
    def test_prunes_only_older_entries(self):
        with patch("django.utils.timezone.now", return_value=NOW - timedelta(days=400)):
            log_action(self.syed, A.LOGIN, description="old")
        log_action(self.syed, A.LOGIN, description="new")

        out = StringIO()
        call_command("prune_audit_logs", "--older-than-days=365", "--dry-run", stdout=out)
        self.assertIn("1 audit entries are older than 365 days (nothing deleted)", out.getvalue())
        self.assertEqual(AuditLogEntry.objects.count(), 2)
        call_command("prune_audit_logs", "--older-than-days=365", stdout=StringIO())
        self.assertEqual(self.descriptions(), ["new"])
        with self.assertRaises(CommandError):
            call_command("prune_audit_logs", "--older-than-days=0", stdout=StringIO())
