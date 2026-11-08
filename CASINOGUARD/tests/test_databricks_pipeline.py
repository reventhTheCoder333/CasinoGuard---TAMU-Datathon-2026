import asyncio
import json
import os
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from backend.integrations.databricks_sql import DatabricksError
from backend.services.databricks_pipeline import (
    DatabricksSimulation,
    TRANSACTION_COLUMNS,
    _csv,
    generate_dataset,
)
from backend.services.databricks_source import DatabricksService
from tests.test_databricks_source import ACCOUNT_ROWS, ALERT_ROWS, TRANSACTION_ROWS


JOB_ENV = {"DATABRICKS_PIPELINE_JOB_ID": "123", "DATABRICKS_JOB_TIMEOUT_SECONDS": "60"}
STARTED = "2026-11-07T23:00:00.000Z"

# A row in the slimmed format the CASINOGUARD_AML notebook now writes.
SLIM_ROWS = [
    {
        "alert_id": "d" * 64,
        "pattern": "rapid_cashout",
        "accounts": ["CASH_A"],
        "transaction_ids": ["CASH001", "CASH003"],
        "total_amount": 8900.0,
        "evidence_json": json.dumps({
            "deposit_amount": 9000.0, "total_withdrawn": 8900.0, "total_wagered": 100.0,
            "cashout_ratio": 0.9889, "wager_ratio": 0.0111, "elapsed_minutes": 15.0,
        }),
        "thresholds_json": json.dumps({
            "min_cashout_ratio": 0.95, "max_wager_ratio": 0.2, "max_time_minutes": 30,
        }),
        "detected_at": "2026-11-07T23:05:00.000Z",
    },
    {
        "alert_id": "e" * 64,
        "pattern": "transaction_structuring",
        "accounts": ["STRUCT_A"],
        "transaction_ids": ["S1", "S2", "S3"],
        "total_amount": 10500.0,
        "evidence_json": json.dumps({"transaction_count": 3, "window_minutes": 60}),
        "thresholds_json": json.dumps({"threshold": 10000, "window_minutes": 60, "min_transactions": 3}),
        "detected_at": "2026-11-07T23:05:00.000Z",
    },
    {
        "alert_id": "f" * 64,
        "pattern": "multiple_account_activity",
        "accounts": ["LINK_A", "LINK_B"],
        "transaction_ids": [],
        "total_amount": None,
        "evidence_json": "{}",
        "thresholds_json": None,
        "detected_at": "2026-11-07T23:05:00.000Z",
    },
]

CASH_TRANSACTIONS = [
    {"id": "CASH001", "account": "CASH_A", "from": "CASH_A", "to": "CASINO", "amount": 9000.0,
     "timestamp": "2026-11-05T12:00:00Z", "type": "deposit"},
    {"id": "CASH002", "account": "CASH_A", "from": "CASH_A", "to": "CASINO", "amount": 100.0,
     "timestamp": "2026-11-05T12:05:00Z", "type": "wager"},
    {"id": "CASH003", "account": "CASH_A", "from": "CASINO", "to": "CASH_A", "amount": 8900.0,
     "timestamp": "2026-11-05T12:15:00Z", "type": "withdrawal"},
]


class FakeDatabricks:
    """Stands in for the workspace: files, the job, and the tables."""

    host = "https://example.cloud.databricks.com"
    warehouse_id = "wh"
    warehouse_name = "Test warehouse"

    def __init__(self):
        self.uploads = {}
        self.job_states = ["PENDING", "RUNNING", "TERMINATED"]
        self.result_state = "SUCCESS"
        self.active = []
        self.cancelled = []
        self.gold_rows = [dict(row) for row in SLIM_ROWS]
        self.gold_written = "2026-11-07T23:05:00.000Z"
        self.bronze_counts = None
        self.started = []

    # Files and jobs
    def upload_file(self, path, content):
        self.uploads[path] = content

    def active_job_runs(self, job_id):
        return self.active

    def run_job(self, job_id):
        self.started.append(job_id)
        return 987

    def get_job_run(self, run_id):
        state = self.job_states.pop(0) if len(self.job_states) > 1 else self.job_states[0]
        run = {"run_id": run_id, "run_page_url": "https://example/run/987",
               "state": {"life_cycle_state": state}}
        if state == "TERMINATED":
            run["state"]["result_state"] = self.result_state
            run["state"]["state_message"] = "" if self.result_state == "SUCCESS" else "Cell 12 failed"
        return run

    def cancel_job_run(self, run_id):
        self.cancelled.append(run_id)

    # SQL
    def query(self, statement):
        if statement.startswith("SELECT current_timestamp()"):
            return [{"now": STARTED}]
        if statement.startswith("DESCRIBE HISTORY"):
            return [{"timestamp": self.gold_written}]
        if "COUNT(*)" in statement and "detected_at <" in statement:
            return [{"n": sum(r["detected_at"] < STARTED for r in self.gold_rows)}]
        if "COUNT(*)" in statement:
            uploaded = self._uploaded_counts()
            if self.bronze_counts is not None:
                uploaded = self.bronze_counts
            table = "accounts" if "accounts" in statement else "transactions"
            return [{"n": uploaded[table]}]
        if "aml_alerts_gold" in statement:
            return [dict(row) for row in self.gold_rows]
        if "transactions_silver" in statement:
            return [dict(row) for row in CASH_TRANSACTIONS + TRANSACTION_ROWS]
        return [dict(row) for row in ACCOUNT_ROWS]

    def _uploaded_counts(self):
        def rows(suffix):
            content = next((v for k, v in self.uploads.items() if k.endswith(suffix)), b"")
            return max(len(content.decode().strip().splitlines()) - 1, 0)
        return {"transactions": rows("transactions.csv"), "accounts": rows("accounts.csv")}


class PipelineTestCase(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        patcher = mock.patch.dict(os.environ, JOB_ENV)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.databricks = FakeDatabricks()
        self.service = DatabricksService(client=self.databricks)
        self.statuses = []
        self.refreshes = []

        async def publish(status):
            self.statuses.append(json.loads(json.dumps(status)))

        async def refresh(force=False):
            self.refreshes.append(force)
            return await asyncio.to_thread(self.service.refresh, force)

        async def no_sleep(_):
            await asyncio.sleep(0)

        self.simulation = DatabricksSimulation(
            self.service, publish, refresh, sleep=no_sleep
        )

    async def run_simulation(self, scenario="full", seed=None):
        await self.simulation.start(scenario, seed)
        await self.simulation._task
        return self.simulation.current


class TestSimulationSuccess(PipelineTestCase):

    async def test_full_flow_loads_fresh_databricks_results(self):
        result = await self.run_simulation()

        self.assertEqual(result["state"], "succeeded", result["error"])
        self.assertEqual(result["job_run_id"], 987)
        # The job ID comes from DATABRICKS_PIPELINE_JOB_ID.
        self.assertEqual(self.databricks.started, ["123"])
        self.assertEqual(result["job_run_url"], "https://example/run/987")
        self.assertEqual(result["uploaded"]["transactions"], len(generate_dataset("full", result["seed"])[0]))
        self.assertEqual(result["scenario"], "full")
        self.assertEqual(self.refreshes, [True])
        # The multiple-account row is excluded, never displayed.
        self.assertEqual(result["alerts_loaded"], 2)
        self.assertEqual(
            [s["current"]["state"] for s in self.statuses if s["current"]][0:3],
            ["generating", "uploading", "running_job"],
        )

    async def test_uploads_generator_output_as_notebook_input_files(self):
        result = await self.run_simulation()
        transactions, _, _ = generate_dataset(result["scenario"], result["seed"])

        self.assertEqual(
            self.databricks.uploads["/Volumes/workspace/default/casinoguard_data/transactions.csv"],
            _csv(transactions, TRANSACTION_COLUMNS),
        )
        header = self.databricks.uploads[
            "/Volumes/workspace/default/casinoguard_data/accounts.csv"
        ].decode().splitlines()[0]
        self.assertEqual(header, "account,phone,email,payment_card")

    async def test_detectors_never_run_locally(self):
        with mock.patch(
            "backend.services.detection_service.run_all_detectors",
            side_effect=AssertionError("must not run"),
        ):
            result = await self.run_simulation()

        self.assertEqual(result["state"], "succeeded")


class TestSimulationFailures(PipelineTestCase):

    async def test_job_failure_is_reported_and_old_results_kept(self):
        self.service.refresh()
        self.databricks.result_state = "FAILED"

        result = await self.run_simulation()

        self.assertEqual(result["state"], "failed")
        self.assertIn("FAILED", result["error"])
        self.assertIn("Cell 12 failed", result["error"])
        self.assertEqual(result["failed_step"], "running_job")
        self.assertEqual(self.refreshes, [])
        self.assertEqual(len(self.service.get_alerts()), 2)

    async def test_gold_not_rebuilt_is_stale(self):
        self.databricks.gold_written = "2026-11-07T22:00:00.000Z"

        result = await self.run_simulation()

        self.assertEqual(result["state"], "failed")
        self.assertIn("wasn't rebuilt", result["error"])

    async def test_old_rows_in_gold_are_stale(self):
        self.databricks.gold_rows[0]["detected_at"] = "2026-11-07T21:00:00.000Z"

        result = await self.run_simulation()

        self.assertEqual(result["state"], "failed")
        self.assertIn("older than this simulation", result["error"])

    async def test_bronze_not_matching_upload_is_reported(self):
        self.databricks.bronze_counts = {"transactions": 12, "accounts": 4}

        result = await self.run_simulation()

        self.assertEqual(result["state"], "failed")
        self.assertIn("transactions_bronze has 12 rows but", result["error"])

    async def test_refuses_while_job_already_running_in_databricks(self):
        self.databricks.active = [{"run_id": 1}]

        result = await self.run_simulation()

        self.assertEqual(result["state"], "failed")
        self.assertIn("already running", result["error"])
        self.assertEqual(self.databricks.uploads, {})
        self.assertEqual(self.databricks.started, [])

    async def test_timeout_cancels_the_job(self):
        self.databricks.job_states = ["RUNNING"]
        ticks = iter(range(0, 10_000, 100))
        self.simulation._clock = lambda: next(ticks)

        result = await self.run_simulation()

        self.assertEqual(result["state"], "failed")
        self.assertIn("cancelled", result["error"])
        self.assertEqual(self.databricks.cancelled, [987])

    async def test_databricks_error_message_is_reported(self):
        async def broken(path, content):
            raise DatabricksError("Databricks returned HTTP 403")

        self.databricks.upload_file = lambda path, content: (_ for _ in ()).throw(
            DatabricksError("Databricks rejected the credentials (HTTP 403).")
        )

        result = await self.run_simulation()

        self.assertEqual(result["state"], "failed")
        self.assertIn("credentials", result["error"])

    async def test_only_one_simulation_at_a_time(self):
        self.databricks.job_states = ["RUNNING"]
        await self.simulation.start()

        with self.assertRaises(RuntimeError):
            await self.simulation.start()

        await self.simulation.stop()
        self.assertEqual(self.simulation.current["state"], "cancelled")

    async def test_missing_job_id_is_a_configuration_error(self):
        with mock.patch.dict(os.environ, {"DATABRICKS_PIPELINE_JOB_ID": ""}):
            with self.assertRaises(Exception) as caught:
                await self.simulation.start()

        self.assertIn("DATABRICKS_PIPELINE_JOB_ID", str(caught.exception))


class TestSlimGoldRows(unittest.TestCase):

    def setUp(self):
        databricks = FakeDatabricks()
        self.service = DatabricksService(client=databricks)
        self.service.refresh()

    def test_columns_fill_fields_missing_from_evidence(self):
        alert = next(a for a in self.service.get_alerts() if a["detector"] == "rapid_cashouts")

        self.assertEqual(alert["account"], "CASH_A")
        self.assertEqual(alert["deposit_id"], "CASH001")
        self.assertEqual(alert["withdrawal_ids"], ["CASH003"])

        structuring = next(
            a for a in self.service.get_alerts() if a["detector"] == "transaction_structuring"
        )
        self.assertEqual(structuring["total_amount"], 10500.0)
        self.assertEqual(structuring["transaction_count"], 3)

    def test_recorded_thresholds_are_used(self):
        alert = next(a for a in self.service.get_alerts() if a["detector"] == "rapid_cashouts")
        investigation = self.service.get_investigation(alert["id"])
        rules = {r["label"]: r for r in investigation["why_flagged"]}

        # 0.9889 against the recorded 0.95, not the local default of 0.80.
        self.assertEqual(rules["Share of deposit withdrawn"]["threshold"], 0.95)
        self.assertEqual(investigation["detector_parameters"]["max_time_minutes"], 30)
        self.assertFalse(any("reference values" in n for n in investigation["detector_notes"]))
        self.assertEqual([tx["id"] for tx in investigation["timeline"]], ["CASH001", "CASH002", "CASH003"])

    def test_multiple_account_activity_is_excluded_everywhere(self):
        summary = self.service.get_summary()

        self.assertNotIn("multiple_accounts", summary["detector_summary"])
        self.assertNotIn("multiple_accounts", {a["detector"] for a in self.service.get_alerts()})
        self.assertEqual(self.service.source_info()["skipped_rows"], [])
        self.assertNotIn("multiple_accounts", self.service.enabled_detectors())

    def test_row_with_wrong_account_count_is_skipped(self):
        databricks = FakeDatabricks()
        databricks.gold_rows[1]["accounts"] = []
        service = DatabricksService(client=databricks)
        service.refresh()

        skipped = service.source_info()["skipped_rows"]
        self.assertEqual(len(skipped), 1)
        self.assertIn("expected one account", skipped[0]["reason"])


class TestSimulationApi(unittest.TestCase):

    def setUp(self):
        import backend.api.routes as routes
        import backend.services.pipeline as pipeline_module
        import backend.main as main

        env = mock.patch.dict(os.environ, JOB_ENV)
        env.start()
        self.addCleanup(env.stop)

        self.service = DatabricksService(client=FakeDatabricks())
        self.service.refresh()

        async def publish(status):
            pass

        async def refresh(force=False):
            return self.service.refresh(force)

        simulation = DatabricksSimulation(self.service, publish, refresh)

        for target, name, value in (
            (routes, "service", self.service),
            (main, "service", self.service),
            (pipeline_module, "service", self.service),
            (pipeline_module, "databricks_simulation", simulation),
        ):
            patcher = mock.patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

        self.client = TestClient(main.app)

    def test_detectors_endpoint_lists_five(self):
        keys = [d["key"] for d in self.client.get("/api/detectors").json()]

        self.assertEqual(len(keys), 5)
        self.assertNotIn("multiple_accounts", keys)

    def test_simulation_status_never_contains_secrets(self):
        with mock.patch.dict(os.environ, {"DATABRICKS_TOKEN": "dapi-secret"}):
            text = self.client.get("/api/databricks/simulation").text

        self.assertNotIn("dapi-secret", text)
        self.assertTrue(self.client.get("/api/databricks/simulation").json()["configured"])

    def test_simulate_without_job_is_503(self):
        with mock.patch.dict(os.environ, {"DATABRICKS_PIPELINE_JOB_ID": ""}):
            response = self.client.post("/api/databricks/simulate")

        self.assertEqual(response.status_code, 503)
        self.assertIn("DATABRICKS_PIPELINE_JOB_ID", response.json()["detail"])


class TestLocalModeUnaffected(unittest.TestCase):

    def test_databricks_endpoints_refuse_in_local_mode(self):
        from backend.main import app

        client = TestClient(app)

        self.assertEqual(client.post("/api/databricks/simulate").status_code, 409)
        self.assertEqual(len(client.get("/api/detectors").json()), 6)


if __name__ == "__main__":
    unittest.main()


class TestScenarios(PipelineTestCase):

    async def test_each_scenario_uploads_its_own_fresh_data(self):
        uploads = []

        for scenario in ["full", "transaction_structuring", "rapid_cashouts"]:
            await self.run_simulation(scenario)
            uploads.append(self.databricks.uploads[
                "/Volumes/workspace/default/casinoguard_data/transactions.csv"
            ])
            self.assertEqual(self.simulation.current["scenario"], scenario)

        self.assertEqual(len(set(uploads)), 3)

    async def test_seed_reproduces_a_run(self):
        await self.run_simulation("unusual_volume", seed=42)
        first = self.databricks.uploads[
            "/Volumes/workspace/default/casinoguard_data/transactions.csv"
        ]
        await self.run_simulation("unusual_volume", seed=42)

        self.assertEqual(first, self.databricks.uploads[
            "/Volumes/workspace/default/casinoguard_data/transactions.csv"
        ])

    async def test_unknown_scenario_is_rejected(self):
        with self.assertRaises(ValueError):
            await self.simulation.start("multiple_accounts")

    async def test_check_reports_unexpected_alerts(self):
        # The fake gold table has unrelated alerts, so the check must not pass.
        result = await self.run_simulation("transaction_chains")

        self.assertEqual(result["state"], "succeeded")
        self.assertFalse(result["check"]["matched"])
        self.assertFalse(result["check"]["expected"][0]["detected"])
        self.assertTrue(result["check"]["unexpected"])


class TestCompareWithExpected(unittest.TestCase):

    def test_exact_match(self):
        from backend.services.databricks_pipeline import compare_with_expected

        alerts = [{"id": "x", "title": "t", "pattern": "rapid_cashout",
                   "accounts_involved": ["PLAYER_1"]}]
        result = compare_with_expected(
            [{"pattern": "rapid_cashout", "accounts": ["PLAYER_1"]}], alerts
        )

        self.assertTrue(result["matched"])
        self.assertEqual(result["expected"][0]["alert_id"], "x")

    def test_wrong_accounts_do_not_match(self):
        from backend.services.databricks_pipeline import compare_with_expected

        alerts = [{"id": "x", "title": "t", "pattern": "rapid_cashout",
                   "accounts_involved": ["PLAYER_2"]}]
        result = compare_with_expected(
            [{"pattern": "rapid_cashout", "accounts": ["PLAYER_1"]}], alerts
        )

        self.assertFalse(result["matched"])
        self.assertEqual(len(result["unexpected"]), 1)


class TestScenarioApi(TestSimulationApi):

    def test_scenario_validation(self):
        bad = self.client.post("/api/databricks/simulate", json={"scenario": "multiple_accounts"})
        self.assertEqual(bad.status_code, 422)

        extra = self.client.post("/api/databricks/simulate", json={"scenario": "full", "x": 1})
        self.assertEqual(extra.status_code, 422)

    def test_status_lists_six_modes_without_multiple_accounts(self):
        keys = [s["key"] for s in self.client.get("/api/databricks/simulation").json()["scenarios"]]

        self.assertEqual(keys[0], "full")
        self.assertEqual(len(keys), 6)
        self.assertNotIn("multiple_accounts", keys)
