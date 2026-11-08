"""The scenario generator embeds exactly the requested patterns.

Uses the local detectors as a stand-in for the Databricks pipeline; the real
pipeline was also run for every scenario (see docs/DATABRICKS_SETUP.md).
"""

import unittest
from collections import Counter
from datetime import datetime, timezone

from backend.api.schemas import Account, Transaction
from data.scenarios import FULL, SCENARIOS, generate_scenario_data
from engine.detection_engine import run_all_detectors


def detected(transactions, accounts):
    report = run_all_detectors(transactions, accounts)
    return Counter(
        alert["pattern"] for alert in report["alerts"]
        if alert["detector"] != "multiple_accounts"
    ), report


class TestScenarioGenerator(unittest.TestCase):

    def test_each_mode_embeds_only_its_patterns(self):
        for scenario in [FULL, *SCENARIOS]:
            for seed in range(15):
                with self.subTest(scenario=scenario, seed=seed):
                    transactions, accounts, expected = generate_scenario_data(scenario, seed)
                    found, report = detected(transactions, accounts)

                    self.assertEqual(report["detector_errors"], {})
                    self.assertEqual(found, Counter(e["pattern"] for e in expected))

    def test_full_simulation_has_all_five(self):
        _, _, expected = generate_scenario_data(FULL, 1)
        self.assertEqual(len(expected), 5)

    def test_individual_simulation_has_one(self):
        for scenario in SCENARIOS:
            _, _, expected = generate_scenario_data(scenario, 1)
            self.assertEqual(len(expected), 1)

    def test_background_alone_triggers_nothing(self):
        from data.scenarios import _Builder
        import random

        for seed in range(20):
            builder = _Builder(random.Random(seed), datetime(2026, 1, 1).date())
            builder.background()
            found, _ = detected(builder.transactions, list(builder.accounts.values()))
            self.assertEqual(found, Counter(), f"seed {seed}")

    def test_records_pass_api_validation(self):
        transactions, accounts, _ = generate_scenario_data(FULL, 3)

        for tx in transactions:
            Transaction.model_validate(tx)
        for account in accounts:
            Account.model_validate(account)

        self.assertEqual(len({tx["id"] for tx in transactions}), len(transactions))

    def test_no_future_timestamps_at_any_time_of_day(self):
        for hour in (0, 6, 23):
            now = datetime(2026, 11, 7, hour, 5, tzinfo=timezone.utc)
            transactions, _, _ = generate_scenario_data(FULL, 5, now=now)
            latest = max(tx["timestamp"] for tx in transactions)
            self.assertLess(latest, now.replace(tzinfo=None).isoformat())

    def test_seed_is_reproducible_and_runs_differ(self):
        self.assertEqual(generate_scenario_data(FULL, 9), generate_scenario_data(FULL, 9))
        self.assertNotEqual(generate_scenario_data(FULL, 9)[0], generate_scenario_data(FULL, 10)[0])

    def test_unknown_scenario(self):
        with self.assertRaises(ValueError):
            generate_scenario_data("multiple_accounts")


if __name__ == "__main__":
    unittest.main()
