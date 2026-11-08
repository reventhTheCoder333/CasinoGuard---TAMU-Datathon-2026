import os
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from backend.api.websocket import ConnectionManager
from backend.integrations import clients
from backend.main import app
from backend.services.detection_service import service
from backend.services.pipeline import simulator


def payload(**overrides):
    return {
        "id": "API-1",
        "account": "API_ACCT",
        "from": "API_ACCT",
        "to": "CASINO",
        "amount": 100,
        "timestamp": "2026-01-01T10:00:00",
        "type": "deposit",
        **overrides,
    }


class ApiTestCase(unittest.TestCase):

    def setUp(self):
        service.reset()
        self.client = TestClient(app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.addCleanup(service.reset)


class TestReads(ApiTestCase):

    def test_health(self):
        body = self.client.get("/health").json()

        self.assertEqual(body["status"], "healthy")
        self.assertEqual(body["application"], "CASINOGUARD")
        self.assertEqual(body["data_classification"], "synthetic")

    def test_alerts_come_from_all_six_detectors(self):
        alerts = self.client.get("/api/alerts").json()

        self.assertEqual(len({a["detector"] for a in alerts}), 6)

        for alert in alerts:
            self.assertIn("disclaimer", alert)

    def test_detect_keeps_its_shape(self):
        body = self.client.get("/api/detect").json()

        for key in ("total_transactions", "total_accounts", "total_alerts",
                    "detector_summary", "alerts"):
            self.assertIn(key, body)

    def test_alert_filters(self):
        alerts = self.client.get(
            "/api/alerts", params={"detector": "rapid_cashouts"}
        ).json()

        self.assertEqual([a["detector"] for a in alerts], ["rapid_cashouts"])
        self.assertEqual(
            self.client.get("/api/alerts", params={"detector": "nope"}).status_code,
            422,
        )

    def test_every_alert_investigation_is_available(self):
        for alert in self.client.get("/api/alerts").json():
            response = self.client.get(f"/api/alerts/{alert['id']}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["alert"]["id"], alert["id"])

    def test_unknown_alert_is_404(self):
        self.assertEqual(self.client.get("/api/alerts/CG-9999").status_code, 404)

    def test_transaction_filters(self):
        limited = self.client.get("/api/transactions", params={"limit": 2}).json()
        account = self.client.get(
            "/api/transactions", params={"account": "CASH_A"}
        ).json()

        self.assertEqual(len(limited), 2)
        self.assertEqual(len(account), 3)
        self.assertEqual(
            self.client.get("/api/transactions", params={"limit": 0}).status_code,
            422,
        )

    def test_graph_is_consistent_and_labelled(self):
        graph = self.client.get("/api/graph").json()
        ids = {node["id"] for node in graph["nodes"]}

        self.assertEqual(graph["data_classification"], "synthetic")

        for edge in graph["edges"]:
            self.assertIn(edge["source"], ids)
            self.assertIn(edge["target"], ids)

        kinds = {edge["kind"] for edge in graph["edges"]}
        self.assertEqual(kinds, {"flow", "identity"})

        by_id = {node["id"]: node for node in graph["nodes"]}
        self.assertEqual(by_id["CASINO"]["kind"], "house")
        self.assertTrue(by_id["LINK_A"]["alert_ids"])
        self.assertEqual(by_id["PLAYER001"]["alert_ids"], [])

    def test_detectors_expose_real_thresholds(self):
        detectors = {d["key"]: d for d in self.client.get("/api/detectors").json()}

        self.assertEqual(len(detectors), 6)
        self.assertEqual(
            detectors["transaction_structuring"]["parameters"]["threshold"], 10000
        )


class TestValidation(ApiTestCase):

    def assert_rejected(self, **overrides):
        before = len(service.transactions)
        response = self.client.post("/api/transactions", json=payload(**overrides))

        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(len(service.transactions), before)

    def test_invalid_transactions_are_rejected(self):
        for overrides in (
            {"amount": 0},
            {"amount": -5},
            {"amount": 2_000_000_000},
            {"type": "banana"},
            {"to": "API_ACCT"},
            {"account": "SOMEONE_ELSE"},
            {"account": "CASINO", "from": "CASINO", "to": "X", "type": "transfer"},
            {"account": "API_ACCT", "from": "CASINO", "to": "API_ACCT", "type": "deposit"},
            {"account": "API_ACCT", "type": "withdrawal"},
            {"id": ""},
            {"id": "has spaces"},
            {"account": "<script>", "from": "<script>"},
            {"timestamp": "not a date"},
            {"timestamp": "2999-01-01T00:00:00"},
            {"unexpected": "field"},
        ):
            with self.subTest(overrides=overrides):
                self.assert_rejected(**overrides)

    def test_infinite_amount_is_rejected(self):
        response = self.client.post(
            "/api/transactions",
            content=b'{"id":"I","account":"A","from":"A","to":"CASINO",'
                    b'"amount":1e999,"timestamp":"2026-01-01T10:00:00"}',
            headers={"Content-Type": "application/json"},
        )

        self.assertEqual(response.status_code, 422)

    def test_duplicate_id_is_conflict(self):
        self.assertEqual(
            self.client.post("/api/transactions", json=payload()).status_code, 200
        )
        self.assertEqual(
            self.client.post("/api/transactions", json=payload()).status_code, 409
        )

    def test_timestamp_formats_cannot_break_detection(self):
        """These used to make every later /api/detect call return 500."""
        for i, timestamp in enumerate((
            "2026-01-01T10:00:00Z",
            "2026-01-01T10:00:00.123",
            "2026-01-01T12:00:00+02:00",
        )):
            response = self.client.post(
                "/api/transactions",
                json=payload(id=f"T{i}", timestamp=timestamp),
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                response.json()["transaction"]["timestamp"],
                "2026-01-01T10:00:00",
            )

        self.assertEqual(self.client.get("/api/detect").status_code, 200)
        self.assertEqual(self.client.get("/health").json()["status"], "healthy")

    def test_api_transactions_are_not_labelled_synthetic(self):
        body = self.client.post("/api/transactions", json=payload()).json()

        self.assertEqual(body["transaction"]["source"], "api")
        self.assertFalse(body["transaction"]["synthetic"])

    def test_account_validation(self):
        self.assertEqual(
            self.client.post("/api/accounts", json={"account": "CASINO"}).status_code,
            422,
        )
        self.assertEqual(
            self.client.post("/api/accounts", json={"account": "LINK_A"}).status_code,
            409,
        )

    def test_simulator_validation(self):
        self.assertEqual(
            self.client.post("/api/simulator/run", json={"scenario": "x"}).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/api/simulator/traffic",
                json={"enabled": True, "interval": 0},
            ).status_code,
            422,
        )


class TestLiveEvents(ApiTestCase):

    def test_websocket_receives_transaction_and_real_alert(self):
        with self.client.websocket_connect("/ws") as ws:
            self.assertEqual(ws.receive_json()["event"], "connected")

            for i, ts in enumerate(("10:00", "10:10", "10:20")):
                response = self.client.post(
                    "/api/transactions",
                    json=payload(
                        id=f"W{i}", amount=4000,
                        to=f"CAGE00{i}",
                        timestamp=f"2026-01-01T{ts}:00",
                    ),
                )
                self.assertEqual(response.status_code, 200)

            events = []
            while "new_alert" not in [e["event"] for e in events]:
                events.append(ws.receive_json())

        names = [e["event"] for e in events]
        self.assertIn("transaction_received", names)
        self.assertIn("summary", names)

        alert = next(e for e in events if e["event"] == "new_alert")["data"]
        self.assertEqual(alert["detector"], "transaction_structuring")
        self.assertEqual(alert["account"], "API_ACCT")

    def test_websocket_heartbeat(self):
        with self.client.websocket_connect("/ws") as ws:
            ws.receive_json()
            ws.send_text("ping")

            self.assertEqual(ws.receive_json()["event"], "pong")

    def test_simulator_streams_alerts_over_websocket(self):
        with self.client.websocket_connect("/ws") as ws:
            ws.receive_json()

            response = self.client.post(
                "/api/simulator/run",
                json={"scenario": "cashout", "interval": 0},
            )
            self.assertEqual(response.status_code, 202)

            event = {}
            while event.get("event") != "new_alert":
                event = ws.receive_json()

        self.assertEqual(event["data"]["detector"], "rapid_cashouts")
        self.assertTrue(event["data"]["account"].startswith("SIM"))

    def test_reset_restores_seed_and_notifies_clients(self):
        with self.client.websocket_connect("/ws") as ws:
            ws.receive_json()
            self.client.post("/api/transactions", json=payload())
            self.assertEqual(
                self.client.post("/api/simulator/reset").json()["total_alerts"],
                6,
            )

            event = {}
            while event.get("event") != "state_reset":
                event = ws.receive_json()


class TestConnectionManager(unittest.IsolatedAsyncioTestCase):

    async def test_broken_client_does_not_block_others(self):
        manager = ConnectionManager()
        healthy = mock.AsyncMock()
        broken = mock.AsyncMock()
        broken.send_json.side_effect = RuntimeError("gone")
        manager.active_connections = [broken, healthy]

        await manager.broadcast({"event": "x"})

        healthy.send_json.assert_awaited_once()
        self.assertEqual(manager.active_connections, [healthy])


NO_CREDENTIALS = {
    key: ""
    for integration in (clients.databricks, clients.serpapi, clients.tableau)
    for key in integration.required_env
}


class TestIntegrations(ApiTestCase):

    def test_status_without_credentials(self):
        with mock.patch.dict(os.environ, NO_CREDENTIALS):
            statuses = self.client.get("/api/integrations").json()

        self.assertEqual(
            [s["name"] for s in statuses], ["Databricks", "SerpApi", "Tableau"]
        )
        self.assertFalse(any(s["configured"] for s in statuses))

    def test_unconfigured_integrations_make_no_network_calls(self):
        with mock.patch.dict(os.environ, NO_CREDENTIALS), \
                mock.patch("urllib.request.urlopen") as urlopen:
            export = self.client.post("/api/integrations/databricks/export")
            search = self.client.get(
                "/api/integrations/serpapi/search", params={"q": "test"}
            )

        self.assertEqual(export.status_code, 503)
        self.assertEqual(search.status_code, 503)
        urlopen.assert_not_called()

    def test_status_never_exposes_secret_values(self):
        with mock.patch.dict(os.environ, {"SERPAPI_API_KEY": "secret-value"}):
            text = self.client.get("/api/integrations").text

        self.assertNotIn("secret-value", text)

    def test_databricks_statement_is_parameterized(self):
        env = {
            "DATABRICKS_HOST": "https://example.invalid",
            "DATABRICKS_TOKEN": "t",
            "DATABRICKS_WAREHOUSE_ID": "w",
            "DATABRICKS_EXPORT_TABLE": "main.casinoguard.alerts",
        }

        with mock.patch.dict(os.environ, env), \
                mock.patch.object(clients, "_http_json") as http:
            result = self.client.post("/api/integrations/databricks/export").json()

        self.assertEqual(result, {"exported": 6, "skipped": 0})
        body = http.call_args_list[0].args[1]
        self.assertIn(":payload", body["statement"])
        self.assertEqual(body["warehouse_id"], "w")

    def test_databricks_rejects_unsafe_table_name(self):
        env = {
            "DATABRICKS_HOST": "https://example.invalid",
            "DATABRICKS_TOKEN": "t",
            "DATABRICKS_WAREHOUSE_ID": "w",
            "DATABRICKS_EXPORT_TABLE": "x; DROP TABLE y",
        }

        with mock.patch.dict(os.environ, env), \
                mock.patch.object(clients, "_http_json") as http:
            response = self.client.post("/api/integrations/databricks/export")

        self.assertEqual(response.status_code, 502)
        http.assert_not_called()

    def test_serpapi_results_are_marked_unverified(self):
        fake = {"organic_results": [{"title": "T", "link": "L", "snippet": "S"}]}

        with mock.patch.dict(os.environ, {"SERPAPI_API_KEY": "k"}), \
                mock.patch.object(clients, "_http_json", return_value=fake):
            body = self.client.get(
                "/api/integrations/serpapi/search", params={"q": "test"}
            ).json()

        self.assertIn("Unverified", body["notice"])
        self.assertEqual(body["results"][0]["title"], "T")

    def test_csv_exports(self):
        alerts = self.client.get("/api/export/alerts.csv")
        transactions = self.client.get("/api/export/transactions.csv")

        self.assertEqual(alerts.headers["content-type"], "text/csv; charset=utf-8")
        self.assertEqual(len(alerts.text.strip().splitlines()), 7)
        self.assertIn("synthetic", alerts.text)
        self.assertIn("CHAIN001", transactions.text)

    def test_csv_cells_cannot_become_formulas(self):
        csv_text = clients.to_csv([{"a": "=SUM(A1)"}], ["a"])

        self.assertIn("'=SUM(A1)", csv_text)


if __name__ == "__main__":
    unittest.main()
