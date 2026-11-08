import unittest

from backend.services.detection_service import (
    CapacityError,
    DetectionService,
    DuplicateError,
    normalize_timestamp,
)
from backend.services import detection_service


def deposit(tx_id, account, amount, timestamp):
    return {
        "id": tx_id,
        "account": account,
        "from": account,
        "to": "CAGE001",
        "amount": amount,
        "timestamp": timestamp,
        "type": "deposit",
    }


def hop(tx_id, sender, receiver, amount, timestamp):
    return {
        "id": tx_id,
        "account": sender,
        "from": sender,
        "to": receiver,
        "amount": amount,
        "timestamp": timestamp,
        "type": "transfer",
    }


class TestNormalizeTimestamp(unittest.TestCase):

    def test_formats_become_comparable(self):
        expected = "2026-01-02T10:00:00"

        self.assertEqual(normalize_timestamp("2026-01-02T10:00:00"), expected)
        self.assertEqual(normalize_timestamp("2026-01-02T10:00:00Z"), expected)
        self.assertEqual(normalize_timestamp("2026-01-02T10:00:00.123"), expected)
        self.assertEqual(normalize_timestamp("2026-01-02T12:00:00+02:00"), expected)


class TestConsolidation(unittest.TestCase):

    def setUp(self):
        self.service = DetectionService()

    def test_seed_baseline_has_one_alert_per_detector(self):
        summary = self.service.get_summary()

        self.assertEqual(summary["total_alerts"], 6)
        self.assertEqual(set(summary["detector_summary"].values()), {1})

    def test_duplicate_transaction_is_rejected_and_not_stored(self):
        before = len(self.service.transactions)

        with self.assertRaises(DuplicateError):
            self.service.process_transaction(
                deposit("NORMAL001", "X", 1, "2026-01-01T00:00:00")
            )

        self.assertEqual(len(self.service.transactions), before)

    def test_capacity_limit(self):
        original = detection_service.MAX_TRANSACTIONS
        detection_service.MAX_TRANSACTIONS = len(self.service.transactions)
        self.addCleanup(
            setattr, detection_service, "MAX_TRANSACTIONS", original
        )

        with self.assertRaises(CapacityError):
            self.service.process_transaction(
                deposit("NEW", "X", 1, "2026-01-01T00:00:00")
            )

    def test_growing_structuring_window_is_one_alert(self):
        results = [
            self.service.process_transaction(
                deposit(f"S{i}", "S", 4000, f"2026-01-01T10:{i}0:00")
            )
            for i in range(5)
        ]

        self.assertEqual(len(results[1]["new_alerts"]), 0)
        self.assertEqual(len(results[2]["new_alerts"]), 1)

        alert_id = results[2]["new_alerts"][0]["id"]
        final = results[4]["updated_alerts"][0]

        self.assertEqual(final["id"], alert_id)
        self.assertEqual(final["transaction_count"], 5)
        self.assertEqual(final["revision"], 3)
        self.assertEqual(results[4]["new_alerts"], [])
        self.assertEqual(self.service.get_summary()["total_alerts"], 7)

    def test_longer_chain_extends_alert_without_subchain_alerts(self):
        times = ["10:00", "10:03", "10:06", "10:09"]
        names = "ABCDE"
        results = [
            self.service.process_transaction(hop(
                f"H{i}", f"N_{names[i]}", f"N_{names[i + 1]}", 5000,
                f"2026-01-01T{times[i]}:00",
            ))
            for i in range(4)
        ]

        self.assertEqual(len(results[2]["new_alerts"]), 1)
        self.assertEqual(results[3]["new_alerts"], [])
        self.assertEqual(
            results[3]["updated_alerts"][0]["accounts"],
            [f"N_{n}" for n in names],
        )

    def test_linked_account_groups_merge_into_one_alert(self):
        def account(name, phone, card):
            return {"account": name, "phone": phone, "payment_card": card}

        first = self.service.process_account(account("M1", "1", "x"))
        second = self.service.process_account(account("M2", "1", "y"))
        third = self.service.process_account(account("M3", "2", "z"))
        fourth = self.service.process_account(account("M4", "2", "w"))
        bridge = self.service.process_account(account("M5", "1", "z"))

        self.assertEqual(first["new_alerts"], [])
        self.assertEqual(len(second["new_alerts"]), 1)
        self.assertEqual(third["new_alerts"], [])
        self.assertEqual(len(fourth["new_alerts"]), 1)

        merged = bridge["updated_alerts"][0]

        self.assertEqual(merged["accounts"], ["M1", "M2", "M3", "M4", "M5"])
        self.assertEqual(merged["merged_alert_ids"], [fourth["new_alerts"][0]["id"]])
        self.assertIsNone(
            self.service.get_investigation(fourth["new_alerts"][0]["id"])
        )

    def test_unchanged_alerts_are_not_rebroadcast(self):
        result = self.service.process_transaction(
            deposit("QUIET", "QUIET", 10, "2026-01-01T00:00:00")
        )

        self.assertEqual(result["new_alerts"], [])
        self.assertEqual(result["updated_alerts"], [])

    def test_alert_stays_on_record_after_detector_stops_reporting_it(self):
        self.service.process_transaction(
            deposit("D1", "R", 5000, "2026-01-01T10:00:00")
        )
        result = self.service.process_transaction({
            "id": "W1", "account": "R", "from": "CASINO", "to": "R",
            "amount": 4900, "timestamp": "2026-01-01T10:05:00",
            "type": "withdrawal",
        })
        alert_id = result["new_alerts"][0]["id"]

        # Later play pushes the wager ratio above the detector's limit.
        self.service.process_transaction({
            "id": "G1", "account": "R", "from": "R", "to": "CASINO",
            "amount": 3000, "timestamp": "2026-01-01T10:06:00",
            "type": "wager",
        })

        self.assertIsNotNone(self.service.get_investigation(alert_id))

    def test_reset_restores_seed_state(self):
        self.service.process_transaction(
            deposit("X1", "X", 10, "2026-01-01T00:00:00")
        )

        self.service.reset()

        self.assertEqual(self.service.get_summary()["total_alerts"], 6)
        self.assertNotIn("X1", [tx["id"] for tx in self.service.transactions])


class TestInvestigation(unittest.TestCase):

    def setUp(self):
        self.service = DetectionService()

    def test_every_seed_alert_is_fully_explained(self):
        for alert in self.service.get_alerts():
            investigation = self.service.get_investigation(alert["id"])

            self.assertIn("not proof of wrongdoing", investigation["disclaimer"])
            self.assertEqual(investigation["data_classification"], "synthetic")
            self.assertTrue(investigation["why_flagged"])
            self.assertTrue(all(r["met"] for r in investigation["why_flagged"]))
            self.assertTrue(investigation["accounts"])
            self.assertTrue(investigation["alternative_explanations"])
            self.assertTrue(investigation["recommended_steps"])
            self.assertEqual(
                investigation["detector_output"]["pattern"], alert["pattern"]
            )

    def _investigate(self, detector):
        alert = next(
            a for a in self.service.get_alerts() if a["detector"] == detector
        )
        return self.service.get_investigation(alert["id"])

    def test_timeline_matches_the_evidence(self):
        ids = lambda name: [t["id"] for t in self._investigate(name)["timeline"]]

        self.assertEqual(
            ids("transaction_chains"), ["CHAIN001", "CHAIN002", "CHAIN003"]
        )
        self.assertEqual(
            ids("rapid_cashouts"), ["CASH001", "CASH002", "CASH003"]
        )
        self.assertEqual(len(ids("unusual_volume")), 20)

    def test_thresholds_come_from_the_detector(self):
        rules = self._investigate("transaction_structuring")["why_flagged"]

        self.assertEqual(rules[0]["threshold"], 10000)
        self.assertEqual(rules[0]["observed"], 10500.0)

    def test_zero_variance_score_is_explained(self):
        notes = self._investigate("unusual_volume")["detector_notes"]

        self.assertIn("nominal", notes[0])

    def test_shared_identifiers_are_reported(self):
        alert = self._investigate("multiple_accounts")["alert"]

        self.assertEqual(
            {s["field"] for s in alert["shared_identifiers"]},
            {"phone", "payment_card"},
        )


if __name__ == "__main__":
    unittest.main()
