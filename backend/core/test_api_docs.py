"""
The OpenAPI schema and Swagger UI (drf-spectacular): the schema must keep
generating cleanly as views change, and outside local development only
admins may read it.
"""

import os
import tempfile
from unittest.mock import patch

from django.core.management import call_command
from django.test import SimpleTestCase
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.test import APITestCase

from accounts.models import User
from accounts.permissions import IsAdminRole


class SchemaGenerationTests(SimpleTestCase):
    def test_schema_generates_and_validates_without_warnings(self):
        # --fail-on-warn turns any warning (an undocumentable view, a
        # component name clash, an unnamed enum) into a failure here.
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "schema.yaml")
            call_command("spectacular", "--file", path, "--validate", "--fail-on-warn")
            with open(path, encoding="utf-8") as f:
                schema = f.read()
        self.assertIn("title: Support Dashboard API", schema)
        self.assertIn("/api/tickets/export/:", schema)
        self.assertNotIn("/api/schema/:", schema)


# The production value of SPECTACULAR_SETTINGS["SERVE_PERMISSIONS"] (DEBUG off).
# Spectacular reads it once, when its views are imported, so it's applied here
# by patching the views rather than with override_settings.
@patch.object(SpectacularAPIView, "permission_classes", [IsAdminRole])
@patch.object(SpectacularSwaggerView, "permission_classes", [IsAdminRole])
class DocsAccessTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user("boss", password="pw", role=User.Role.ADMIN)
        self.staff = User.objects.create_user("syed", password="pw")

    def test_anonymous_visitors_are_refused(self):
        for url in ("/api/schema/", "/api/docs/"):
            self.assertEqual(self.client.get(url).status_code, 401, url)

    def test_staff_are_refused(self):
        self.client.force_authenticate(self.staff)
        for url in ("/api/schema/", "/api/docs/"):
            self.assertEqual(self.client.get(url).status_code, 403, url)

    def test_admins_get_the_schema_and_the_ui(self):
        self.client.force_authenticate(self.admin)
        schema = self.client.get("/api/schema/?format=json")
        self.assertEqual(schema.status_code, 200)
        self.assertEqual(schema.json()["info"]["title"], "Support Dashboard API")
        ui = self.client.get("/api/docs/")
        self.assertEqual(ui.status_code, 200)
        self.assertContains(ui, "swagger-ui-dist@5.33.0/swagger-ui-bundle.js")
