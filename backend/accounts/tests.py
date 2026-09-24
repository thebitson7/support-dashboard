from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase


class TokenAuthTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="agent", password="a-strong-test-passphrase-42"
        )

    def test_valid_credentials_return_access_and_refresh_tokens(self):
        response = self.client.post(
            "/api/auth/token/",
            {"username": "agent", "password": "a-strong-test-passphrase-42"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"access", "refresh"})

    def test_wrong_password_is_rejected(self):
        response = self.client.post(
            "/api/auth/token/", {"username": "agent", "password": "wrong"}
        )

        self.assertEqual(response.status_code, 401)

    def test_refresh_token_issues_a_new_access_token(self):
        tokens = self.client.post(
            "/api/auth/token/",
            {"username": "agent", "password": "a-strong-test-passphrase-42"},
        ).json()

        response = self.client.post("/api/auth/token/refresh/", {"refresh": tokens["refresh"]})

        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.json())

    def test_api_is_private_by_default(self):
        self.assertEqual(
            settings.REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"],
            ["rest_framework.permissions.IsAuthenticated"],
        )
