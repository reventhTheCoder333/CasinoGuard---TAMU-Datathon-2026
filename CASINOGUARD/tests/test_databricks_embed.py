import io
import json
import unittest
import urllib.error
import urllib.parse
from unittest import mock

from fastapi.testclient import TestClient

from backend.integrations import databricks_embed
from backend.integrations.databricks_embed import DashboardEmbedder, EmbedError, EmbedNotConfigured
from backend.main import app


ENV = {
    "DATABRICKS_HOST": "https://example.cloud.databricks.com/some/page?o=1",
    "DATABRICKS_WORKSPACE_ID": "123",
    "DATABRICKS_DASHBOARD_ID": "dash1",
    "DATABRICKS_SP_CLIENT_ID": "sp-id",
    "DATABRICKS_SP_CLIENT_SECRET": "sp-secret-value",
}


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeDatabricks:
    """Records requests and answers like the three-step token exchange."""

    def __init__(self, fail_tokeninfo=None):
        self.requests = []
        self.fail_tokeninfo = fail_tokeninfo

    def __call__(self, request, timeout):
        body = urllib.parse.parse_qs(request.data.decode()) if request.data else {}
        self.requests.append((request, body))

        if "tokeninfo" in request.full_url:
            if self.fail_tokeninfo:
                raise urllib.error.HTTPError(
                    request.full_url, self.fail_tokeninfo, "err", {},
                    io.BytesIO(b'{"error_code":"PERMISSION_DENIED","message":"no access"}'),
                )
            return FakeResponse(json.dumps({
                "authorization_details": [{"type": "workspace_permission", "object_type": "dashboards"}],
                "custom_claim": "urn:aibi:external_data:x:viewer",
                "scope": "dashboards.genie",
            }).encode())

        if "authorization_details" in body:
            return FakeResponse(b'{"access_token":"scoped-token","expires_in":3600}')
        return FakeResponse(b'{"access_token":"sp-token","expires_in":3600}')


class TestEmbedder(unittest.TestCase):

    def test_reports_missing_settings(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(EmbedNotConfigured) as caught:
                DashboardEmbedder(opener=FakeDatabricks()).scoped_token()
        self.assertIn("DATABRICKS_SP_CLIENT_SECRET", caught.exception.missing)

    def test_three_step_exchange(self):
        fake = FakeDatabricks()
        with mock.patch.dict("os.environ", ENV, clear=True):
            result = DashboardEmbedder(opener=fake).scoped_token()

        self.assertEqual(result, {"token": "scoped-token", "expires_in": 3600})
        (sp, sp_body), (info, _), (scoped, scoped_body) = fake.requests

        self.assertEqual(sp.full_url, "https://example.cloud.databricks.com/oidc/v1/token?o=123")
        self.assertEqual(sp_body, {"grant_type": ["client_credentials"], "scope": ["all-apis"]})
        self.assertTrue(sp.get_header("Authorization").startswith("Basic "))

        self.assertIn("/api/2.0/lakeview/dashboards/dash1/published/tokeninfo", info.full_url)
        self.assertIn("external_viewer_id=casinoguard-local-analyst", info.full_url)
        self.assertEqual(info.get_header("Authorization"), "Bearer sp-token")

        self.assertEqual(json.loads(scoped_body["authorization_details"][0])[0]["object_type"], "dashboards")
        self.assertEqual(scoped_body["custom_claim"], ["urn:aibi:external_data:x:viewer"])
        self.assertEqual(scoped_body["grant_type"], ["client_credentials"])

    def test_caches_service_principal_token(self):
        fake = FakeDatabricks()
        embedder = DashboardEmbedder(opener=fake)
        with mock.patch.dict("os.environ", ENV, clear=True):
            embedder.scoped_token()
            embedder.scoped_token()
        sp_requests = [r for r, body in fake.requests if body.get("scope") == ["all-apis"]]
        self.assertEqual(len(sp_requests), 1)

    def test_permission_error_is_explained_without_secrets(self):
        with mock.patch.dict("os.environ", ENV, clear=True):
            with self.assertRaises(EmbedError) as caught:
                DashboardEmbedder(opener=FakeDatabricks(fail_tokeninfo=403)).scoped_token()
        message = str(caught.exception)
        self.assertIn("CAN RUN", message)
        self.assertNotIn("sp-secret-value", message)
        self.assertNotIn("sp-token", message)


class TestEmbedRoutes(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_config_exposes_identifiers_only(self):
        with mock.patch.dict("os.environ", ENV, clear=True):
            body = self.client.get("/api/databricks/dashboard/config").json()
        self.assertEqual(body["instance_url"], "https://example.cloud.databricks.com")
        self.assertTrue(body["configured"])
        self.assertNotIn("sp-secret-value", json.dumps(body))
        self.assertNotIn("sp-id", json.dumps(body))

    def test_token_route_returns_503_when_unconfigured(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            response = self.client.post("/api/databricks/dashboard/token")
        self.assertEqual(response.status_code, 503)
        self.assertIn("DATABRICKS_SP_CLIENT_ID", response.json()["detail"])

    def test_token_route_is_not_cached(self):
        with mock.patch.object(databricks_embed, "embedder", DashboardEmbedder(opener=FakeDatabricks())):
            with mock.patch.dict("os.environ", ENV, clear=True):
                response = self.client.post("/api/databricks/dashboard/token")
        self.assertEqual(response.json()["token"], "scoped-token")
        self.assertEqual(response.headers["cache-control"], "no-store")


if __name__ == "__main__":
    unittest.main()
