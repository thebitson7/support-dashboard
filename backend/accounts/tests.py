from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.exceptions import ValidationError
from rest_framework.test import APITestCase

TOKEN_URL = "/api/auth/token/"
REFRESH_URL = "/api/auth/token/refresh/"
BLACKLIST_URL = "/api/auth/token/blacklist/"
ME_URL = "/api/auth/me/"
PASSWORD = "a-strong-test-passphrase-42"


class AuthTestCase(APITestCase):
    def setUp(self):
        # The login throttle lives in the cache, which outlives a test's
        # database transaction.
        cache.clear()
        self.user = get_user_model().objects.create_user(username="agent", password=PASSWORD)

    def login(self, username="agent", password=PASSWORD, **extra):
        return self.client.post(TOKEN_URL, {"username": username, "password": password}, **extra)


class TokenAuthTests(AuthTestCase):
    def test_valid_credentials_return_access_and_refresh_tokens(self):
        response = self.login()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"access", "refresh"})

    def test_wrong_password_is_rejected(self):
        self.assertEqual(self.login(password="wrong").status_code, 401)

    def test_refresh_token_issues_a_new_access_token(self):
        tokens = self.login().json()

        response = self.client.post(REFRESH_URL, {"refresh": tokens["refresh"]})

        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.json())

    def test_api_is_private_by_default(self):
        self.assertEqual(
            settings.REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"],
            ["rest_framework.permissions.IsAuthenticated"],
        )

    def test_me_returns_the_token_owner(self):
        access = self.login().json()["access"]
        response = self.client.get(ME_URL, HTTP_AUTHORIZATION=f"Bearer {access}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "id": self.user.pk,
                "username": "agent",
                "first_name": "",
                "last_name": "",
                "role": "staff",
                "timezone": "Asia/Kuala_Lumpur",
            },
        )


class LogoutBlacklistTests(AuthTestCase):
    def test_blacklisted_refresh_token_cannot_be_used_again(self):
        refresh = self.login().json()["refresh"]

        self.assertEqual(self.client.post(BLACKLIST_URL, {"refresh": refresh}).status_code, 200)

        response = self.client.post(REFRESH_URL, {"refresh": refresh})
        self.assertEqual(response.status_code, 401)

    def test_blacklisting_does_not_affect_other_sessions(self):
        first = self.login().json()["refresh"]
        second = self.login().json()["refresh"]

        self.client.post(BLACKLIST_URL, {"refresh": first})

        self.assertEqual(self.client.post(REFRESH_URL, {"refresh": second}).status_code, 200)


class InactiveUserTests(AuthTestCase):
    def test_inactive_user_cannot_sign_in(self):
        self.user.is_active = False
        self.user.save()
        self.assertEqual(self.login().status_code, 401)

    def test_deactivation_revokes_an_existing_access_token(self):
        access = self.login().json()["access"]
        self.user.is_active = False
        self.user.save()

        response = self.client.get(ME_URL, HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(response.status_code, 401)

    def test_deactivation_blocks_refresh(self):
        refresh = self.login().json()["refresh"]
        self.user.is_active = False
        self.user.save()

        self.assertEqual(self.client.post(REFRESH_URL, {"refresh": refresh}).status_code, 401)


class LoginRateLimitTests(AuthTestCase):
    """Default rate: 5 attempts per username + client IP per 5 minutes."""

    def exhaust(self, username="agent", **extra):
        for _ in range(5):
            self.assertEqual(self.login(username, "wrong", **extra).status_code, 401)

    def test_sixth_attempt_is_throttled_with_retry_after(self):
        self.exhaust()

        response = self.login()  # even with the right password

        self.assertEqual(response.status_code, 429)
        self.assertIn("Too many sign-in attempts", response.json()["detail"])
        self.assertTrue(0 < int(response["Retry-After"]) <= 300)

    def test_username_is_case_insensitive_for_the_limit(self):
        self.exhaust("agent")
        self.assertEqual(self.login("AGENT").status_code, 429)

    def test_other_usernames_from_the_same_ip_are_unaffected(self):
        self.exhaust("agent")
        get_user_model().objects.create_user(username="other", password=PASSWORD)
        self.assertEqual(self.login("other").status_code, 200)

    def test_same_username_from_another_client_ip_is_unaffected(self):
        # Requests relayed by the trusted Next.js proxy carry the browser's IP.
        self.exhaust(REMOTE_ADDR="127.0.0.1", HTTP_X_FORWARDED_FOR="203.0.113.1")
        response = self.login(REMOTE_ADDR="127.0.0.1", HTTP_X_FORWARDED_FOR="203.0.113.2")
        self.assertEqual(response.status_code, 200)

    def test_forwarded_for_from_an_untrusted_caller_is_ignored(self):
        # A client talking to the API directly can't dodge the limit by
        # inventing a new X-Forwarded-For per request.
        for n in range(5):
            self.login("agent", "wrong", REMOTE_ADDR="198.51.100.7", HTTP_X_FORWARDED_FOR=f"10.0.0.{n}")
        response = self.login(REMOTE_ADDR="198.51.100.7", HTTP_X_FORWARDED_FOR="10.0.0.99")
        self.assertEqual(response.status_code, 429)

    def test_non_object_body_does_not_crash_the_throttle(self):
        response = self.client.post(TOKEN_URL, ["not", "an", "object"], format="json")
        self.assertEqual(response.status_code, 400)


class TimezoneFieldTests(AuthTestCase):
    """
    The User.timezone field itself: default, validation, safe fallback. How the
    zone drives period boundaries (always the viewer's) is tested in
    working_hours.tests.TimezoneBoundaryTests.
    """

    def test_default_is_kuala_lumpur(self):
        self.assertEqual(self.user.timezone, "Asia/Kuala_Lumpur")

    def test_unknown_zone_is_rejected(self):
        self.user.timezone = "Mars/Olympus_Mons"
        with self.assertRaises(ValidationError):
            self.user.full_clean()

    def test_bad_stored_zone_falls_back_instead_of_crashing(self):
        self.user.timezone = "Not/AZone"
        self.assertEqual(str(self.user.tzinfo), "Asia/Kuala_Lumpur")


class UserSearchTests(AuthTestCase):
    URL = "/api/accounts/users/"

    def setUp(self):
        super().setUp()
        User = get_user_model()
        User.objects.create_user("syed", password="pw", first_name="Syed", last_name="Hussain")
        User.objects.create_user("naleefa", password="pw", first_name="Naleefa", last_name="Kareem")
        User.objects.create_user("gone", password="pw", first_name="Syed", last_name="Gone", is_active=False)
        self.client.force_authenticate(self.user)  # a plain staff user

    def usernames(self, q):
        response = self.client.get(self.URL, {"q": q})
        self.assertEqual(response.status_code, 200)
        return [u["username"] for u in response.json()]

    def test_any_authenticated_user_can_search_and_inactive_users_are_hidden(self):
        self.assertEqual(self.usernames("syed"), ["syed"])

    def test_matches_username_first_last_and_full_name(self):
        self.assertEqual(self.usernames("kareem"), ["naleefa"])
        self.assertEqual(self.usernames("syed huss"), ["syed"])
        self.assertEqual(self.usernames("NALEEFA"), ["naleefa"])

    def test_results_are_capped_and_shaped_like_the_user_summary(self):
        User = get_user_model()
        User.objects.bulk_create(User(username=f"bulk{n:02}") for n in range(30))
        body = self.client.get(self.URL, {"q": "bulk"}).json()
        self.assertEqual(len(body), 20)
        self.assertEqual(set(body[0]), {"id", "username", "first_name", "last_name", "role", "timezone"})

    def test_requires_authentication(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.URL).status_code, 401)
