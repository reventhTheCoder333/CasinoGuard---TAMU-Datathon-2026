
import unittest

from detectors.transaction_chains import detect_suspicious_chains


class TestTransactionChains(unittest.TestCase):

    def test_detects_suspicious_chain(self):
        transactions = [
            {
                "id": "TX001",
                "from": "A",
                "to": "B",
                "amount": 5000,
                "timestamp": "2026-11-05T10:00:00"
            },
            {
                "id": "TX002",
                "from": "B",
                "to": "C",
                "amount": 4900,
                "timestamp": "2026-11-05T10:04:00"
            },
            {
                "id": "TX003",
                "from": "C",
                "to": "D",
                "amount": 4800,
                "timestamp": "2026-11-05T10:08:00"
            }
        ]

        findings = detect_suspicious_chains(transactions)

        self.assertEqual(len(findings), 1)
        self.assertEqual(
            findings[0]["pattern"],
            "suspicious_transaction_chain"
        )
        self.assertEqual(
            findings[0]["accounts"],
            ["A", "B", "C", "D"]
        )

    def test_ignores_slow_chain(self):
        transactions = [
            {
                "id": "TX001",
                "from": "A",
                "to": "B",
                "amount": 5000,
                "timestamp": "2026-11-05T10:00:00"
            },
            {
                "id": "TX002",
                "from": "B",
                "to": "C",
                "amount": 4900,
                "timestamp": "2026-11-05T10:30:00"
            },
            {
                "id": "TX003",
                "from": "C",
                "to": "D",
                "amount": 4800,
                "timestamp": "2026-11-05T11:00:00"
            }
        ]

        findings = detect_suspicious_chains(transactions)

        self.assertEqual(len(findings), 0)


if __name__ == "__main__":
    unittest.main()
