
import copy
import logging
import os
import threading
from datetime import datetime, timezone

import pandas as pd
from dotenv import load_dotenv

from backend.services.alert_enrichment import (
    DETECTORS,
    DISCLAIMER,
    GUIDANCE,
    accounts_involved,
    describe,
    detector_notes,
    why_flagged,
)
from data.transactions import generate_synthetic_data
from detectors.constants import is_house_account
from engine.detection_engine import run_all_detectors


logger = logging.getLogger("casinoguard.service")

# Detection re-runs over all history for each transaction, so memory and
# latency both grow with this limit. Enough for a long demo session.
MAX_TRANSACTIONS = 5000

# Detectors whose findings grow as evidence arrives. A finding that contains an
# existing alert's evidence extends that alert; one contained by it adds nothing.
EVIDENCE_FIELDS = {
    "transaction_chains": "transaction_ids",
    "transaction_structuring": "transaction_ids",
    "multiple_accounts": "accounts",
}


class DuplicateError(ValueError):
    """A record with this ID already exists."""


class CapacityError(RuntimeError):
    """The in-memory transaction limit has been reached."""


def normalize_timestamp(value):
    """Return naive UTC ISO-8601 at second precision.

    Detectors compare timestamps with each other, so a single naive/aware or
    differently formatted value would make them fail for all later requests.
    """
    parsed = (
        value
        if isinstance(value, datetime)
        else datetime.fromisoformat(str(value))
    )

    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)

    return parsed.replace(microsecond=0).isoformat()


def _utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class DetectionService:
    """In-memory transaction state plus the consolidated alert list."""

    def __init__(self):
        self._lock = threading.RLock()
        self.reset()

    # --------------------------------------------------
    # State
    # --------------------------------------------------

    def reset(self):
        """Restore the synthetic seed dataset and its baseline alerts."""
        with self._lock:
            transactions, accounts = generate_synthetic_data()

            self.transactions = [
                {**tx, "source": "seed", "synthetic": True}
                for tx in transactions
            ]
            self.accounts = [
                {**account, "source": "seed", "synthetic": True}
                for account in accounts
            ]
            self._transaction_ids = {tx["id"] for tx in self.transactions}
            self._account_ids = {a["account"] for a in self.accounts}
            self._records = {}
            self._keys = {}
            self._alert_counter = 0
            self.detector_errors = {}

            self._detect()

    # --------------------------------------------------
    # Ingestion
    # --------------------------------------------------

    def process_transaction(self, transaction, source="api"):
        with self._lock:
            if transaction["id"] in self._transaction_ids:
                raise DuplicateError("Transaction ID already exists")

            if len(self.transactions) >= MAX_TRANSACTIONS:
                raise CapacityError(
                    f"The demo holds at most {MAX_TRANSACTIONS} transactions. "
                    "Reset the demo to continue."
                )

            stored = {
                **transaction,
                "timestamp": normalize_timestamp(transaction["timestamp"]),
                "source": source,
                "synthetic": source != "api",
            }

            self.transactions.append(stored)
            self._transaction_ids.add(stored["id"])

            new_alerts, updated_alerts = self._detect()

            return {
                "transaction": stored,
                "new_alerts": new_alerts,
                "updated_alerts": updated_alerts,
                "report": self.get_detection_report(),
            }

    def process_account(self, account, source="api"):
        with self._lock:
            if account["account"] in self._account_ids:
                raise DuplicateError("Account already exists")

            stored = {
                **account,
                "source": source,
                "synthetic": source != "api",
            }

            self.accounts.append(stored)
            self._account_ids.add(stored["account"])

            new_alerts, updated_alerts = self._detect()

            return {
                "account": stored,
                "new_alerts": new_alerts,
                "updated_alerts": updated_alerts,
                "report": self.get_detection_report(),
            }

    # --------------------------------------------------
    # Alert consolidation
    # --------------------------------------------------

    def _detect(self):
        report = run_all_detectors(self.transactions, self.accounts)
        self.detector_errors = report["detector_errors"]
        return self._reconcile(report["alerts"])

    def _reconcile(self, findings):
        """Fold detector findings into alerts with stable identities.

        Detectors are stateless and re-report everything on each run, often as
        overlapping windows. Alerts already raised stay on record even if a
        later run no longer reports them, because analysts must be able to see
        what was flagged and when.
        """
        new_alerts = []
        updated_alerts = []

        # Largest evidence first, so a growing window is seen before the
        # smaller windows that it contains.
        def order(finding):
            field = EVIDENCE_FIELDS.get(finding["detector"])
            size = len(finding[field]) if field else 0
            return (-size, finding["detector"], str(finding))

        for finding in sorted(findings, key=order):
            field = EVIDENCE_FIELDS.get(finding["detector"])

            if field is None:
                record = self._keys.get(self._natural_key(finding))
                outcome = self._apply(finding, record)

            else:
                outcome = self._apply_evidence(finding, set(finding[field]))

            if outcome is None:
                continue

            kind, alert = outcome
            (new_alerts if kind == "new" else updated_alerts).append(alert)

        return new_alerts, updated_alerts

    @staticmethod
    def _natural_key(finding):
        detector = finding["detector"]

        if detector == "rapid_cashouts":
            return (detector, finding["account"], finding["deposit_id"])
        if detector == "unusual_volume":
            return (detector, finding["account"], finding["date"])
        return (detector, *finding["accounts"])

    def _apply_evidence(self, finding, evidence):
        peers = [
            record for record in self._records.values()
            if record["alert"]["detector"] == finding["detector"]
        ]

        for peer in peers:
            if evidence == peer["evidence"]:
                return self._apply(finding, peer)

            if evidence < peer["evidence"]:
                return None

        absorbed = [peer for peer in peers if peer["evidence"] < evidence]

        if not absorbed:
            return self._apply(finding, None, evidence=evidence)

        keeper, *merged = absorbed

        for peer in merged:
            del self._records[peer["alert"]["id"]]
            keeper["alert"]["merged_alert_ids"].append(peer["alert"]["id"])

        return self._apply(finding, keeper, evidence=evidence)

    def _apply(self, finding, record, evidence=None):
        now = _utc_now()

        if record is not None and record["finding"] == finding:
            return None

        if record is None:
            self._alert_counter += 1
            alert_id = f"CG-{self._alert_counter:04d}"
            record = {
                "alert": {
                    "id": alert_id,
                    "first_detected_at": now,
                    "revision": 0,
                    "merged_alert_ids": [],
                },
                "finding": None,
                "evidence": evidence or set(),
            }
            self._records[alert_id] = record

            if finding["detector"] not in EVIDENCE_FIELDS:
                self._keys[self._natural_key(finding)] = record

        is_new = record["finding"] is None
        base = record["alert"]

        record["finding"] = copy.deepcopy(finding)
        record["evidence"] = evidence or record["evidence"]
        record["alert"] = self._build_alert(
            finding,
            alert_id=base["id"],
            first_detected_at=base["first_detected_at"],
            last_updated_at=now,
            revision=base["revision"] + 1,
            merged_alert_ids=base["merged_alert_ids"],
        )

        return ("new" if is_new else "updated", record["alert"])

    @staticmethod
    def _build_alert(
        finding,
        alert_id,
        first_detected_at,
        last_updated_at,
        revision,
        merged_alert_ids,
    ):
        """The public alert: detector output plus presentation fields."""
        return {
            **finding,
            "id": alert_id,
            "detector_label": DETECTORS[finding["detector"]]["label"],
            **describe(finding),
            "accounts_involved": accounts_involved(finding),
            "first_detected_at": first_detected_at,
            "last_updated_at": last_updated_at,
            "revision": revision,
            "merged_alert_ids": merged_alert_ids,
            "disclaimer": DISCLAIMER,
        }

    # --------------------------------------------------
    # Reads
    # --------------------------------------------------

    def get_alerts(self):
        """All consolidated alerts, newest first."""
        with self._lock:
            return [
                record["alert"]
                for record in sorted(
                    self._records.values(),
                    key=lambda record: (
                        record["alert"]["first_detected_at"],
                        record["alert"]["id"],
                    ),
                    reverse=True
                )
            ]

    data_classification = "synthetic"

    def source_info(self):
        return {"kind": "local", "read_only": False, "status": "ready"}

    def enabled_detectors(self):
        return list(DETECTORS)

    def get_detection_report(self):
        with self._lock:
            alerts = self.get_alerts()

            return {
                "total_transactions": len(self.transactions),
                "total_accounts": len(self.accounts),
                "total_alerts": len(alerts),
                "detector_summary": {
                    detector: sum(a["detector"] == detector for a in alerts)
                    for detector in self.enabled_detectors()
                },
                "alerts": alerts,
                "detector_errors": dict(self.detector_errors),
                "data_classification": self.data_classification,
                "source": self.source_info(),
            }

    def get_summary(self):
        with self._lock:
            alerts = self.get_alerts()
            volume = sum(tx["amount"] for tx in self.transactions)

            return {
                "total_transactions": len(self.transactions),
                "total_accounts": len(self.known_account_ids()),
                "total_alerts": len(alerts),
                "total_volume": volume,
                "high_priority_alerts": sum(
                    a["severity"] == "high" for a in alerts
                ),
                "flagged_accounts": len({
                    account for a in alerts
                    for account in a["accounts_involved"]
                }),
                "detector_summary": {
                    detector: sum(a["detector"] == detector for a in alerts)
                    for detector in self.enabled_detectors()
                },
                "detector_errors": dict(self.detector_errors),
                "data_classification": self.data_classification,
                "source": self.source_info(),
            }

    def known_account_ids(self):
        """Every non-house account seen in profiles or transactions."""
        with self._lock:
            ids = set(self._account_ids)

            for tx in self.transactions:
                ids.update((tx["from"], tx["to"], tx["account"]))

            return {a for a in ids if not is_house_account(a)}

    def transactions_for_alert(self, alert):
        """The transactions behind an alert, oldest first."""
        with self._lock:
            detector = alert["detector"]

            if detector in (
                "transaction_chains",
                "transaction_structuring",
                "circular_transactions",
            ):
                ids = set(alert["transaction_ids"])
                selected = [tx for tx in self.transactions if tx["id"] in ids]

            elif detector == "rapid_cashouts":
                selected = self._cashout_transactions(alert)

            elif detector == "unusual_volume":
                selected = [
                    tx for tx in self.transactions
                    if tx["account"] == alert["account"]
                    and tx["timestamp"].startswith(alert["date"])
                ]

            else:
                linked = set(alert["accounts"])
                selected = [
                    tx for tx in self.transactions
                    if tx["from"] in linked or tx["to"] in linked
                ]

            return sorted(selected, key=lambda tx: tx["timestamp"])

    def _cashout_transactions(self, alert):
        by_id = {tx["id"]: tx for tx in self.transactions}
        deposit = by_id[alert["deposit_id"]]
        window = alert.get("thresholds", {}).get(
            "max_time_minutes",
            DETECTORS["rapid_cashouts"]["parameters"]["max_time_minutes"],
        )
        start = pd.Timestamp(deposit["timestamp"])
        end = start + pd.Timedelta(minutes=window)

        wagers = [
            tx for tx in self.transactions
            if tx["account"] == alert["account"]
            and tx["type"] == "wager"
            and start < pd.Timestamp(tx["timestamp"]) <= end
        ]

        return [
            deposit,
            *wagers,
            *(by_id[i] for i in alert["withdrawal_ids"]),
        ]

    def get_investigation(self, alert_id):
        with self._lock:
            record = self._records.get(alert_id)

            if record is None:
                return None

            alert = record["alert"]
            finding = record["finding"]
            guidance = GUIDANCE[alert["detector"]]

            return {
                "alert": alert,
                "disclaimer": DISCLAIMER,
                "data_classification": self.data_classification,
                "why_flagged": why_flagged(finding, alert.get("thresholds")),
                "detector_notes": detector_notes(finding),
                "detector_parameters": {
                    **DETECTORS[alert["detector"]]["parameters"],
                    **alert.get("thresholds", {}),
                },
                "detector_output": finding,
                "timeline": self.transactions_for_alert(alert),
                "accounts": [
                    self._account_profile(account, alert_id)
                    for account in alert["accounts_involved"]
                ],
                "alternative_explanations": guidance["alternatives"],
                "recommended_steps": guidance["next_steps"],
            }

    def _account_profile(self, account, alert_id):
        related = [
            tx for tx in self.transactions
            if account in (tx["from"], tx["to"])
        ]
        times = [tx["timestamp"] for tx in related]

        return {
            "account": account,
            "transaction_count": len(related),
            "total_sent": sum(
                tx["amount"] for tx in related if tx["from"] == account
            ),
            "total_received": sum(
                tx["amount"] for tx in related if tx["to"] == account
            ),
            "first_activity": min(times) if times else None,
            "last_activity": max(times) if times else None,
            "other_alerts": [
                {
                    "id": a["id"],
                    "title": a["title"],
                    "detector": a["detector"],
                    "severity": a["severity"],
                }
                for a in self.get_alerts()
                if a["id"] != alert_id and account in a["accounts_involved"]
            ],
        }


def create_service():
    """Local detection by default; Databricks when CASINOGUARD_DATA_SOURCE says so."""
    load_dotenv()

    if os.getenv("CASINOGUARD_DATA_SOURCE", "local").lower() == "databricks":
        from backend.services.databricks_source import DatabricksService
        return DatabricksService()

    return DetectionService()


# Application instance. Existing imports use the functions below.
service = create_service()


def get_detection_report():
    return service.get_detection_report()


def get_transactions():
    return service.transactions


def get_accounts():
    return service.accounts


def process_transaction(transaction, source="api"):
    return service.process_transaction(transaction, source=source)
