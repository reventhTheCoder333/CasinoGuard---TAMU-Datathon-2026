
import unittest

from detectors.rapid_cashout import detect_rapid_cashouts


class TestRapidCashout(unittest.TestCase):

    def test_detects_rapid_cashout(self):
        transactions = [
            {
                "id": "TX001",
                "account": "A101",
                "type": "deposit",
                "amount": 9000,
                "timestamp": "2026-11-05T10:00:00"
            },
            {
                "id": "TX002",
                "account": "A101",
                "type": "wager",
                "amount": 100,
                "timestamp": "2026-11-05T10:05:00"
            },
            {
                "id": "TX003",
                "account": "A101",
                "type": "withdrawal",
                "amount": 8900,
                "timestamp": "2026-11-05T10:15:00"
            }
        ]

        findings = detect_rapid_cashouts(transactions)

        self.assertEqual(len(findings), 1)
        self.assertEqual(
            findings[0]["pattern"],
            "rapid_cashout"
        )
        self.assertAlmostEqual(
            findings[0]["cashout_ratio"],
            0.9889,
            places=3
        )

    def test_ignores_normal_gambling_activity(self):
        transactions = [
            {
                "id": "TX001",
                "account": "A101",
                "type": "deposit",
                "amount": 9000,
                "timestamp": "2026-11-05T10:00:00"
            },
            {
                "id": "TX002",
                "account": "A101",
                "type": "wager",
                "amount": 7000,
                "timestamp": "2026-11-05T10:05:00"
            },
            {
                "id": "TX003",
                "account": "A101",
                "type": "withdrawal",
                "amount": 1000,
                "timestamp": "2026-11-05T10:15:00"
            }
        ]

        findings = detect_rapid_cashouts(transactions)

        self.assertEqual(len(findings), 0)


if __name__ == "__main__":
    unittest.main()
