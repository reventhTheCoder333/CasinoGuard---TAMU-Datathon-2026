
import unittest

from detectors.transaction_structuring import detect_structuring


class TestStructuring(unittest.TestCase):

    def test_detects_structuring(self):
        transactions = [
            {
                "id": "TX001",
                "from": "A101",
                "to": "CASINO",
                "amount": 4000,
                "timestamp": "2026-11-05T10:00:00"
            },
            {
                "id": "TX002",
                "from": "A101",
                "to": "CASINO",
                "amount": 3500,
                "timestamp": "2026-11-05T10:15:00"
            },
            {
                "id": "TX003",
                "from": "A101",
                "to": "CASINO",
                "amount": 3000,
                "timestamp": "2026-11-05T10:30:00"
            }
        ]

        findings = detect_structuring(transactions)

        self.assertGreaterEqual(len(findings), 1)
        self.assertEqual(
            findings[0]["pattern"],
            "transaction_structuring"
        )
        self.assertEqual(findings[0]["total_amount"], 10500)

    def test_ignores_amount_below_threshold(self):
        transactions = [
            {
                "id": "TX001",
                "from": "A101",
                "to": "CASINO",
                "amount": 1000,
                "timestamp": "2026-11-05T10:00:00"
            },
            {
                "id": "TX002",
                "from": "A101",
                "to": "CASINO",
                "amount": 1000,
                "timestamp": "2026-11-05T10:15:00"
            }
        ]

        findings = detect_structuring(transactions)

        self.assertEqual(len(findings), 0)


if __name__ == "__main__":
    unittest.main()
