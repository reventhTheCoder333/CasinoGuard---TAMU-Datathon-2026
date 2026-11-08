import io
import json
import os
import unittest
import urllib.error
from unittest import mock

from fastapi.testclient import TestClient

from backend.integrations.databricks_sql import (
    DatabricksError,
    DatabricksNotConfigured,
    DatabricksSQLClient,
    normalize_host,
)
from backend.services.databricks_source import (
    DatabricksService,
    ReadOnlySourceError,
)


TOKEN = "dapi-test-secret-token"

# Rows shaped like workspace.default.aml_alerts_gold.
ALERT_ROWS = [
    {
        "alert_id": "a" * 64,
        "pattern": "suspicious_transaction_chain",
        "accounts": ["CHAIN_A", "CHAIN_B", "CHAIN_C", "CHAIN_D"],
        "transaction_ids": ["CHAIN001", "CHAIN002", "CHAIN003"],
        "total_amount": 14700.0,
        "evidence_json": json.dumps({
            "pattern": "suspicious_transaction_chain",
            "accounts": ["CHAIN_A", "CHAIN_B", "CHAIN_C", "CHAIN_D"],
            "transaction_ids": ["CHAIN001", "CHAIN002", "CHAIN003"],
            "total_amount": 14700.0,
            "elapsed_minutes": 8.0,
            "amount_similarity": 0.96,
        }),
        "detected_at": "2026-11-07T21:56:35.991Z",
    },
    {
        "alert_id": "b" * 64,
        "pattern": "circular_transaction",
        "accounts": ["CIRCLE_B", "CIRCLE_C", "CIRCLE_B"],
        "transaction_ids": ["CIRCLE002", "CIRCLE003", "CIRCLE001"],
        "total_amount": 14700.0,
        "evidence_json": json.dumps({
            "pattern": "circular_transaction",
            "accounts": ["CIRCLE_B", "CIRCLE_C", "CIRCLE_B"],
            "transaction_ids": ["CIRCLE002", "CIRCLE003", "CIRCLE001"],
            "total_amount": 14700.0,
        }),
        "detected_at": "2026-11-07T21:56:35.991Z",
    },
    {
        "alert_id": "c" * 64,
        "pattern": "unusual_transaction_volume",
        "accounts": ["VOLUME_A"],
        "transaction_ids": [],
        "total_amount": None,
        "evidence_json": json.dumps({
            "pattern": "unusual_transaction_volume",
            "account": "VOLUME_A",
            "date": "2026-11-05",
            "transaction_count": 2,
            "historical_average": 2.0,
            "historical_std_dev": 0.0,
            "z_score": 4.0,
        }),
        "detected_at": "2026-11-07T22:00:00Z",
    },
]

TRANSACTION_ROWS = [
    {"id": f"CHAIN00{i + 1}", "account": a, "from": a, "to": b,
     "amount": amount, "timestamp": f"2026-11-05T10:0{i * 4}:00.000Z", "type": "transfer"}
    for i, (a, b, amount) in enumerate([
        ("CHAIN_A", "CHAIN_B", 5000.0),
        ("CHAIN_B", "CHAIN_C", 4900.0),
        ("CHAIN_C", "CHAIN_D", 4800.0),
    ])
] + [
    {"id": f"VOL{i}", "account": "VOLUME_A", "from": "VOLUME_A", "to": "CASINO",
     "amount": 100.0, "timestamp": f"2026-11-05T0{i}:00:00.000Z", "type": "transfer"}
    for i in range(2)
]

ACCOUNT_ROWS = [
    {"account": "LINK_A", "phone": "555-1111", "email": "a@example.com", "payment_card": "CARD-101"},
]


class FakeClient:
    host = "https://example.cloud.databricks.com"
    warehouse_id = "wh"
    warehouse_name = "Test warehouse"

    def __init__(self, alerts=ALERT_ROWS):
        self.alerts = alerts
        self.fail = None
        self.statements = []

    def query(self, statement):
        self.statements.append(statement)

        if self.fail:
            raise self.fail
        if "aml_alerts_gold" in statement:
            return [dict(row) for row in self.alerts]
        if "transactions_silver" in statement:
            return [dict(row) for row in TRANSACTION_ROWS]
        return [dict(row) for row in ACCOUNT_ROWS]


def loaded_service(**kwargs):
    service = DatabricksService(client=FakeClient(**kwargs))
    service.refresh()
    return service


class TestDatabricksService(unittest.TestCase):

    def test_alerts_come_only_from_databricks_rows(self):
        with mock.patch(
            "backend.services.detection_service.run_all_detectors",
            side_effect=AssertionError("detectors must not run"),
        ):
            service = loaded_service()

        alerts = service.get_alerts()

        self.assertEqual({a["id"] for a in alerts}, {r["alert_id"] for r in ALERT_ROWS})
        self.assertEqual(service.source_info()["status"], "ready")
        self.assertEqual(alerts[0]["id"], "c" * 64)  # Newest detected_at first.
        self.assertTrue(all(a["source"] == "databricks" for a in alerts))

    def test_evidence_is_passed_through_unchanged(self):
        service = loaded_service()
        investigation = service.get_investigation("a" * 64)
        evidence = json.loads(ALERT_ROWS[0]["evidence_json"])

        for key, value in evidence.items():
            self.assertEqual(investigation["detector_output"][key], value)

        self.assertEqual(
            [tx["id"] for tx in investigation["timeline"]],
            ["CHAIN001", "CHAIN002", "CHAIN003"],
        )
        self.assertEqual(investigation["data_source"]["kind"], "databricks")
        self.assertTrue(any("reference values" in n for n in investigation["detector_notes"]))

    def test_volume_timeline_uses_databricks_transactions(self):
        timeline = loaded_service().get_investigation("c" * 64)["timeline"]

        self.assertEqual([tx["id"] for tx in timeline], ["VOL0", "VOL1"])
        self.assertEqual(timeline[0]["timestamp"], "2026-11-05T00:00:00")
        self.assertEqual(timeline[0]["source"], "databricks")

    def test_malformed_loop_is_shown_with_a_failed_check(self):
        investigation = loaded_service().get_investigation("b" * 64)
        rule = investigation["why_flagged"][0]

        self.assertEqual(investigation["alert"]["accounts_involved"], ["CIRCLE_B", "CIRCLE_C"])
        self.assertEqual(rule["observed"], 2)
        self.assertFalse(rule["met"])
        self.assertIn("Data quality", investigation["detector_notes"][0])

    def test_bad_rows_are_skipped_and_reported(self):
        rows = ALERT_ROWS + [
            {**ALERT_ROWS[0], "alert_id": "x", "pattern": "something_new"},
            {**ALERT_ROWS[0], "alert_id": "y", "evidence_json": "{not json"},
        ]
        service = loaded_service(alerts=rows)
        info = service.source_info()

        self.assertEqual(len(service.get_alerts()), 3)
        self.assertEqual(info["alert_rows"], 5)
        self.assertEqual({row["alert_id"] for row in info["skipped_rows"]}, {"x", "y"})

    def test_failed_refresh_keeps_last_good_data(self):
        service = loaded_service()
        service.client.fail = DatabricksError("Databricks returned HTTP 503")

        self.assertFalse(service.refresh())
        self.assertEqual(len(service.get_alerts()), 3)
        self.assertEqual(service.source_info()["status"], "error")
        self.assertIn("503", service.source_info()["error"])

    def test_refresh_reports_whether_content_changed(self):
        service = loaded_service()

        self.assertFalse(service.refresh())

        service.client.alerts = ALERT_ROWS[:1]
        self.assertTrue(service.refresh())
        self.assertEqual(len(service.get_alerts()), 1)

    def test_writes_are_refused(self):
        service = loaded_service()

        with self.assertRaises(ReadOnlySourceError):
            service.process_transaction({"id": "X"})
        with self.assertRaises(ReadOnlySourceError):
            service.process_account({"account": "X"})

    def test_summary_counts_databricks_alerts(self):
        summary = loaded_service().get_summary()

        self.assertEqual(summary["total_alerts"], 3)
        self.assertEqual(summary["detector_summary"]["circular_transactions"], 1)
        self.assertEqual(summary["source"]["kind"], "databricks")
        self.assertTrue(summary["source"]["read_only"])


class TestDatabricksSQLClient(unittest.TestCase):

    def _client(self, responses):
        calls = []

        def opener(request, timeout):
            calls.append(request)
            response = responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return io.BytesIO(json.dumps(response).encode())

        client = DatabricksSQLClient(
            "https://example.cloud.databricks.com/editor/notebooks/1?o=2",
            TOKEN, "wh", opener=opener, sleep=lambda _: None,
        )
        return client, calls

    def test_host_is_reduced_to_its_origin(self):
        self.assertEqual(
            normalize_host("https://dbc-x.cloud.databricks.com/editor/notebooks/1?o=7"),
            "https://dbc-x.cloud.databricks.com",
        )
        with self.assertRaises(DatabricksNotConfigured):
            normalize_host("http://insecure.example.com")

    def test_polls_and_converts_types(self):
        columns = [
            {"name": "accounts", "type_text": "ARRAY<STRING>"},
            {"name": "amount", "type_text": "DOUBLE"},
            {"name": "n", "type_text": "BIGINT"},
            {"name": "note", "type_text": "STRING"},
        ]
        client, calls = self._client([
            {"statement_id": "s1", "status": {"state": "PENDING"}},
            {"statement_id": "s1", "status": {"state": "SUCCEEDED"},
             "manifest": {"schema": {"columns": columns}},
             "result": {"data_array": [['["A","B"]', "1.5", "3", None]],
                        "next_chunk_internal_link": "/next"}},
            {"data_array": [['[]', "2", "4", "x"]]},
        ])

        rows = client.query("SELECT 1")

        self.assertEqual(rows, [
            {"accounts": ["A", "B"], "amount": 1.5, "n": 3, "note": None},
            {"accounts": [], "amount": 2.0, "n": 4, "note": "x"},
        ])
        self.assertTrue(calls[0].full_url.startswith("https://example.cloud.databricks.com/api/"))
        self.assertEqual(calls[0].get_header("Authorization"), f"Bearer {TOKEN}")

    def test_auth_failure_message_never_contains_the_token(self):
        error = urllib.error.HTTPError("u", 403, "Forbidden", {}, io.BytesIO(TOKEN.encode()))
        client, _ = self._client([error])

        with self.assertRaises(DatabricksError) as caught:
            client.query("SELECT 1")

        self.assertIn("credentials", str(caught.exception))
        self.assertNotIn(TOKEN, str(caught.exception))
        self.assertNotIn(TOKEN, repr(client))

    def test_failed_statement_is_reported(self):
        client, _ = self._client([
            {"statement_id": "s1", "status": {"state": "FAILED",
             "error": {"message": "TABLE_OR_VIEW_NOT_FOUND"}}},
        ])

        with self.assertRaises(DatabricksError) as caught:
            client.query("SELECT 1")

        self.assertIn("TABLE_OR_VIEW_NOT_FOUND", str(caught.exception))

    def test_missing_configuration(self):
        with mock.patch.dict(os.environ, {"DATABRICKS_HOST": "", "DATABRICKS_TOKEN": ""}):
            with self.assertRaises(DatabricksNotConfigured):
                DatabricksSQLClient.from_env()

    def test_discovers_warehouse_when_not_configured(self):
        client, calls = self._client([
            {"warehouses": [{"id": "w1", "name": "Stopped", "state": "STOPPED"},
                            {"id": "w2", "name": "Running", "state": "RUNNING"}]},
        ])
        client.warehouse_id = None

        self.assertEqual(client.resolve_warehouse(), "w2")
        self.assertEqual(client.warehouse_name, "Running")


class TestDatabricksApi(unittest.TestCase):
    """The REST API in Databricks mode, with the service swapped in."""

    def setUp(self):
        import backend.api.routes as routes
        import backend.main as main
        import backend.services.pipeline as pipeline

        self.service = loaded_service()

        for module in (routes, main, pipeline):
            patcher = mock.patch.object(module, "service", self.service)
            patcher.start()
            self.addCleanup(patcher.stop)

        self.client = TestClient(main.app)

    def test_alerts_and_investigations_are_served(self):
        alerts = self.client.get("/api/alerts").json()
        self.assertEqual(len(alerts), 3)

        response = self.client.get(f"/api/alerts/{'a' * 64}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data_source"]["kind"], "databricks")

    def test_graph_and_summary_use_databricks_data(self):
        graph = self.client.get("/api/graph").json()
        summary = self.client.get("/api/summary").json()

        self.assertIn("CHAIN_A", {node["id"] for node in graph["nodes"]})
        self.assertEqual(summary["source"]["kind"], "databricks")
        self.assertEqual(summary["total_transactions"], len(TRANSACTION_ROWS))

    def test_writes_and_simulator_are_refused(self):
        tx = {"id": "N1", "account": "A", "from": "A", "to": "CASINO",
              "amount": 1, "timestamp": "2026-01-01T00:00:00", "type": "deposit"}

        self.assertEqual(self.client.post("/api/transactions", json=tx).status_code, 409)
        self.assertEqual(self.client.post("/api/accounts", json={"account": "N1"}).status_code, 409)
        self.assertEqual(
            self.client.post("/api/simulator/run", json={"scenario": "chain"}).status_code, 409
        )
        self.assertEqual(self.client.post("/api/simulator/reset").status_code, 409)
        self.assertEqual(
            self.client.post("/api/integrations/databricks/export").status_code, 409
        )

    def test_refresh_endpoint(self):
        response = self.client.post("/api/source/refresh")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["changed"])

        self.service.client.fail = DatabricksError("Databricks returned HTTP 500")
        failed = self.client.post("/api/source/refresh")

        self.assertEqual(failed.status_code, 502)
        self.assertEqual(self.client.get("/health").json()["status"], "degraded")

    def test_responses_never_contain_the_token(self):
        with mock.patch.dict(os.environ, {"DATABRICKS_TOKEN": TOKEN}):
            for path in ("/api/source", "/api/summary", "/health", "/api/integrations"):
                self.assertNotIn(TOKEN, self.client.get(path).text)


if __name__ == "__main__":
    unittest.main()
