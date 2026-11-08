
import unittest

from detectors.multiple_accounts import detect_multiple_accounts


class TestMultipleAccounts(unittest.TestCase):

    def test_detects_shared_identifiers(self):
        accounts = [
            {
                "account": "A101",
                "phone": "555-1234",
                "email": "a101@example.com",
                "payment_card": "CARD-01"
            },
            {
                "account": "A205",
                "phone": "555-1234",
                "email": "a205@example.com",
                "payment_card": "CARD-01"
            },
            {
                "account": "A309",
                "phone": "555-9876",
                "email": "a309@example.com",
                "payment_card": "CARD-02"
            }
        ]

        findings = detect_multiple_accounts(accounts)

        self.assertEqual(len(findings), 1)

        detected_accounts = set(findings[0]["accounts"])

        self.assertEqual(
            detected_accounts,
            {"A101", "A205"}
        )

    def test_ignores_unrelated_accounts(self):
        accounts = [
            {
                "account": "A101",
                "phone": "555-1111",
                "email": "a101@example.com",
                "payment_card": "CARD-01"
            },
            {
                "account": "A205",
                "phone": "555-2222",
                "email": "a205@example.com",
                "payment_card": "CARD-02"
            }
        ]

        findings = detect_multiple_accounts(accounts)

        self.assertEqual(len(findings), 0)


if __name__ == "__main__":
    unittest.main()
