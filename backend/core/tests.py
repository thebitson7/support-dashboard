from rest_framework.test import APITestCase


class PingTests(APITestCase):
    def test_ping_is_public(self):
        response = self.client.get("/api/ping/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "message": "pong"})

    def test_ping_rejects_unsupported_methods(self):
        self.assertEqual(self.client.post("/api/ping/").status_code, 405)


class UnappliedMigrationsCheckTests(APITestCase):
    def test_clean_when_every_migration_is_applied(self):
        from core.checks import unapplied_migrations

        self.assertEqual(unapplied_migrations(), [])

    def test_names_pending_migrations(self):
        from unittest.mock import patch

        from core.checks import unapplied_migrations

        class Pending:
            app_label, name = "audit", "0001_initial"

        with patch("core.checks.MigrationExecutor") as executor:
            executor.return_value.migration_plan.return_value = [(Pending(), False)]
            errors = unapplied_migrations()
        self.assertEqual([e.id for e in errors], ["core.E001"])
        self.assertIn("audit.0001_initial", errors[0].msg)


class RedisDownTests(APITestCase):
    """REDIS_URL set but Redis unreachable: rate-limited endpoints fail closed, clearly; the rest carry on."""

    def setUp(self):
        from unittest.mock import MagicMock, patch

        from redis.exceptions import ConnectionError as RedisConnectionError
        from rest_framework.throttling import SimpleRateThrottle

        from accounts.models import User

        broken = MagicMock()
        broken.get.side_effect = RedisConnectionError("Error 10061 connecting to 127.0.0.1:6399")
        patcher = patch.object(SimpleRateThrottle, "cache", broken)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.admin = User.objects.create_user("boss", password="pw", role=User.Role.ADMIN)

    def test_sign_in_and_exports_answer_503_and_log_the_cause(self):
        with self.assertLogs("accounts.throttling", "ERROR") as logs:
            response = self.client.post("/api/auth/token/", {"username": "boss", "password": "pw"}, format="json")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "This is temporarily unavailable. Try again in a minute.")
        self.assertIn("Redis", logs.output[0])
        self.client.force_authenticate(self.admin)
        with self.assertLogs("accounts.throttling", "ERROR"):
            self.assertEqual(self.client.get("/api/audit/logs/export/").status_code, 503)
            self.assertEqual(self.client.patch(f"/api/accounts/admin/users/{self.admin.pk}/", {"first_name": "B"}, format="json").status_code, 503)

    def test_endpoints_without_a_rate_limit_are_unaffected(self):
        self.client.force_authenticate(self.admin)
        for path in ("/api/audit/logs/", "/api/tickets/", "/api/accounts/admin/users/"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 200)

    def test_deploy_check_reports_an_unreachable_cache(self):
        from unittest.mock import patch

        from django.test import override_settings

        from core.checks import cache_reachable

        self.assertEqual(cache_reachable(), [])  # no REDIS_URL: nothing to check
        with override_settings(REDIS_URL="redis://127.0.0.1:6399/0"), patch("core.checks.cache") as cache:
            cache.set.side_effect = ConnectionError("refused")
            self.assertEqual([e.id for e in cache_reachable()], ["core.E003"])
