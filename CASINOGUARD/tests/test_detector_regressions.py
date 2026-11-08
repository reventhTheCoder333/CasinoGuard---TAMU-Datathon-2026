"""Bugs found while connecting the detectors to a live stream."""

import unittest

from detectors.circular_transactions import detect_circular_transactions
from detectors.multiple_accounts import detect_multiple_accounts
from detectors.transaction_chains import detect_suspicious_chains
from detectors.transaction_structuring import detect_structuring
from engine.detection_engine import run_all_detectors


def tx(tx_id, sender, receiver, amount, timestamp, tx_type="transfer"):
    return {
        "id": tx_id,
        "account": sender,
        "from": sender,
        "to": receiver,
        "amount": amount,
        "timestamp": timestamp,
        "type": tx_type,
    }


CHAIN = [
    tx("1", "A", "B", 5000, "2026-11-05T10:00:00"),
    tx("2", "B", "C", 4900, "2026-11-05T10:04:00"),
    tx("3", "C", "D", 4800, "2026-11-05T10:08:00"),
]


class TestChains(unittest.TestCase):

    def test_later_repeat_transfer_keeps_earlier_chain(self):
        later = tx("4", "A", "B", 5, "2026-11-05T20:00:00")

        findings = detect_suspicious_chains(CHAIN + [later])

        self.assertEqual(findings[0]["transaction_ids"], ["1", "2", "3"])

    def test_out_of_order_hops_are_not_a_chain(self):
        backwards = [
            tx("1", "A", "B", 5000, "2026-11-05T10:08:00"),
            tx("2", "B", "C", 4900, "2026-11-05T10:04:00"),
            tx("3", "C", "D", 4800, "2026-11-05T10:00:00"),
        ]

        self.assertEqual(detect_suspicious_chains(backwards), [])

    def test_dissimilar_amounts_are_not_a_chain(self):
        dissimilar = CHAIN[:2] + [
            tx("3", "C", "D", 500, "2026-11-05T10:08:00")
        ]

        self.assertEqual(detect_suspicious_chains(dissimilar), [])

    def test_paths_through_the_casino_are_ignored(self):
        through_hub = [
            tx("1", "A", "CASINO", 5000, "2026-11-05T10:00:00", "deposit"),
            tx("2", "CASINO", "B", 4900, "2026-11-05T10:04:00", "withdrawal"),
            tx("3", "B", "C", 4800, "2026-11-05T10:08:00"),
            tx("4", "C", "D", 4800, "2026-11-05T10:10:00"),
        ]

        self.assertEqual(detect_suspicious_chains(through_hub), [])


class TestStructuring(unittest.TestCase):

    def test_casino_payouts_are_not_structuring(self):
        payouts = [
            tx(str(i), "CASINO", f"P{i}", 4000, f"2026-11-05T10:{i}0:00")
            for i in range(3)
        ]

        self.assertEqual(detect_structuring(payouts), [])

    def test_transactions_above_threshold_do_not_count(self):
        large = [
            tx("1", "A", "CAGE1", 50000, "2026-11-05T10:00:00"),
            tx("2", "A", "CAGE1", 100, "2026-11-05T10:01:00"),
            tx("3", "A", "CAGE1", 100, "2026-11-05T10:02:00"),
        ]

        self.assertEqual(detect_structuring(large), [])

    def test_wagers_do_not_count(self):
        wagers = [
            tx(str(i), "A", "CASINO", 4000, f"2026-11-05T10:{i}0:00", "wager")
            for i in range(3)
        ]

        self.assertEqual(detect_structuring(wagers), [])


class TestCircular(unittest.TestCase):

    def test_same_loop_is_reported_identically_from_any_order(self):
        loop = [
            tx("1", "B", "C", 100, "2026-11-05T10:00:00"),
            tx("2", "C", "A", 100, "2026-11-05T10:01:00"),
            tx("3", "A", "B", 100, "2026-11-05T10:02:00"),
        ]

        forwards = detect_circular_transactions(loop)
        backwards = detect_circular_transactions(loop[::-1])

        self.assertEqual(forwards[0]["accounts"], ["A", "B", "C"])
        self.assertEqual(backwards[0]["accounts"], ["A", "B", "C"])

    def test_loops_through_the_casino_are_ignored(self):
        loop = [
            tx("1", "A", "B", 100, "2026-11-05T10:00:00"),
            tx("2", "B", "CASINO", 100, "2026-11-05T10:01:00"),
            tx("3", "CASINO", "A", 100, "2026-11-05T10:02:00"),
        ]

        self.assertEqual(detect_circular_transactions(loop), [])


class TestMultipleAccounts(unittest.TestCase):

    def test_reports_which_identifiers_are_shared(self):
        findings = detect_multiple_accounts([
            {"account": "B", "phone": "1", "email": "b@x", "payment_card": "X"},
            {"account": "A", "phone": "1", "email": "a@x", "payment_card": "Y"},
        ])

        self.assertEqual(findings[0]["accounts"], ["A", "B"])
        self.assertEqual(findings[0]["shared_identifiers"], [
            {"field": "phone", "value": "1", "accounts": ["A", "B"]}
        ])


class TestEngine(unittest.TestCase):

    def test_one_failing_detector_does_not_stop_the_others(self):
        accounts = [{"account": "A", "phone": "1"}, {"account": "B", "phone": "1"}]
        broken = [{"id": "1"}]  # Missing fields make transaction detectors fail.

        report = run_all_detectors(broken, accounts)

        self.assertIn("transaction_chains", report["detector_errors"])
        self.assertEqual(report["detector_summary"]["multiple_accounts"], 1)


if __name__ == "__main__":
    unittest.main()
