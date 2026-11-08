
import unittest

from detectors.circular_transactions import detect_circular_transactions


class TestCircularTransactions(unittest.TestCase):

    def test_detects_circular_transaction(self):
        transactions = [
            {
                "id": "TX001",
                "from": "A",
                "to": "B",
                "amount": 5000
            },
            {
                "id": "TX002",
                "from": "B",
                "to": "C",
                "amount": 4900
            },
            {
                "id": "TX003",
                "from": "C",
                "to": "A",
                "amount": 4800
            }
        ]

        findings = detect_circular_transactions(transactions)

        self.assertEqual(len(findings), 1)
        self.assertEqual(
            findings[0]["pattern"],
            "circular_transaction"
        )
        self.assertEqual(
            findings[0]["total_amount"],
            14700
        )

    def test_ignores_non_circular_transactions(self):
        transactions = [
            {
                "id": "TX001",
                "from": "A",
                "to": "B",
                "amount": 5000
            },
            {
                "id": "TX002",
                "from": "B",
                "to": "C",
                "amount": 4900
            },
            {
                "id": "TX003",
                "from": "C",
                "to": "D",
                "amount": 4800
            }
        ]

        findings = detect_circular_transactions(transactions)

        self.assertEqual(len(findings), 0)


if __name__ == "__main__":
    unittest.main()
