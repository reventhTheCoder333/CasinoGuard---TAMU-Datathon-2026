
import unittest
from datetime import datetime, timedelta

from detectors.unusual_volume import detect_unusual_volume


class TestUnusualVolume(unittest.TestCase):

    def test_detects_unusual_volume(self):
        transactions = []

        start_date = datetime(2026, 10, 29)

        # Seven days of normal activity
        for day in range(7):
            current_date = start_date + timedelta(days=day)

            for j in range(2):
                transactions.append({
                    "id": f"HIST_{day}_{j}",
                    "account": "A101",
                    "timestamp": (
                        current_date + timedelta(hours=10 + j)
                    ).isoformat()
                })

        # Sudden increase on the eighth day
        current_date = datetime(2026, 11, 5)

        for j in range(20):
            transactions.append({
                "id": f"CURRENT_{j}",
                "account": "A101",
                "timestamp": (
                    current_date + timedelta(minutes=j * 2)
                ).isoformat()
            })

        findings = detect_unusual_volume(transactions)

        self.assertEqual(len(findings), 1)
        self.assertEqual(
            findings[0]["pattern"],
            "unusual_transaction_volume"
        )
        self.assertEqual(
            findings[0]["transaction_count"],
            20
        )

    def test_ignores_stable_volume(self):
        transactions = []

        start_date = datetime(2026, 10, 29)

        # Eight days with identical activity
        for day in range(8):
            current_date = start_date + timedelta(days=day)

            for j in range(2):
                transactions.append({
                    "id": f"TX_{day}_{j}",
                    "account": "A101",
                    "timestamp": (
                        current_date + timedelta(hours=10 + j)
                    ).isoformat()
                })

        findings = detect_unusual_volume(transactions)

        self.assertEqual(len(findings), 0)


if __name__ == "__main__":
    unittest.main()
