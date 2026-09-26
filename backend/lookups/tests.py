from datetime import date, datetime, timezone as dt_timezone

from rest_framework.test import APITestCase

from accounts.models import User
from tickets.models import (
    Country,
    Customer,
    Holiday,
    Site,
    Ticket,
    TicketActivity,
    WorkDoneCode,
)

BASE = "/api/lookups/"
T0 = datetime(2026, 9, 1, 9, 0, tzinfo=dt_timezone.utc)


class LookupTestCase(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user("boss", password="pw", role=User.Role.ADMIN)
        self.staff = User.objects.create_user("syed", password="pw", first_name="Syed")
        self.my = Country.objects.create(name="Malaysia", code="MY")
        self.sg = Country.objects.create(name="Singapore", code="SG")
        self.site = Site.objects.create(name="Tan Tock Seng Hospital", ocn="OCN05529-801-00", country=self.sg)
        self.code = WorkDoneCode.objects.create(code="RMD", description="Remote Diagnostic")
        self.holiday = Holiday.objects.create(name="New Year's Day", date=date(2026, 1, 1))
        self.customer = Customer.objects.create(name="SingHealth")

    def make_ticket(self, **fields):
        defaults = {
            "received_at": T0,
            "cms_next_ticket_no": "X",
            "site": self.site,
            "customer": self.customer,
            "assigned_to": self.staff,
            "ticket_type": "software",
            "incoming_channel": "email",
            "cms_added_on": T0,
            "issue_description": "i",
            "notes": "n",
            "created_by": self.staff,
        }
        defaults.update(fields)
        return Ticket.objects.create(**defaults)


# One row per endpoint: (path, existing object attr, valid create body, valid patch body).
def endpoints(tc):
    return [
        ("countries", tc.my, {"name": "Maldives", "code": "mv"}, {"name": "Malaysia (MY)"}),
        ("sites", tc.site, {"name": "New Lab", "ocn": "OCN1-801-00", "country": tc.my.pk}, {"address": "1 Jalan"}),
        ("customers", tc.customer, {"name": "KPJ Healthcare"}, {"name": "KPJ Healthcare Berhad"}),
        ("work-done-codes", tc.code, {"code": "xyz", "description": "Something"}, {"is_active": False}),
        ("holidays", tc.holiday, {"name": "Deepavali", "date": "2026-11-08", "is_recurring_annually": False, "country": tc.my.pk}, {"name": "New Year"}),
    ]


class PermissionTests(LookupTestCase):
    """Reads: any signed-in user. Writes: admin role only. Every endpoint x method."""

    def test_anonymous_gets_nothing(self):
        for path, obj, _, _ in endpoints(self):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(f"{BASE}{path}/").status_code, 401)

    def test_staff_can_read_but_not_write(self):
        self.client.force_authenticate(self.staff)
        for path, obj, create, patch in endpoints(self):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(f"{BASE}{path}/").status_code, 200)
                self.assertEqual(self.client.get(f"{BASE}{path}/{obj.pk}/").status_code, 200)
                self.assertEqual(self.client.post(f"{BASE}{path}/", create, format="json").status_code, 403)
                self.assertEqual(
                    self.client.patch(f"{BASE}{path}/{obj.pk}/", patch, format="json").status_code, 403
                )
                self.assertEqual(self.client.delete(f"{BASE}{path}/{obj.pk}/").status_code, 403)
                self.assertTrue(type(obj).objects.filter(pk=obj.pk).exists())

    def test_admin_can_create_update_and_delete(self):
        self.client.force_authenticate(self.admin)
        for path, _, create, patch in endpoints(self):
            with self.subTest(path=path):
                created = self.client.post(f"{BASE}{path}/", create, format="json")
                self.assertEqual(created.status_code, 201, created.content)
                url = f"{BASE}{path}/{created.json()['id']}/"
                updated = self.client.patch(url, patch, format="json")
                self.assertEqual(updated.status_code, 200, updated.content)
                for key, value in patch.items():
                    self.assertEqual(updated.json()[key], value)
                self.assertEqual(self.client.delete(url).status_code, 204)
                self.assertEqual(self.client.get(url).status_code, 404)

    def test_put_is_not_offered(self):
        self.client.force_authenticate(self.admin)
        response = self.client.put(f"{BASE}countries/{self.my.pk}/", {"name": "M", "code": "MY"}, format="json")
        self.assertEqual(response.status_code, 405)


class SearchAndOrderingTests(LookupTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.staff)

    def names(self, path, key="name", **params):
        response = self.client.get(f"{BASE}{path}/", params)
        self.assertEqual(response.status_code, 200)
        return [row[key] for row in response.json()]

    def test_country_search_by_name_or_code_and_ordering(self):
        self.assertEqual(self.names("countries", search="sing"), ["Singapore"])
        self.assertEqual(self.names("countries", search="my"), ["Malaysia"])
        self.assertEqual(self.names("countries", ordering="-name"), ["Singapore", "Malaysia"])

    def test_site_search_covers_ocn_and_country(self):
        Site.objects.create(name="Makati Medical Center", ocn="OCN07014-801-00")
        self.assertEqual(self.names("sites", search="07014"), ["Makati Medical Center"])
        self.assertEqual(self.names("sites", search="singapore"), ["Tan Tock Seng Hospital"])
        row = self.client.get(f"{BASE}sites/", {"search": "tan"}).json()[0]
        self.assertEqual((row["country_name"], row["country_code"], row["is_active"]), ("Singapore", "SG", True))

    def test_work_done_code_search_by_description(self):
        WorkDoneCode.objects.create(code="CAL", description="Calibration")
        self.assertEqual(self.names("work-done-codes", key="code", search="calib"), ["CAL"])
        self.assertEqual(self.names("work-done-codes", key="code", ordering="-code"), ["RMD", "CAL"])

    def test_holidays_default_to_calendar_order_ignoring_the_stored_year(self):
        Holiday.objects.create(name="Christmas", date=date(2020, 12, 25))  # recurring; year irrelevant
        Holiday.objects.create(name="National Day", date=date(2027, 8, 31), country=self.my)
        self.assertEqual(self.names("holidays"), ["New Year's Day", "National Day", "Christmas"])
        self.assertEqual(self.names("holidays", search="malaysia"), ["National Day"])


class ProtectedDeleteTests(LookupTestCase):
    """Records still referenced elsewhere answer 409 with a count and stay put."""

    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.admin)

    def test_site_in_use(self):
        for _ in range(3):
            self.make_ticket()
        response = self.client.delete(f"{BASE}sites/{self.site.pk}/")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["detail"],
            "This site is used by 3 tickets and can't be deleted. Deactivate it instead.",
        )
        self.assertTrue(Site.objects.filter(pk=self.site.pk).exists())

    def test_work_done_code_in_use(self):
        ticket = self.make_ticket()
        TicketActivity.objects.create(
            ticket=ticket, activity_type="follow_up", start_at=T0, end_at=T0, work_done_code=self.code
        )
        response = self.client.delete(f"{BASE}work-done-codes/{self.code.pk}/")

        self.assertEqual(response.status_code, 409)
        self.assertIn("used by 1 ticket activity", response.json()["detail"])
        self.assertTrue(WorkDoneCode.objects.filter(pk=self.code.pk).exists())

    def test_country_in_use_by_sites_and_holidays(self):
        Holiday.objects.create(name="National Day", date=date(2026, 8, 9), country=self.sg)
        response = self.client.delete(f"{BASE}countries/{self.sg.pk}/")

        self.assertEqual(response.status_code, 409)
        detail = response.json()["detail"]
        self.assertIn("1 site", detail)
        self.assertIn("1 holiday", detail)
        self.assertTrue(Country.objects.filter(pk=self.sg.pk).exists())

    def test_customer_in_use(self):
        self.make_ticket()
        self.make_ticket()
        response = self.client.delete(f"{BASE}customers/{self.customer.pk}/")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json(),
            {
                "detail": "This customer is used by 2 tickets and can't be deleted. "
                "Move those tickets to another customer first.",
                "in_use": True,
            },
        )
        self.assertTrue(Customer.objects.filter(pk=self.customer.pk).exists())

    def test_unused_records_delete(self):
        unused_site = Site.objects.create(name="Spare", ocn="OCN0")
        for url in [
            f"{BASE}sites/{unused_site.pk}/",
            f"{BASE}customers/{self.customer.pk}/",
            f"{BASE}work-done-codes/{self.code.pk}/",
            f"{BASE}countries/{self.my.pk}/",
            f"{BASE}holidays/{self.holiday.pk}/",
        ]:
            with self.subTest(url=url):
                self.assertEqual(self.client.delete(url).status_code, 204)


class ValidationTests(LookupTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.admin)

    def post(self, path, body):
        return self.client.post(f"{BASE}{path}/", body, format="json")

    def test_country_code_is_normalised_to_uppercase(self):
        response = self.post("countries", {"name": " Maldives ", "code": " mv "})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual((response.json()["name"], response.json()["code"]), ("Maldives", "MV"))

    def test_country_code_must_be_two_letters(self):
        for bad in ["M", "MYS", "M1", "", "1Z"]:
            with self.subTest(code=bad):
                response = self.post("countries", {"name": f"Country {bad}", "code": bad})
                self.assertEqual(response.status_code, 400)
                self.assertIn("code", response.json())

    def test_country_duplicates_are_field_errors_even_with_different_case(self):
        response = self.post("countries", {"name": "malaysia", "code": "my"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["name"], ["A country with this name already exists."])
        self.assertEqual(response.json()["code"], ["Another country already uses this code."])

    def test_updating_a_country_to_its_own_values_is_fine(self):
        response = self.client.patch(f"{BASE}countries/{self.my.pk}/", {"code": "my"}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_model_save_normalises_codes_too(self):
        self.assertEqual(Country.objects.create(name="Fiji", code=" fj").code, "FJ")

    def test_site_duplicate_name_and_ocn(self):
        response = self.post("sites", {"name": "tan tock seng hospital", "ocn": "ocn05529-801-00"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["ocn"], ["This site already has this OCN."])

    def test_site_requires_name_and_ocn_but_not_country(self):
        response = self.post("sites", {})
        self.assertEqual(set(response.json()), {"name", "ocn"})
        ok = self.post("sites", {"name": "No Country Lab", "ocn": "OCN9"})
        self.assertEqual(ok.status_code, 201)
        self.assertIsNone(ok.json()["country"])

    def test_customer_name_is_trimmed_and_unique_case_insensitively(self):
        created = self.post("customers", {"name": "  KPJ Healthcare  "})
        self.assertEqual((created.status_code, created.json()["name"]), (201, "KPJ Healthcare"))
        duplicate = self.post("customers", {"name": "singhealth"})
        self.assertEqual(duplicate.status_code, 400)
        self.assertEqual(duplicate.json(), {"name": ["A customer with this name already exists."]})
        self.assertEqual(self.post("customers", {"name": "   "}).status_code, 400)
        # Saving a customer under its own name isn't a clash with itself.
        same = self.client.patch(f"{BASE}customers/{self.customer.pk}/", {"name": "SINGHEALTH"}, format="json")
        self.assertEqual((same.status_code, same.json()["name"]), (200, "SINGHEALTH"))

    def test_customer_search_and_ordering(self):
        Customer.objects.create(name="Apollo Hospitals")
        rows = self.client.get(f"{BASE}customers/", {"search": "apollo"}).json()
        self.assertEqual([r["name"] for r in rows], ["Apollo Hospitals"])
        rows = self.client.get(f"{BASE}customers/", {"ordering": "-name"}).json()
        self.assertEqual([r["name"] for r in rows], ["SingHealth", "Apollo Hospitals"])

    def test_work_done_code_duplicate_case_insensitive(self):
        response = self.post("work-done-codes", {"code": "rmd", "description": "Again"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.json())

    def test_holiday_date_required_and_semantics_stored(self):
        self.assertIn("date", self.post("holidays", {"name": "No date"}).json())

        recurring = self.post("holidays", {"name": "Labour Day", "date": "2026-05-01"})
        self.assertEqual(recurring.status_code, 201)
        self.assertEqual(
            (recurring.json()["is_recurring_annually"], recurring.json()["country"]), (True, None)
        )  # defaults: yearly, global

        dated = self.post(
            "holidays",
            {"name": "Deepavali", "date": "2026-11-08", "is_recurring_annually": False, "country": self.my.pk},
        )
        body = dated.json()
        self.assertEqual((body["date"], body["is_recurring_annually"], body["country_code"]), ("2026-11-08", False, "MY"))

    def test_duplicate_holiday_in_the_same_scope(self):
        response = self.post("holidays", {"name": "new year's day", "date": "2026-01-01"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("date", response.json())
        # Same name/date for a specific country is a different holiday.
        other = self.post("holidays", {"name": "New Year's Day", "date": "2026-01-01", "country": self.my.pk})
        self.assertEqual(other.status_code, 201)


class TicketFormVisibilityTests(LookupTestCase):
    """Deactivation hides records from the ticket form without breaking existing tickets."""

    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.staff)

    def test_inactive_sites_leave_the_ticket_typeahead_but_stay_on_the_lookup_page(self):
        self.site.is_active = False
        self.site.save()
        self.assertEqual(self.client.get("/api/tickets/sites/", {"q": "tan"}).json(), [])
        self.assertEqual(len(self.client.get(f"{BASE}sites/", {"search": "tan"}).json()), 1)

    def test_in_use_site_409_then_deactivate_instead(self):
        self.make_ticket()
        self.client.force_authenticate(self.admin)

        refused = self.client.delete(f"{BASE}sites/{self.site.pk}/")
        self.assertEqual(refused.status_code, 409)

        deactivated = self.client.patch(f"{BASE}sites/{self.site.pk}/", {"is_active": False}, format="json")
        self.assertEqual(deactivated.status_code, 200)
        # Gone from the ticket form's typeahead...
        self.assertEqual(self.client.get("/api/tickets/sites/", {"q": "tan"}).json(), [])
        # ...still listed, and still editable, on the Sites lookup page.
        listed = self.client.get(f"{BASE}sites/", {"search": "tan"}).json()
        self.assertEqual([(s["id"], s["is_active"]) for s in listed], [(self.site.pk, False)])
        renamed = self.client.patch(
            f"{BASE}sites/{self.site.pk}/", {"address": "11 Jalan Tan Tock Seng"}, format="json"
        )
        self.assertEqual(renamed.status_code, 200)
        # The ticket that uses it is untouched.
        self.assertEqual(Ticket.objects.get().site_id, self.site.pk)

    def test_quick_added_site_appears_on_the_lookup_page(self):
        self.client.force_authenticate(self.admin)  # quick-add is admin-only
        created = self.client.post("/api/tickets/sites/", {"name": "Quick Lab", "ocn": "OCN77"}, format="json")
        self.assertEqual(created.status_code, 201)
        row = self.client.get(f"{BASE}sites/", {"search": "quick"}).json()[0]
        self.assertEqual((row["name"], row["is_active"], row["country"]), ("Quick Lab", True, None))

    def test_quick_added_customer_appears_on_the_lookup_page(self):
        self.client.force_authenticate(self.admin)
        created = self.client.post("/api/tickets/customers/", {"name": "Quick Health"}, format="json")
        self.assertEqual(created.status_code, 201)
        rows = self.client.get(f"{BASE}customers/", {"search": "quick"}).json()
        self.assertEqual([r["name"] for r in rows], ["Quick Health"])

    def test_ticket_form_codes_include_inactive_flag(self):
        self.code.is_active = False
        self.code.save()
        codes = self.client.get("/api/tickets/work-done-codes/").json()
        self.assertEqual(codes, [{"id": self.code.pk, "code": "RMD", "description": "Remote Diagnostic", "is_active": False}])
