"""
End-to-end flows through the real API, as a person would do them: real JWT
sign-in (no force_authenticate), then ticket, hours and account work, then
the audit log read back through its own endpoints, list and CSV.
"""

import csv
import io
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from audit.models import AuditLogEntry
from tickets.models import Customer, Site, WorkDoneCode

A = AuditLogEntry.Action
PASSWORD = "Correct-Horse-9-Battery"
LOGS = "/api/audit/logs/"


class AuditFlowTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user("aisha", password=PASSWORD, first_name="Aisha", last_name="Rahman", role=User.Role.ADMIN)
        self.ravi = User.objects.create_user("ravi", password=PASSWORD, first_name="Ravi", last_name="Kumar")
        self.site = Site.objects.create(name="Tan Tock Seng Hospital", ocn="OCN05529")
        self.customer = Customer.objects.create(name="SingHealth")
        self.code = WorkDoneCode.objects.create(code="RMD", description="Remote Diagnostic")

    def sign_in(self, username):
        response = self.client.post("/api/auth/token/", {"username": username, "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        tokens = response.json()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        return tokens["refresh"]

    def since(self, mark):
        return list(AuditLogEntry.objects.filter(id__gt=mark).order_by("id"))

    def mark(self):
        last = AuditLogEntry.objects.order_by("-id").first()
        return last.id if last else 0

    def activity(self, hours_ago, minutes, kind="troubleshooting"):
        start = timezone.now().replace(microsecond=0) - timedelta(hours=hours_ago)
        return {
            "activity_type": kind,
            "start_at": start.isoformat(),
            "end_at": (start + timedelta(minutes=minutes)).isoformat(),
            "work_done_code": self.code.pk,
            "resolved_by": None,
        }

    def test_ticket_lifecycle(self):
        self.sign_in("ravi")
        start = self.mark()
        first = self.activity(5, 90)
        now = timezone.now().isoformat()
        created = self.client.post(
            "/api/tickets/",
            {
                "received_at": now,
                "cms_next_ticket_no": "CMS1001",
                "site": self.site.pk,
                "customer": self.customer.pk,
                "assigned_to": self.ravi.pk,
                "ticket_type": "software",
                "incoming_channel": "email",
                "cms_added_on": now,
                "issue_description": "Analyzer stops sending results.",
                "notes": "Reported by the lab.",
                "activities": [first],
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        url = f"/api/tickets/{created.json()['id']}/"
        verification = {
            "resolution_verified_by": self.ravi.pk,
            "resolution_verified_on": now,
            "cms_closed_by": self.ravi.pk,
            "cms_closed_on": now,
            "service_closed_date": now,
        }
        second = self.activity(2, 45, "follow_up")
        for body in (verification, dict.fromkeys(verification), {"activities": [first, second]}, {"activities": [second]}):
            response = self.client.patch(url, body, format="json")
            self.assertEqual(response.status_code, 200, response.content)

        entries = self.since(start)
        self.assertEqual(
            [e.action for e in entries],
            [A.TICKET_CREATED, A.TICKET_CLOSED, A.TICKET_REOPENED, A.TICKET_ACTIVITY_ADDED, A.TICKET_ACTIVITY_REMOVED],
        )
        descriptions = [e.description for e in entries]
        self.assertEqual(descriptions[0], "Ravi Kumar created ticket #CMS1001 for Tan Tock Seng Hospital with 1 activity")
        self.assertEqual(descriptions[1:3], ["Ravi Kumar closed ticket #CMS1001", "Ravi Kumar reopened ticket #CMS1001"])
        self.assertRegex(descriptions[3], r"^Ravi Kumar added a Follow-up activity \(.+, 45m\) to ticket #CMS1001$")
        self.assertRegex(descriptions[4], r"^Ravi Kumar removed a Troubleshooting activity \(.+, 1h 30m\) from ticket #CMS1001$")
        self.assertTrue(all(e.actor == self.ravi and e.target_label == "Ticket #CMS1001" for e in entries))

    def test_manual_hours(self):
        self.sign_in("ravi")
        start = self.mark()
        entry_id = self.client.post("/api/working-hours/entries/", {"start_time": "09:00", "end_time": "10:30"}, format="json").json()["id"]
        self.assertEqual(self.client.patch(f"/api/working-hours/entries/{entry_id}/", {"end_time": "11:00"}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(f"/api/working-hours/entries/{entry_id}/").status_code, 204)

        entries = self.since(start)
        self.assertEqual([e.action for e in entries], [A.WORK_LOG_CREATED, A.WORK_LOG_UPDATED, A.WORK_LOG_DELETED])
        self.assertRegex(entries[0].description, r"^Ravi Kumar logged 1h 30m of Non-AMS work \(9:00 AM – 10:30 AM\) on ")
        self.assertRegex(entries[1].description, r"^Ravi Kumar edited hours: now 2h 00m of Non-AMS work \(9:00 AM – 11:00 AM\) on ")
        self.assertRegex(entries[2].description, r"^Ravi Kumar deleted 2h 00m of Non-AMS work ")
        self.assertEqual({e.target_id for e in entries}, {str(entry_id)})

    def test_account_administration_never_logs_a_password(self):
        self.sign_in("aisha")
        start = self.mark()
        first_password, reset_password = "Farah-First-Pass-77", "Farah-Reset-Pass-88"
        users = "/api/accounts/admin/users/"
        farah = self.client.post(
            users,
            {"username": "farah", "first_name": "Farah", "last_name": "Aziz", "role": "staff", "timezone": "Asia/Kuala_Lumpur", "password": first_password},
            format="json",
        ).json()
        for body in ({"role": "admin"}, {"new_password": reset_password}, {"is_active": False}):
            response = self.client.patch(f"{users}{farah['id']}/", body, format="json")
            self.assertEqual(response.status_code, 200, response.content)

        entries = self.since(start)
        self.assertEqual(
            [(e.action, e.description) for e in entries],
            [
                (A.USER_CREATED, "Aisha Rahman created an account for Farah Aziz (farah, Staff)"),
                (A.USER_ROLE_CHANGED, "Aisha Rahman changed Farah Aziz's role from Staff to Admin"),
                (A.USER_PASSWORD_RESET, "Aisha Rahman reset Farah Aziz's password"),
                (A.USER_DEACTIVATED, "Aisha Rahman deactivated Farah Aziz's account"),
            ],
        )
        reset = entries[2]
        self.assertEqual(reset.metadata, {})
        # Nothing anywhere in the log, nor in what the API serves, holds either password or a hash.
        listing = self.client.get(LOGS, {"page_size": 200}).content.decode()
        export = self.client.get(f"{LOGS}export/").content.decode()
        stored = " ".join(
            f"{e.description} {e.metadata} {e.target_label} {e.actor_username} {e.target_id} {e.ip_address}"
            for e in AuditLogEntry.objects.all()
        )
        for secret in (first_password, reset_password, PASSWORD, "pbkdf2_"):
            for where, blob in (("database", stored), ("list", listing), ("csv", export)):
                self.assertNotIn(secret, blob, f"{secret!r} found in the {where}")

    def test_sign_in_and_out(self):
        start = self.mark()
        refresh = self.sign_in("ravi")
        self.client.credentials()
        self.assertEqual(self.client.post("/api/auth/token/blacklist/", {"refresh": refresh}, format="json").status_code, 200)
        self.assertEqual(
            [(e.action, e.description, e.actor) for e in self.since(start)],
            [(A.LOGIN, "Ravi Kumar signed in", self.ravi), (A.LOGOUT, "Ravi Kumar signed out", self.ravi)],
        )

    def test_staff_are_refused_everywhere_in_the_audit_api(self):
        self.sign_in("ravi")
        for path in (LOGS, f"{LOGS}export/", f"{LOGS}actions/"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 403)

    def test_filtered_csv_matches_the_filtered_list_exactly(self):
        # Some varied traffic from two people.
        self.sign_in("ravi")
        for start_time, end_time in (("08:00", "08:30"), ("09:00", "09:45"), ("13:00", "14:00")):
            self.client.post("/api/working-hours/entries/", {"start_time": start_time, "end_time": end_time}, format="json")
        self.sign_in("aisha")
        self.client.post("/api/lookups/customers/", {"name": "KPJ Healthcare"}, format="json")
        today = timezone.localdate(timezone=self.admin.tzinfo).isoformat()
        filters = {
            "actor": str(self.ravi.pk),
            "action": "work_log_created,login",
            "search": "Non-AMS",
            "start_date": today,
            "end_date": today,
            "ordering": "created_at",
        }
        listed = self.client.get(LOGS, {**filters, "page_size": "200"}).json()
        exported = self.client.get(f"{LOGS}export/", {**filters, "tz": "UTC"})
        self.assertEqual(exported.status_code, 200)
        rows = list(csv.DictReader(io.StringIO(exported.content.decode("utf-8").lstrip("﻿"))))
        self.assertEqual(listed["count"], 3)
        self.assertEqual(
            [(r["User"], r["Action"], r["Description"], r["Target ID"]) for r in rows],
            [(e["actor_username"], e["action_label"], e["description"], e["target_id"]) for e in listed["results"]],
        )
