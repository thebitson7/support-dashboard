"""Administration: admin-only user management (/api/accounts/admin/users/)."""

from unittest.mock import patch

from django.core.cache import cache
from rest_framework.test import APITestCase
from rest_framework.throttling import SimpleRateThrottle

from accounts.models import User

LIST_URL = "/api/accounts/admin/users/"
STRONG = "Correct-Horse-9-Battery"


def detail_url(user):
    return f"{LIST_URL}{user.pk}/"


class AdminTestCase(APITestCase):
    def setUp(self):
        cache.clear()  # the throttle counts live in the cache
        self.admin = User.objects.create_user(
            "boss", password=STRONG, first_name="Ada", last_name="Admin", role=User.Role.ADMIN
        )
        self.staff = User.objects.create_user("syed", password=STRONG, first_name="Syed", last_name="Hussain")
        self.client.force_authenticate(self.admin)

    def create(self, **overrides):
        body = {
            "username": "naleefa",
            "first_name": "Naleefa",
            "last_name": "Kareem",
            "role": "staff",
            "timezone": "Asia/Manila",
            "password": STRONG,
            **overrides,
        }
        return self.client.post(LIST_URL, body, format="json")

    def sign_in(self, username, password):
        return self.client_class().post("/api/auth/token/", {"username": username, "password": password}, format="json")


class AdministrationPermissionTests(AdminTestCase):
    def test_staff_are_refused_every_operation(self):
        self.client.force_authenticate(self.staff)
        responses = {
            "list": self.client.get(LIST_URL),
            "create": self.create(),
            "read": self.client.get(detail_url(self.admin)),
            "edit": self.client.patch(detail_url(self.staff), {"role": "admin"}, format="json"),
        }
        self.assertEqual({k: r.status_code for k, r in responses.items()}, dict.fromkeys(responses, 403))
        self.staff.refresh_from_db()
        self.assertEqual(self.staff.role, "staff")  # and nothing changed
        self.assertFalse(User.objects.filter(username="naleefa").exists())

    def test_anonymous_requests_are_refused(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(LIST_URL).status_code, 401)
        self.assertEqual(self.create().status_code, 401)

    def test_no_put_and_no_delete(self):
        self.assertEqual(self.client.put(detail_url(self.staff), {}, format="json").status_code, 405)
        self.assertEqual(self.client.delete(detail_url(self.staff)).status_code, 405)


class AdministrationListTests(AdminTestCase):
    def test_lists_everyone_active_or_not_staff_or_admin(self):
        gone = User.objects.create_user("gone", password=STRONG, first_name="Zed", is_active=False)
        rows = {u["username"]: u for u in self.client.get(LIST_URL).json()}
        self.assertEqual(set(rows), {"boss", "syed", "gone"})
        self.assertEqual((rows["gone"]["is_active"], rows["boss"]["role"]), (False, "admin"))
        self.assertEqual(rows["gone"]["id"], gone.pk)

    def test_never_exposes_password_material(self):
        body = str(self.client.get(LIST_URL).json())
        self.assertNotIn("password", body)
        self.assertNotIn("pbkdf2", body)
        self.assertEqual(
            set(self.client.get(LIST_URL).json()[0]),
            {"id", "username", "first_name", "last_name", "role", "timezone", "is_active", "last_login", "date_joined"},
        )

    def test_search_by_username_or_name_and_ordering(self):
        self.assertEqual([u["username"] for u in self.client.get(LIST_URL, {"search": "huss"}).json()], ["syed"])
        self.assertEqual([u["username"] for u in self.client.get(LIST_URL, {"search": "Syed Hussain"}).json()], ["syed"])
        self.assertEqual([u["username"] for u in self.client.get(LIST_URL, {"search": "bos"}).json()], ["boss"])
        ordered = [u["username"] for u in self.client.get(LIST_URL, {"ordering": "-role"}).json()]
        self.assertEqual(ordered, ["syed", "boss"])  # "staff" sorts after "admin"


class AdministrationCreateTests(AdminTestCase):
    def test_creates_a_user_who_can_sign_in(self):
        response = self.create()

        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertNotIn("password", body)
        self.assertEqual(
            (body["username"], body["role"], body["timezone"], body["is_active"]),
            ("naleefa", "staff", "Asia/Manila", True),
        )
        user = User.objects.get(username="naleefa")
        self.assertTrue(user.check_password(STRONG))
        self.assertNotEqual(user.password, STRONG)  # stored hashed
        self.assertEqual(self.sign_in("naleefa", STRONG).status_code, 200)

    def test_an_admin_can_grant_admin_access(self):
        self.assertEqual(self.create(role="admin").json()["role"], "admin")

    def test_usernames_are_unique_case_insensitively(self):
        response = self.create(username="SYED")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"username": ["A user with this username already exists."]})

    def test_weak_or_missing_passwords_are_refused_clearly(self):
        cases = {
            "": "Set a password for the new user.",
            "short1!": "This password is too short. It must contain at least 10 characters.",
            "1234567890123": "This password is entirely numeric.",
            "password1234": "This password is too common.",
            "naleefakareem": "The password is too similar to the",
        }
        for password, message in cases.items():
            with self.subTest(password=password):
                response = self.create(password=password)
                self.assertEqual(response.status_code, 400)
                self.assertTrue(any(message in m for m in response.json()["password"]), response.json())
        self.assertFalse(User.objects.filter(username="naleefa").exists())

    def test_invalid_fields(self):
        self.assertIn("timezone", self.create(timezone="Mars/Olympus").json())
        self.assertIn("role", self.create(role="superuser").json())
        self.assertIn("username", self.create(username="bad name!").json())
        self.assertIn("username", self.create(username="").json())


class AdministrationEditTests(AdminTestCase):
    def patch(self, user, body):
        return self.client.patch(detail_url(user), body, format="json")

    def test_edits_name_role_and_zone(self):
        response = self.patch(self.staff, {"first_name": " Syed A. ", "role": "admin", "timezone": "Indian/Maldives"})
        self.assertEqual(response.status_code, 200, response.content)
        self.staff.refresh_from_db()
        self.assertEqual((self.staff.first_name, self.staff.role, self.staff.timezone), ("Syed A.", "admin", "Indian/Maldives"))

    def test_deactivate_and_reactivate(self):
        self.assertEqual(self.patch(self.staff, {"is_active": False}).json()["is_active"], False)
        self.assertEqual(self.sign_in("syed", STRONG).status_code, 401)  # can't sign in
        self.assertEqual(self.patch(self.staff, {"is_active": True}).json()["is_active"], True)
        self.assertEqual(self.sign_in("syed", STRONG).status_code, 200)

    def test_password_reset_works_and_signs_the_user_out_everywhere(self):
        old_session = self.sign_in("syed", STRONG).json()["refresh"]

        new = "Another-Strong-7-Passphrase"
        self.assertEqual(self.patch(self.staff, {"new_password": new}).status_code, 200)

        self.assertEqual(self.sign_in("syed", STRONG).status_code, 401)
        self.assertEqual(self.sign_in("syed", new).status_code, 200)
        refreshed = self.client_class().post("/api/auth/token/refresh/", {"refresh": old_session}, format="json")
        self.assertEqual(refreshed.status_code, 401)  # the old session can't renew

    def test_deactivation_also_revokes_sessions(self):
        session = self.sign_in("syed", STRONG).json()["refresh"]
        self.patch(self.staff, {"is_active": False})
        self.patch(self.staff, {"is_active": True})
        refreshed = self.client_class().post("/api/auth/token/refresh/", {"refresh": session}, format="json")
        self.assertEqual(refreshed.status_code, 401)

    def test_new_passwords_are_validated_too(self):
        response = self.patch(self.staff, {"new_password": "short"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("new_password", response.json())
        self.assertIn("new_password", self.patch(self.staff, {"new_password": ""}).json())
        self.assertIn("password", self.patch(self.staff, {"password": STRONG}).json())
        self.staff.refresh_from_db()
        self.assertTrue(self.staff.check_password(STRONG))

    def test_usernames_are_fixed(self):
        response = self.patch(self.staff, {"username": "renamed"})
        self.assertEqual(response.json(), {"username": ["Usernames can't be changed once created."]})
        self.assertEqual(self.patch(self.staff, {"username": "syed", "last_name": "H"}).status_code, 200)

    def test_an_admin_cannot_demote_or_deactivate_themselves(self):
        demote = self.patch(self.admin, {"role": "staff"})
        deactivate = self.patch(self.admin, {"is_active": False})

        self.assertEqual(demote.status_code, 400)
        self.assertIn("You can't remove your own admin access", demote.json()["role"][0])
        self.assertEqual(deactivate.status_code, 400)
        self.assertIn("You can't deactivate your own account", deactivate.json()["is_active"][0])
        self.admin.refresh_from_db()
        self.assertEqual((self.admin.role, self.admin.is_active), ("admin", True))
        # Everything else about their own account can still be edited.
        self.assertEqual(self.patch(self.admin, {"timezone": "Asia/Manila", "role": "admin"}).status_code, 200)

    def test_another_admin_can_demote_an_admin(self):
        other = User.objects.create_user("second", password=STRONG, role=User.Role.ADMIN)
        self.assertEqual(self.patch(other, {"role": "staff"}).status_code, 200)


class AdministrationThrottleTests(AdminTestCase):
    def test_writes_are_rate_limited_per_admin_but_reads_are_not(self):
        with patch.dict(SimpleRateThrottle.THROTTLE_RATES, {"admin_writes": "3/h"}):
            for n in range(3):
                self.assertEqual(self.patch(self.staff, {"last_name": f"H{n}"}).status_code, 200)
            throttled = self.patch(self.staff, {"last_name": "H3"})
            self.assertEqual(throttled.status_code, 429)
            self.assertIn("Retry-After", throttled)
            self.assertEqual(self.create().status_code, 429)  # creating counts too
            self.assertEqual(self.client.get(LIST_URL).status_code, 200)  # reading doesn't

    def patch(self, user, body):
        return self.client.patch(detail_url(user), body, format="json")
