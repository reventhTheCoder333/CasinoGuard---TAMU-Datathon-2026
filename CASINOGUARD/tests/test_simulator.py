import asyncio
import unittest
from datetime import datetime, timedelta

from backend.services.detection_service import DetectionService
from backend.services.simulator import (
    SCENARIOS,
    NormalTraffic,
    Plan,
    SimulatorManager,
    _now,
)
from data.transactions import generate_synthetic_data
from engine.detection_engine import run_all_detectors


class TestScenarios(unittest.TestCase):
    """Each scenario must trigger its target detector, and no other."""

    def test_each_scenario_triggers_only_its_target(self):
        for key, scenario in SCENARIOS.items():
            with self.subTest(scenario=key):
                service = DetectionService()
                plan = Plan(1, scenario["code"])
                scenario["build"](plan, _now())
                raised = []

                for kind, payload in plan.steps:
                    ingest = (
                        service.process_transaction
                        if kind == "transaction"
                        else service.process_account
                    )
                    raised += ingest(payload, source="simulator")["new_alerts"]

                self.assertEqual(
                    {alert["detector"] for alert in raised},
                    {scenario["target_detector"]},
                )
                self.assertEqual(len(raised), 1)

    def test_scenarios_cover_all_six_detectors(self):
        report = run_all_detectors(*generate_synthetic_data())

        self.assertEqual(
            {s["target_detector"] for s in SCENARIOS.values()},
            set(report["detector_summary"]),
        )

    def test_simulated_records_are_labelled_synthetic(self):
        service = DetectionService()
        plan = Plan(1, "CHAIN")
        SCENARIOS["chain"]["build"](plan, _now())

        result = service.process_transaction(plan.steps[0][1], source="simulator")

        self.assertTrue(result["transaction"]["synthetic"])
        self.assertEqual(result["transaction"]["source"], "simulator")


class TestNormalTraffic(unittest.TestCase):

    def test_three_hours_of_normal_traffic_raises_no_alerts(self):
        """One attempt every two seconds, checked by the real detectors."""
        source = NormalTraffic(seed=7)
        start = datetime(2026, 1, 1, 8, 0, 0)
        transactions = []

        for second in range(0, 3 * 3600, 2):
            tx = source.next_transaction(start + timedelta(seconds=second))

            if tx is not None:
                transactions.append(tx)

        report = run_all_detectors(transactions, [])

        # Traffic must keep flowing for the whole period, not stall.
        self.assertGreater(len(transactions), 5000)
        self.assertEqual(report["detector_errors"], {})
        self.assertEqual(report["alerts"], [])


class TestSimulatorManager(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.service = DetectionService()
        self.statuses = []

        async def ingest_transaction(tx, source):
            return self.service.process_transaction(tx, source)

        async def ingest_account(account, source):
            return self.service.process_account(account, source)

        async def publish(status):
            self.statuses.append(status)

        self.manager = SimulatorManager(
            ingest_transaction, ingest_account, publish
        )

    async def _wait_until_idle(self):
        async with asyncio.timeout(10):
            while self.manager.busy:
                await asyncio.sleep(0.01)

    async def test_all_scenarios_report_alerts_actually_raised(self):
        runs = await self.manager.start(list(SCENARIOS), interval=0)
        await self._wait_until_idle()

        self.assertEqual(self.manager.status()["busy"], False)

        for run in runs:
            self.assertEqual(run["state"], "finished", run["error"])
            self.assertEqual(run["emitted"], run["total"])
            self.assertEqual(
                [alert["detector"] for alert in run["alerts_raised"]],
                [run["target_detector"]],
            )

        self.assertEqual(self.service.get_summary()["total_alerts"], 12)

    async def test_repeat_runs_use_new_identifiers(self):
        for _ in range(2):
            await self.manager.start(["cashout"], interval=0)
            await self._wait_until_idle()

        self.assertEqual(
            [run["state"] for run in self.manager.runs],
            ["finished", "finished"],
        )
        self.assertEqual(
            self.service.get_summary()["detector_summary"]["rapid_cashouts"], 3
        )

    async def test_second_start_is_refused_while_busy(self):
        await self.manager.start(["volume"], interval=0.01)

        with self.assertRaises(RuntimeError):
            await self.manager.start(["chain"], interval=0)

        await self.manager.stop()

    async def test_stop_marks_run_stopped(self):
        runs = await self.manager.start(["volume"], interval=5)
        await asyncio.sleep(0.05)

        await self.manager.stop()

        self.assertEqual(runs[0]["state"], "stopped")
        self.assertFalse(self.manager.busy)

    async def test_failed_ingest_is_reported_on_the_run(self):
        async def broken(tx, source):
            raise ValueError("boom")

        self.manager._ingest_transaction = broken

        runs = await self.manager.start(["chain"], interval=0)
        await self._wait_until_idle()

        self.assertEqual(runs[0]["state"], "failed")
        self.assertEqual(runs[0]["error"], "boom")

    async def test_traffic_starts_and_stops(self):
        await self.manager.set_traffic(True, 0.01)
        await asyncio.sleep(0.1)
        await self.manager.set_traffic(False)
        emitted = self.manager.traffic["emitted"]
        await asyncio.sleep(0.05)

        self.assertGreater(emitted, 0)
        self.assertEqual(self.manager.traffic["emitted"], emitted)


if __name__ == "__main__":
    unittest.main()
