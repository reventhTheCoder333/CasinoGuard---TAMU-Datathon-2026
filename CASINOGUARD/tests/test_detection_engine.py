
import unittest

from data.transactions import generate_synthetic_data
from engine.detection_engine import run_all_detectors


class TestDetectionEngine(unittest.TestCase):

    def test_all_six_detectors_run(self):
        transactions, accounts = generate_synthetic_data()

        report = run_all_detectors(transactions, accounts)

        expected_detectors = {
            "transaction_chains",
            "transaction_structuring",
            "rapid_cashouts",
            "unusual_volume",
            "circular_transactions",
            "multiple_accounts"
        }

        self.assertEqual(
            set(report["detector_summary"].keys()),
            expected_detectors
        )

    def test_all_six_patterns_are_detected(self):
        transactions, accounts = generate_synthetic_data()

        report = run_all_detectors(transactions, accounts)

        self.assertEqual(report["total_alerts"], 6)

        for detector, count in report["detector_summary"].items():
            self.assertGreaterEqual(
                count,
                1,
                f"{detector} did not detect its expected pattern"
            )

    def test_alerts_have_required_fields(self):
        transactions, accounts = generate_synthetic_data()

        report = run_all_detectors(transactions, accounts)

        for alert in report["alerts"]:
            self.assertIn("detector", alert)
            self.assertIn("pattern", alert)


if __name__ == "__main__":
    unittest.main()
