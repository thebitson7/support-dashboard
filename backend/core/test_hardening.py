"""
Production hardening: authenticated file downloads, export rate limits,
database configuration, query counts (no N+1), and who may see what.
"""

import shutil
import tempfile
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from unittest.mock import patch

from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.core.files.base import ContentFile
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APITestCase
from rest_framework.throttling import SimpleRateThrottle

from accounts.models import User
from audit.log import log_action
from audit.models import AuditLogEntry
from config.settings import database_from_url
from tickets.models import Country, Customer, Holiday, Site, Ticket, TicketActivity, WorkDoneCode
from working_hours.models import WorkLogEntry

UTC = dt_timezone.utc
T0 = datetime(2026, 3, 4, 1, 0, tzinfo=UTC)
MEDIA = tempfile.mkdtemp(prefix="hardening-test-media-")


class Fixtures(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user("boss", password="pw", role=User.Role.ADMIN)
        self.staff = User.objects.create_user("syed", password="pw", first_name="Syed")
        self.other = User.objects.create_user("naleefa", password="pw", first_name="Naleefa")
        self.site = Site.objects.create(name="Tan Tock Seng Hospital", ocn="OCN1")
        self.customer = Customer.objects.create(name="SingHealth")
        self.code = WorkDoneCode.objects.create(code="RMD", description="Remote Diagnostic")

    def ticket(self, n=0, **fields):
        defaults = dict(
            received_at=T0 + timedelta(hours=n),
            cms_next_ticket_no=f"T{n:03d}",
            site=self.site,
            customer=self.customer,
            assigned_to=self.staff,
            ticket_type="software",
            incoming_channel="email",
            cms_added_on=T0,
            issue_description="i",
            notes="n",
            created_by=self.staff,
            cms_closed_by=self.other,
        )
        defaults.update(fields)
        return Ticket.objects.create(**defaults)


# --- Authenticated PDF downloads ------------------------------------------------


@override_settings(MEDIA_ROOT=MEDIA)
class AttachmentDownloadTests(Fixtures):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        super().setUp()
        self.with_pdf = self.ticket(1)
        self.with_pdf.pdf_attachment.save("service report, Mar.pdf", ContentFile(b"%PDF-1.7 report body"))
        self.without = self.ticket(2)
        self.client.force_authenticate(self.staff)

    def test_any_signed_in_user_downloads_the_pdf(self):
        response = self.client.get(f"/api/tickets/{self.with_pdf.pk}/attachment/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(response["Content-Disposition"].startswith("attachment;"))
        # The stored name: storage sanitises it at upload ("service report, Mar.pdf").
        self.assertIn('filename="service_report_Mar.pdf"', response["Content-Disposition"])
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(b"".join(response.streaming_content), b"%PDF-1.7 report body")

    def test_no_attachment_or_missing_file_or_ticket_is_a_404(self):
        self.assertEqual(self.client.get(f"/api/tickets/{self.without.pk}/attachment/").status_code, 404)
        self.assertEqual(self.client.get("/api/tickets/999999/attachment/").status_code, 404)
        self.with_pdf.pdf_attachment.storage.delete(self.with_pdf.pdf_attachment.name)
        response = self.client.get(f"/api/tickets/{self.with_pdf.pk}/attachment/")
        self.assertEqual((response.status_code, response.json()["detail"]), (404, "The attachment file is missing."))

    def test_requires_authentication(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f"/api/tickets/{self.with_pdf.pk}/attachment/").status_code, 401)

    def test_uploads_are_not_served_by_url_any_more(self):
        # The old DEBUG-only static route is gone, in development too.
        name = self.with_pdf.pdf_attachment.name
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f"/media/{name}").status_code, 404)


# --- Export rate limits -----------------------------------------------------------


class ExportThrottleTests(Fixtures):
    def test_csv_exports_are_rate_limited_per_user(self):
        with patch.dict(SimpleRateThrottle.THROTTLE_RATES, {"exports": "2/h"}):
            self.client.force_authenticate(self.admin)
            for url in ("/api/tickets/export/", "/api/reports/team-activity/export/"):
                self.assertEqual(self.client.get(url).status_code, 200)
            throttled = self.client.get("/api/tickets/export/")
            self.assertEqual(throttled.status_code, 429)  # the two exports share one budget
            self.assertIn("Retry-After", throttled)
            # Someone else's budget is separate, and the JSON list isn't limited.
            self.assertEqual(self.client.get("/api/tickets/").status_code, 200)
            self.client.force_authenticate(self.staff)
            self.assertEqual(self.client.get("/api/tickets/export/").status_code, 200)


# --- DATABASE_URL -------------------------------------------------------------------


class DatabaseUrlTests(SimpleTestCase):
    def test_postgres_urls(self):
        config = database_from_url("postgres://app:p%40ss%2Fword@db.internal:6543/support?sslmode=require")
        self.assertEqual(
            {k: config[k] for k in ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")},
            {
                "ENGINE": "django.db.backends.postgresql",
                "NAME": "support",
                "USER": "app",
                "PASSWORD": "p@ss/word",
                "HOST": "db.internal",
                "PORT": "6543",
                "OPTIONS": {"sslmode": "require"},
            },
        )
        self.assertEqual((config["CONN_MAX_AGE"], config["CONN_HEALTH_CHECKS"]), (60, True))
        self.assertEqual(database_from_url("postgresql://localhost/app")["PORT"], "")

    def test_bad_urls_fail_loudly(self):
        for url in ("mysql://x@y/z", "sqlite:///db.sqlite3", "postgres://localhost/"):
            with self.subTest(url=url), self.assertRaises(ImproperlyConfigured):
                database_from_url(url)


# --- No N+1: a list's query count doesn't grow with its rows ----------------------------


class QueryCountTests(Fixtures):
    """
    Each list is fetched with few rows and with many; the number of queries
    must be the same. A missing select_related/prefetch_related shows up as
    one extra query per row (SQLite hides the cost; PostgreSQL won't).
    """

    def grow(self, n):
        my = Country.objects.get_or_create(name="Malaysia", code="MY")[0]
        for i in range(n):
            ticket = self.ticket(100 + i + Ticket.objects.count())
            TicketActivity.objects.create(
                ticket=ticket,
                activity_type="troubleshooting",
                start_at=T0 + timedelta(days=i % 20, hours=1),
                end_at=T0 + timedelta(days=i % 20, hours=2),
                work_done_code=self.code,
                resolved_by=self.staff,
            )
            WorkLogEntry.objects.create(
                user=self.staff, date=date(2026, 3, 4), category="non_ams", start_time=time(20, i % 60), end_time=time(21, 0)
            )
            Site.objects.create(name=f"Site {i}", ocn=f"OCN-{i}-{Site.objects.count()}", country=my)
            Holiday.objects.create(name=f"H{i}-{Holiday.objects.count()}", date=date(2026, 1, 1 + i % 28), country=my)
            for actor in (self.staff, self.other):
                log_action(actor, AuditLogEntry.Action.TICKET_CREATED, target=ticket, description=f"created {ticket.pk}")

    def count(self, path, params=None):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(path, params or {})
        self.assertEqual(response.status_code, 200, (path, response.content[:200]))
        return len(ctx)

    def test_list_endpoints_are_constant(self):
        self.client.force_authenticate(self.admin)
        paths = [
            ("/api/tickets/", {"page_size": 200}),
            ("/api/tickets/export/", {}),
            ("/api/working-hours/entries/", {"date": "2026-03-04", "user_id": self.staff.pk}),
            ("/api/reports/team-activity/", {"start_date": "2026-03-01", "end_date": "2026-03-31"}),
            ("/api/reports/team-activity/", {"start_date": "2026-03-01", "end_date": "2026-03-31", "user_id": self.staff.pk}),
            ("/api/reports/team-activity/export/", {"start_date": "2026-03-01", "end_date": "2026-03-31"}),
            ("/api/lookups/sites/", {}),
            ("/api/lookups/holidays/", {}),
            ("/api/accounts/admin/users/", {}),
            ("/api/audit/logs/", {"page_size": 200}),
            ("/api/audit/logs/export/", {}),
        ]
        self.grow(2)
        few = [self.count(path, params) for path, params in paths]
        cache.clear()  # the export throttle
        self.grow(15)
        many = [self.count(path, params) for path, params in paths]
        for (path, params), a, b in zip(paths, few, many):
            with self.subTest(path=path, params=params):
                self.assertEqual(a, b, f"{path}: {a} queries with few rows, {b} with many")

    def test_ticket_detail_is_constant_in_its_activities(self):
        self.client.force_authenticate(self.staff)
        ticket = self.ticket(1)

        def activities(n):
            for i in range(n):
                TicketActivity.objects.create(
                    ticket=ticket, activity_type="follow_up", start_at=T0, end_at=T0 + timedelta(minutes=5),
                    work_done_code=self.code, resolved_by=self.other,
                )
            return self.count(f"/api/tickets/{ticket.pk}/")

        self.assertEqual(activities(1), activities(10))


# --- Who may see what (explicit, for the whole app) ---------------------------------------


class RoleVisibilityTests(Fixtures):
    """Staff see only their own activity; everyone's is for admins only."""

    def test_staff_cannot_see_the_team_or_anyone_elses_work(self):
        entry = WorkLogEntry.objects.create(
            user=self.other, date=date(2026, 3, 4), category="non_ams", start_time=time(9), end_time=time(10)
        )
        self.client.force_authenticate(self.staff)
        refused = {
            "team activity": self.client.get("/api/reports/team-activity/"),
            "team activity CSV": self.client.get("/api/reports/team-activity/export/"),
            "someone's working hours": self.client.get("/api/working-hours/summary/", {"user_id": self.other.pk}),
            "someone's job sheet": self.client.get("/api/working-hours/entries/", {"user_id": self.other.pk}),
            "someone's entry": self.client.get(f"/api/working-hours/entries/{entry.pk}/"),
            "staff list": self.client.get("/api/working-hours/users/"),
            "administration list": self.client.get("/api/accounts/admin/users/"),
            "administration create": self.client.post("/api/accounts/admin/users/", {"username": "x"}, format="json"),
            "administration read": self.client.get(f"/api/accounts/admin/users/{self.other.pk}/"),
            "administration edit": self.client.patch(
                f"/api/accounts/admin/users/{self.staff.pk}/", {"role": "admin"}, format="json"
            ),
            "audit log": self.client.get("/api/audit/logs/"),
            "audit log CSV": self.client.get("/api/audit/logs/export/"),
            "audit actions": self.client.get("/api/audit/logs/actions/"),
        }
        self.assertEqual({k: r.status_code for k, r in refused.items()}, dict.fromkeys(refused, 403))
        # Their own data is fine.
        self.assertEqual(self.client.get("/api/working-hours/summary/").status_code, 200)
        self.assertEqual(self.client.get("/api/working-hours/entries/").status_code, 200)
        self.staff.refresh_from_db()
        self.assertEqual(self.staff.role, "staff")

    def test_admins_can(self):
        self.client.force_authenticate(self.admin)
        for path in (
            "/api/reports/team-activity/",
            "/api/accounts/admin/users/",
            "/api/working-hours/users/",
            "/api/audit/logs/",
            "/api/audit/logs/actions/",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 200)
