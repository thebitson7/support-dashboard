from rest_framework.test import APITestCase


class PingTests(APITestCase):
    def test_ping_is_public(self):
        response = self.client.get("/api/ping/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "message": "pong"})

    def test_ping_rejects_unsupported_methods(self):
        self.assertEqual(self.client.post("/api/ping/").status_code, 405)
