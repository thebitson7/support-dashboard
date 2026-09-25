import json
import shutil
import tempfile
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from accounts.models import User
from tickets.models import Customer, Site, Ticket, TicketActivity, WorkDoneCode

TICKETS_URL = "/api/tickets/"
T0 = datetime(2026, 9, 1, 9, 0, tzinfo=dt_timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


class TicketTestCase(APITestCase):
    def setUp(self):
        self.syed = User.objects.create_user("syed", password="pw", first_name="Syed", last_name="Hussain")
        self.wahida = User.objects.create_user("wahida", password="pw", first_name="Wahida", last_name="Begum")
        self.site = Site.objects.create(name="Tan Tock Seng Hospital", ocn="OCN05529-801-00")
        self.other_site = Site.objects.create(name="Makati Medical Center", ocn="OCN07014-801-00")
        self.customer = Customer.objects.create(name="SingHealth")
        self.code = WorkDoneCode.objects.create(code="RMD", description="Remote Diagnostic")
        self.client.force_authenticate(self.syed)

    def payload(self, **overrides):
        data = {
            "received_at": iso(T0),
            "cms_next_ticket_no": "152331RA1234567",
            "site": self.site.pk,
            "customer": self.customer.pk,
            "assigned_to": self.wahida.pk,
            "ticket_type": "software",
            "incoming_channel": "email",
            "cms_added_on": iso(T0 + timedelta(minutes=5)),
            "issue_description": "Analyzer stops sending results to the LIS.",
            "notes": "Customer reports since this morning.",
        }
        data.update(overrides)
        return data

    def activity(self, start_min=0, minutes=90, **overrides):
        data = {
            "activity_type": "remote_support",
            "start_at": iso(T0 + timedelta(minutes=start_min)),
            "end_at": iso(T0 + timedelta(minutes=start_min + minutes)),
            "work_done_code": self.code.pk,
        }
        data.update(overrides)
        return data

    def make_ticket(self, **fields):
        defaults = {
            "received_at": T0,
            "cms_next_ticket_no": "X",
            "site": self.site,
            "customer": self.customer,
            "assigned_to": self.wahida,
            "ticket_type": "software",
            "incoming_channel": "email",
            "cms_added_on": T0,
            "issue_description": "i",
            "notes": "n",
            "created_by": self.syed,
        }
        defaults.update(fields)
        return Ticket.objects.create(**defaults)


class TicketCreateTests(TicketTestCase):
    def test_creates_ticket_with_nested_activities_and_computed_durations(self):
        body = self.payload(
            activities=[
                self.activity(0, 90),
                self.activity(120, 45, activity_type="follow_up", resolved_by=self.wahida.pk),
            ]
        )
        response = self.client.post(TICKETS_URL, body, format="json")

        self.assertEqual(response.status_code, 201, response.content)
        ticket = Ticket.objects.get(pk=response.json()["id"])
        self.assertEqual(
            list(ticket.activities.values_list("duration_minutes", flat=True)), [90, 45]
        )
        # 135 minutes -> 2.25 h, computed server-side.
        self.assertEqual(ticket.total_duration_hours, Decimal("2.25"))
        self.assertEqual(response.json()["total_duration_hours"], 2.25)
        self.assertEqual(response.json()["status"], "open")

    def test_activity_totals_override_a_client_supplied_total(self):
        body = self.payload(total_duration_hours="99.00", activities=[self.activity(0, 30)])
        response = self.client.post(TICKETS_URL, body, format="json")
        self.assertEqual(Ticket.objects.get(pk=response.json()["id"]).total_duration_hours, Decimal("0.50"))

    def test_manual_total_is_kept_when_there_are_no_activities(self):
        response = self.client.post(TICKETS_URL, self.payload(total_duration_hours="3.75"), format="json")
        self.assertEqual(Ticket.objects.get(pk=response.json()["id"]).total_duration_hours, Decimal("3.75"))

    def test_explicit_activity_duration_wins_over_start_end(self):
        body = self.payload(activities=[self.activity(0, 90, duration_minutes=60)])
        response = self.client.post(TICKETS_URL, body, format="json")
        ticket = Ticket.objects.get(pk=response.json()["id"])
        self.assertEqual(ticket.activities.get().duration_minutes, 60)
        self.assertEqual(ticket.total_duration_hours, Decimal("1.00"))

    def test_created_by_is_always_the_authenticated_user(self):
        body = self.payload(created_by=self.wahida.pk)
        response = self.client.post(TICKETS_URL, body, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Ticket.objects.get(pk=response.json()["id"]).created_by, self.syed)
        self.assertEqual(response.json()["created_by"], "Syed Hussain")

    def test_missing_required_fields_are_reported_per_field(self):
        response = self.client.post(TICKETS_URL, {}, format="json")

        self.assertEqual(response.status_code, 400)
        errors = response.json()
        for field in [
            "received_at",
            "cms_next_ticket_no",
            "site",
            "customer",
            "assigned_to",
            "ticket_type",
            "incoming_channel",
            "cms_added_on",
            "issue_description",
            "notes",
        ]:
            with self.subTest(field=field):
                self.assertIn(field, errors)
        self.assertFalse(Ticket.objects.exists())

    def test_blank_text_is_rejected(self):
        response = self.client.post(TICKETS_URL, self.payload(notes="   "), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("notes", response.json())

    def test_invalid_activity_rolls_back_the_whole_ticket(self):
        bad = self.activity(0, 30)
        bad["end_at"] = iso(T0 - timedelta(hours=1))
        response = self.client.post(
            TICKETS_URL, self.payload(activities=[self.activity(), bad]), format="json"
        )

        self.assertEqual(response.status_code, 400)
        # Errors are keyed by the failing activity's index; valid ones are omitted.
        self.assertEqual(
            response.json()["activities"], {"1": {"end_at": ["End must be after the start."]}}
        )
        self.assertFalse(Ticket.objects.exists())
        self.assertFalse(TicketActivity.objects.exists())

    def test_forwarded_requires_a_recipient_and_unforwarded_clears_it(self):
        missing = self.client.post(TICKETS_URL, self.payload(is_forwarded=True), format="json")
        self.assertEqual(missing.status_code, 400)
        self.assertIn("forwarded_to", missing.json())

        cleared = self.client.post(
            TICKETS_URL, self.payload(is_forwarded=False, forwarded_to=self.wahida.pk), format="json"
        )
        self.assertIsNone(Ticket.objects.get(pk=cleared.json()["id"]).forwarded_to)

    def test_verification_is_all_or_nothing(self):
        partial = self.client.post(
            TICKETS_URL, self.payload(cms_closed_on=iso(T0 + timedelta(days=1))), format="json"
        )
        self.assertEqual(partial.status_code, 400)
        self.assertEqual(
            set(partial.json()),
            {"resolution_verified_by", "resolution_verified_on", "cms_closed_by", "service_closed_date"},
        )

        closed = self.client.post(
            TICKETS_URL,
            self.payload(
                resolution_verified_by=self.wahida.pk,
                resolution_verified_on=iso(T0 + timedelta(days=1)),
                cms_closed_by=self.wahida.pk,
                cms_closed_on=iso(T0 + timedelta(days=1)),
                service_closed_date=iso(T0 + timedelta(days=1)),
            ),
            format="json",
        )
        self.assertEqual(closed.status_code, 201, closed.content)
        self.assertEqual(closed.json()["status"], "closed")
        self.assertEqual(closed.json()["cms_closed_by"], "Wahida Begum")

    def test_inactive_users_cannot_be_assigned(self):
        self.wahida.is_active = False
        self.wahida.save()
        response = self.client.post(TICKETS_URL, self.payload(), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("assigned_to", response.json())

    def test_requires_authentication(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(TICKETS_URL, self.payload(), format="json").status_code, 401)
        self.assertEqual(self.client.get(TICKETS_URL).status_code, 401)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix="tickets-test-media-"))
class TicketMultipartTests(TicketTestCase):
    """The browser sends multipart (for the PDF); activities travel as a JSON string."""

    @classmethod
    def tearDownClass(cls):
        from django.conf import settings

        shutil.rmtree(settings.MEDIA_ROOT, ignore_errors=True)
        super().tearDownClass()

    def post_multipart(self, pdf=None, **overrides):
        data = self.payload(**overrides)
        data["activities"] = json.dumps(data.pop("activities", [self.activity(0, 60)]))
        if pdf is not None:
            data["pdf_attachment"] = pdf
        return self.client.post(TICKETS_URL, data, format="multipart")

    def test_multipart_with_pdf_and_json_activities(self):
        pdf = SimpleUploadedFile("report.pdf", b"%PDF-1.7\n...", content_type="application/pdf")
        response = self.post_multipart(pdf, possible_root_cause="", forwarded_to="")

        self.assertEqual(response.status_code, 201, response.content)
        ticket = Ticket.objects.get(pk=response.json()["id"])
        self.assertTrue(ticket.pdf_attachment.name.startswith("tickets/attachments/report"))
        self.assertEqual(ticket.total_duration_hours, Decimal("1.00"))
        self.assertIsNone(ticket.forwarded_to)

    def test_non_pdf_content_is_rejected_even_with_a_pdf_name(self):
        fake = SimpleUploadedFile("report.pdf", b"MZ\x90\x00", content_type="application/pdf")
        response = self.post_multipart(fake)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["pdf_attachment"], ["The file isn't a valid PDF."])

    def test_wrong_extension_is_rejected(self):
        response = self.post_multipart(SimpleUploadedFile("notes.txt", b"%PDF-1.4"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("pdf_attachment", response.json())

    def test_malformed_activities_json_is_a_400(self):
        data = self.payload()
        data["activities"] = "[{not json"
        response = self.client.post(TICKETS_URL, data, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertIn("activities", response.json())


class TicketListTests(TicketTestCase):
    def setUp(self):
        super().setUp()
        self.old_closed = self.make_ticket(
            received_at=T0 - timedelta(days=3),
            cms_next_ticket_no="150001RA0000001",
            cms_closed_on=T0,
            cms_closed_by=self.wahida,
            total_duration_hours=Decimal("5.00"),
        )
        self.mid_open = self.make_ticket(
            received_at=T0 - timedelta(days=2),
            cms_next_ticket_no="150002RB0000002",
            site=self.other_site,
            assigned_to=self.syed,
            total_duration_hours=Decimal("1.50"),
        )
        self.new_open = self.make_ticket(
            received_at=T0 - timedelta(days=1),
            cms_next_ticket_no="150003RC0000003",
            total_duration_hours=Decimal("0.25"),
        )

    def ids(self, **params):
        response = self.client.get(TICKETS_URL, params)
        self.assertEqual(response.status_code, 200, response.content)
        return [row["id"] for row in response.json()["results"]]

    def test_default_is_newest_first_with_table_fields(self):
        body = self.client.get(TICKETS_URL).json()

        self.assertEqual([r["id"] for r in body["results"]], [self.new_open.pk, self.mid_open.pk, self.old_closed.pk])
        self.assertEqual((body["count"], body["total"]), (3, 3))
        self.assertEqual(
            set(body["results"][0]),
            {
                "id", "site_name", "site_ocn", "cms_next_ticket_no", "received_at", "status",
                "is_pre", "cms_closed_by", "created_by", "total_duration_hours",
                "cms_closed_on", "service_closed_date",
            },
        )
        closed = body["results"][2]
        self.assertEqual((closed["status"], closed["cms_closed_by"]), ("closed", "Wahida Begum"))
        self.assertIsNone(body["results"][0]["cms_closed_by"])

    def test_pagination(self):
        first = self.client.get(TICKETS_URL, {"page_size": 2}).json()
        second = self.client.get(TICKETS_URL, {"page_size": 2, "page": 2}).json()

        self.assertEqual(first["count"], 3)
        self.assertEqual(len(first["results"]), 2)
        self.assertEqual([r["id"] for r in second["results"]], [self.old_closed.pk])
        self.assertEqual(self.client.get(TICKETS_URL, {"page": 9}).status_code, 404)

    def test_page_size_is_capped(self):
        for n in range(3):
            self.make_ticket()
        response = self.client.get(TICKETS_URL, {"page_size": 100000})
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(response.json()["results"]), 200)

    def test_sorting(self):
        self.assertEqual(self.ids(ordering="received_at"), [self.old_closed.pk, self.mid_open.pk, self.new_open.pk])
        self.assertEqual(self.ids(ordering="-total_duration_hours")[0], self.old_closed.pk)
        # Closed < Open alphabetically, as the table displays them.
        self.assertEqual(self.ids(ordering="status")[0], self.old_closed.pk)
        self.assertEqual(self.ids(ordering="-status")[-1], self.old_closed.pk)
        # Empty closing dates sort last in both directions.
        self.assertEqual(self.ids(ordering="cms_closed_on")[0], self.old_closed.pk)
        self.assertEqual(self.ids(ordering="-cms_closed_on")[0], self.old_closed.pk)
        self.assertEqual(self.ids(ordering="site_name")[0], self.mid_open.pk)  # Makati < Tan

    def test_unknown_ordering_is_a_400(self):
        response = self.client.get(TICKETS_URL, {"ordering": "password"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("ordering", response.json())

    def test_status_filter(self):
        self.assertEqual(self.ids(status="closed"), [self.old_closed.pk])
        self.assertEqual(self.ids(status="open"), [self.new_open.pk, self.mid_open.pk])
        self.assertEqual(self.client.get(TICKETS_URL, {"status": "pending"}).status_code, 400)

    def test_site_and_date_filters(self):
        self.assertEqual(self.ids(site=self.other_site.pk), [self.mid_open.pk])
        self.assertEqual(
            self.ids(received_after=iso(T0 - timedelta(days=2, hours=1)), received_before=iso(T0 - timedelta(hours=12))),
            [self.new_open.pk, self.mid_open.pk],
        )
        self.assertEqual(self.client.get(TICKETS_URL, {"received_after": "yesterday"}).status_code, 400)
        self.assertEqual(self.client.get(TICKETS_URL, {"site": "abc"}).status_code, 400)

    def test_search_covers_the_table_text(self):
        self.assertEqual(self.ids(search="makati"), [self.mid_open.pk])  # site name
        self.assertEqual(self.ids(search="07014"), [self.mid_open.pk])  # OCN
        self.assertEqual(self.ids(search="RC000"), [self.new_open.pk])  # CMS ticket no
        self.assertEqual(self.ids(search="wahida begum"), [self.new_open.pk, self.old_closed.pk])  # assignee / closer full name
        self.assertEqual(self.ids(search="closed"), [self.old_closed.pk])  # status

    def test_search_and_filters_keep_the_unfiltered_total(self):
        body = self.client.get(TICKETS_URL, {"search": "no-such-ticket"}).json()
        self.assertEqual((body["count"], body["total"]), (0, 3))


class TypeaheadTests(TicketTestCase):
    def test_site_search_matches_name_or_ocn(self):
        names = [s["name"] for s in self.client.get("/api/tickets/sites/", {"q": "tan tock"}).json()]
        self.assertEqual(names, ["Tan Tock Seng Hospital"])
        by_ocn = self.client.get("/api/tickets/sites/", {"q": "07014"}).json()
        self.assertEqual([s["ocn"] for s in by_ocn], ["OCN07014-801-00"])
        self.assertEqual(len(self.client.get("/api/tickets/sites/").json()), 2)

    def test_site_quick_add(self):
        response = self.client.post("/api/tickets/sites/", {"name": " New Lab ", "ocn": "ocn01-801-00"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["name"], "New Lab")
        self.assertEqual(response.json()["ocn"], "OCN01-801-00")

        duplicate = self.client.post(
            "/api/tickets/sites/", {"name": "New Lab", "ocn": "OCN01-801-00"}, format="json"
        )
        self.assertEqual(duplicate.status_code, 400)

    def test_typeahead_results_are_capped(self):
        Site.objects.bulk_create(Site(name=f"Lab {n:02}", ocn=f"OCN{n:05}") for n in range(40))
        self.assertEqual(len(self.client.get("/api/tickets/sites/", {"q": "lab"}).json()), 20)

    def test_customer_search(self):
        Customer.objects.create(name="KPJ Healthcare")
        names = [c["name"] for c in self.client.get("/api/tickets/customers/", {"q": "kpj"}).json()]
        self.assertEqual(names, ["KPJ Healthcare"])

    def test_work_done_codes_list(self):
        self.assertEqual(
            self.client.get("/api/tickets/work-done-codes/").json(),
            [{"id": self.code.pk, "code": "RMD", "description": "Remote Diagnostic"}],
        )

    def test_typeaheads_require_authentication(self):
        self.client.force_authenticate(None)
        for url in ["/api/tickets/sites/", "/api/tickets/customers/", "/api/tickets/work-done-codes/"]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 401)


class TicketUpdateTests(TicketTestCase):
    """PATCH/PUT /api/tickets/<id>/: same rules as creation; activities are replaced as a set."""

    def setUp(self):
        super().setUp()
        response = self.client.post(
            TICKETS_URL,
            self.payload(
                activities=[
                    self.activity(0, 60, is_likely_cause=True),
                    self.activity(90, 30, activity_type="follow_up"),
                ]
            ),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.ticket = Ticket.objects.get(pk=response.json()["id"])
        self.url = f"{TICKETS_URL}{self.ticket.pk}/"

    def patch(self, body):
        return self.client.patch(self.url, body, format="json")

    def close_fields(self):
        at = iso(T0 + timedelta(days=1))
        return {
            "resolution_verified_by": self.wahida.pk,
            "resolution_verified_on": at,
            "cms_closed_by": self.wahida.pk,
            "cms_closed_on": at,
            "service_closed_date": at,
        }

    def test_detail_returns_everything_needed_to_prefill_the_form(self):
        body = self.client.get(self.url).json()

        self.assertEqual(body["site"], {"id": self.site.pk, "name": self.site.name, "ocn": self.site.ocn})
        self.assertEqual(body["assigned_to"]["username"], "wahida")
        self.assertEqual(body["status"], "open")
        self.assertIsNone(body["pdf_attachment_name"])
        self.assertEqual(body["total_duration_hours"], 1.5)
        self.assertEqual(
            [(a["activity_type"], a["duration_minutes"], a["is_likely_cause"]) for a in body["activities"]],
            [("remote_support", 60, True), ("follow_up", 30, False)],
        )
        self.assertEqual(body["created_by"]["username"], "syed")

    def test_patch_updates_top_level_fields_only(self):
        response = self.patch({"notes": "Updated notes", "is_pre": True})

        self.assertEqual(response.status_code, 200, response.content)
        self.ticket.refresh_from_db()
        self.assertEqual((self.ticket.notes, self.ticket.is_pre), ("Updated notes", True))
        # Activities weren't sent, so they're untouched.
        self.assertEqual(self.ticket.activities.count(), 2)
        self.assertEqual(self.ticket.total_duration_hours, Decimal("1.50"))

    def test_replacing_activities_adds_edits_and_removes_and_recomputes_the_total(self):
        # Keep the first (edited: 60 -> 45 min), drop the second, add a new 120-min one.
        response = self.patch(
            {"activities": [self.activity(0, 45, is_likely_cause=True), self.activity(200, 120)]}
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            list(self.ticket.activities.order_by("start_at").values_list("duration_minutes", flat=True)),
            [45, 120],
        )
        self.assertEqual(TicketActivity.objects.count(), 2)  # nothing orphaned or duplicated
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.total_duration_hours, Decimal("2.75"))
        self.assertEqual(response.json()["total_duration_hours"], 2.75)

    def test_removing_all_activities_makes_the_total_manual_again(self):
        response = self.patch({"activities": [], "total_duration_hours": "4.00"})

        self.assertEqual(response.status_code, 200, response.content)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.activities.count(), 0)
        self.assertEqual(self.ticket.total_duration_hours, Decimal("4.00"))

    def test_a_total_that_contradicts_existing_activities_is_ignored(self):
        self.patch({"total_duration_hours": "99.00"})
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.total_duration_hours, Decimal("1.50"))

    def test_zero_activity_ticket_keeps_a_manual_total_on_edit(self):
        plain = self.client.post(TICKETS_URL, self.payload(total_duration_hours="2.00"), format="json")
        url = f"{TICKETS_URL}{plain.json()['id']}/"

        response = self.client.patch(url, {"total_duration_hours": "3.25"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total_duration_hours"], 3.25)

    def test_closing_then_reopening(self):
        closed = self.patch(self.close_fields())
        self.assertEqual(closed.status_code, 200, closed.content)
        self.assertEqual(closed.json()["status"], "closed")

        # Reopening = clearing all five (allowed); the list agrees.
        reopened = self.patch({field: None for field in self.close_fields()})
        self.assertEqual(reopened.status_code, 200, reopened.content)
        self.assertEqual(reopened.json()["status"], "open")
        row = self.client.get(TICKETS_URL).json()["results"][0]
        self.assertEqual((row["status"], row["cms_closed_on"]), ("open", None))

    def test_incomplete_verification_is_rejected_on_update_too(self):
        response = self.patch({"cms_closed_on": iso(T0 + timedelta(days=1))})
        self.assertEqual(response.status_code, 400)
        self.assertIn("cms_closed_by", response.json())

        # Clearing only some fields of a closed ticket is just as incomplete.
        self.patch(self.close_fields())
        partial_reopen = self.patch({"cms_closed_on": None})
        self.assertEqual(partial_reopen.status_code, 400)
        self.assertEqual(set(partial_reopen.json()), {"cms_closed_on"})
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status, "closed")

    def test_created_by_never_changes(self):
        response = self.patch({"created_by": self.wahida.pk, "notes": "n2"})
        self.assertEqual(response.status_code, 200)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.created_by, self.syed)

    def test_any_authenticated_user_may_edit(self):
        self.client.force_authenticate(self.wahida)  # not the creator
        self.assertEqual(self.patch({"notes": "by wahida"}).status_code, 200)

    def test_required_fields_cannot_be_blanked(self):
        response = self.patch({"notes": "  ", "site": None})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.json()), {"notes", "site"})

    def test_forwarding_rules_use_the_final_state(self):
        missing = self.patch({"is_forwarded": True})
        self.assertEqual(missing.status_code, 400)
        self.assertIn("forwarded_to", missing.json())

        self.patch({"is_forwarded": True, "forwarded_to": self.wahida.pk})
        # A later PATCH that doesn't mention forwarding keeps the recipient.
        self.patch({"notes": "still forwarded"})
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.forwarded_to, self.wahida)
        # Turning it off clears the recipient.
        self.patch({"is_forwarded": False})
        self.ticket.refresh_from_db()
        self.assertIsNone(self.ticket.forwarded_to)

    def test_put_requires_the_full_ticket(self):
        response = self.client.put(self.url, {"notes": "only this"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("site", response.json())

    def test_unknown_ticket_is_404(self):
        self.assertEqual(self.client.get(f"{TICKETS_URL}999999/").status_code, 404)
        self.assertEqual(self.client.patch(f"{TICKETS_URL}999999/", {}, format="json").status_code, 404)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix="tickets-test-media-"))
class TicketMultipartUpdateTests(TicketTestCase):
    """The edit dialog sends multipart; empty strings mean "clear" for clearable fields."""

    @classmethod
    def tearDownClass(cls):
        from django.conf import settings

        shutil.rmtree(settings.MEDIA_ROOT, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        pdf = SimpleUploadedFile("first.pdf", b"%PDF-1.7 first", content_type="application/pdf")
        data = self.payload(pdf_attachment=pdf, is_forwarded="true", forwarded_to=self.wahida.pk)
        data["activities"] = json.dumps([self.activity(0, 60)])
        response = self.client.post(TICKETS_URL, data, format="multipart")
        self.assertEqual(response.status_code, 201, response.content)
        self.ticket = Ticket.objects.get(pk=response.json()["id"])
        self.url = f"{TICKETS_URL}{self.ticket.pk}/"

    def test_empty_strings_clear_optional_fields_and_the_pdf(self):
        from django.core.files.storage import default_storage

        old = self.ticket.pdf_attachment.name
        clear = {"is_forwarded": "false", "forwarded_to": "", "possible_root_cause": "", "pdf_attachment": ""}
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(self.url, clear, format="multipart")

        self.assertEqual(response.status_code, 200, response.content)
        self.ticket.refresh_from_db()
        self.assertIsNone(self.ticket.forwarded_to)
        self.assertEqual(self.ticket.pdf_attachment.name, "")
        self.assertFalse(default_storage.exists(old))  # the old file is cleaned up
        self.assertIsNone(response.json()["pdf_attachment_name"])

    def test_replacing_the_pdf(self):
        new = SimpleUploadedFile("second.pdf", b"%PDF-1.7 second", content_type="application/pdf")
        response = self.client.patch(self.url, {"pdf_attachment": new}, format="multipart")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["pdf_attachment_name"].startswith("second"))

    def test_omitted_pdf_is_kept(self):
        response = self.client.patch(self.url, {"notes": "keep the file"}, format="multipart")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["pdf_attachment_name"].startswith("first"))

    def test_multipart_activities_replace_the_set(self):
        body = {"activities": json.dumps([self.activity(0, 15), self.activity(30, 15)])}
        response = self.client.patch(self.url, body, format="multipart")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["total_duration_hours"], 0.5)
        self.assertEqual(len(response.json()["activities"]), 2)
