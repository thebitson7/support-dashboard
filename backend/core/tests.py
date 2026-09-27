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
