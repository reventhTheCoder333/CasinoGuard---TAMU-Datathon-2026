"""Databricks as the source of truth for detection results.

This service reads alerts, evidence, transactions and account profiles from
Databricks tables. It never runs the detectors: each alert is exactly a row
of the alerts table. FastAPI only adds presentation (titles, review priority,
investigation layout) on top of the evidence Databricks returned.
"""

import json
import logging
import os
import threading
from datetime import datetime, timezone

from backend.integrations.databricks_sql import (
    DatabricksError,
    DatabricksSQLClient,
    validate_table,
)
from backend.services.alert_enrichment import DETECTORS
from backend.services.detection_service import (
    DetectionService,
    normalize_timestamp,
)


logger = logging.getLogger("casinoguard.databricks_source")

# Upstream pattern names, as written by the Databricks pipeline.
PATTERN_TO_DETECTOR = {
    "suspicious_transaction_chain": "transaction_chains",
    "transaction_structuring": "transaction_structuring",
    "rapid_cashout": "rapid_cashouts",
    "unusual_transaction_volume": "unusual_volume",
    "circular_transaction": "circular_transactions",
    "multiple_account_activity": "multiple_accounts",
}

# Multiple-account activity is intentionally not part of the Databricks
# pipeline. Rows with this pattern are ignored, not reported as errors.
EXCLUDED_PATTERNS = {"multiple_account_activity"}

ENABLED_DETECTORS = [
    detector for pattern, detector in PATTERN_TO_DETECTOR.items()
    if pattern not in EXCLUDED_PATTERNS
]

SINGLE_ACCOUNT_PATTERNS = {
    "transaction_structuring",
    "rapid_cashout",
    "unusual_transaction_volume",
}

MAX_ALERT_ROWS = 5000
MAX_TRANSACTION_ROWS = 5000
MAX_ACCOUNT_ROWS = 5000

THRESHOLD_NOTE = (
    "The limits shown are CASINOGUARD's reference values, because this alert's "
    "row has no thresholds_json. The Databricks pipeline may have used others."
)


class ReadOnlySourceError(RuntimeError):
    """Writes are refused: detection results come from Databricks."""


def _utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _tables():
    return {
        "alerts": validate_table(os.getenv(
            "DATABRICKS_ALERTS_SOURCE_TABLE", "workspace.default.aml_alerts_gold"
        )),
        "transactions": validate_table(os.getenv(
            "DATABRICKS_TRANSACTIONS_TABLE", "workspace.default.transactions_silver"
        )),
        "accounts": validate_table(os.getenv(
            "DATABRICKS_ACCOUNTS_TABLE", "workspace.default.accounts_silver"
        )),
    }


def _unique(values):
    return list(dict.fromkeys(values))


class DatabricksService(DetectionService):

    def __init__(self, client=None):
        # Deliberately does not call DetectionService.__init__, which loads
        # the local seed data and runs the detectors.
        self._lock = threading.RLock()
        self._refresh_lock = threading.Lock()
        self._client = client
        self.tables = _tables()
        self.transactions = []
        self.accounts = []
        self._transaction_ids = set()
        self._account_ids = set()
        self._records = {}
        self._keys = {}
        self._alert_counter = 0
        self.detector_errors = {}
        self.status = "loading"
        self.error = None
        self.last_refreshed_at = None
        self.skipped_rows = []
        self.data_classification = os.getenv(
            "CASINOGUARD_DATA_CLASSIFICATION", "synthetic"
        )

    # --------------------------------------------------
    # Loading
    # --------------------------------------------------

    @property
    def client(self):
        if self._client is None:
            self._client = DatabricksSQLClient.from_env()
        return self._client

    def reset(self):
        self.refresh()

    def enabled_detectors(self):
        return list(ENABLED_DETECTORS)

    def refresh(self, force=False):
        """Reload from Databricks. Returns True if the content changed.

        On failure the previously loaded data stays in place and the error is
        reported through source_info().
        """
        # A forced refresh (after a pipeline run) waits for any refresh in
        # progress rather than skipping, so it always reads the new results.
        if not self._refresh_lock.acquire(blocking=force):
            return False

        try:
            tables = self.tables
            alert_rows = self.client.query(
                "SELECT * "
                f"FROM {tables['alerts']} "
                f"ORDER BY detected_at DESC LIMIT {MAX_ALERT_ROWS}"
            )
            transaction_rows = self.client.query(
                "SELECT id, account, `from`, `to`, amount, timestamp, type "
                f"FROM {tables['transactions']} "
                f"ORDER BY timestamp DESC LIMIT {MAX_TRANSACTION_ROWS}"
            )
            account_rows = self.client.query(
                "SELECT account, phone, email, payment_card "
                f"FROM {tables['accounts']} LIMIT {MAX_ACCOUNT_ROWS}"
            )

            changed = self._load(alert_rows, transaction_rows, account_rows)

            with self._lock:
                self.status = "ready"
                self.error = None
                self.last_refreshed_at = _utc_now()

            return changed

        except DatabricksError as error:
            logger.warning("Databricks refresh failed: %s", error)
            with self._lock:
                self.status = "error"
                self.error = str(error)
            return False

        finally:
            self._refresh_lock.release()

    def _load(self, alert_rows, transaction_rows, account_rows):
        synthetic = self.data_classification == "synthetic"

        transactions = sorted(
            (
                {
                    "id": row["id"],
                    "account": row["account"],
                    "from": row["from"],
                    "to": row["to"],
                    "amount": float(row["amount"] or 0),
                    "timestamp": normalize_timestamp(row["timestamp"]),
                    "type": row["type"],
                    "source": "databricks",
                    "synthetic": synthetic,
                }
                for row in transaction_rows
            ),
            key=lambda tx: tx["timestamp"],
        )

        accounts = [
            {**row, "source": "databricks", "synthetic": synthetic}
            for row in account_rows
        ]

        records = {}
        skipped = []

        for row in alert_rows:
            if row.get("pattern") in EXCLUDED_PATTERNS:
                continue

            try:
                record = self._record_from_row(row)
            except (KeyError, TypeError, ValueError) as error:
                skipped.append({
                    "alert_id": row.get("alert_id"),
                    "pattern": row.get("pattern"),
                    "reason": str(error) or type(error).__name__,
                })
                continue

            records[record["alert"]["id"]] = record

        with self._lock:
            before = self._fingerprint()
            self.transactions = transactions
            self.accounts = accounts
            self._transaction_ids = {tx["id"] for tx in transactions}
            self._account_ids = {a["account"] for a in accounts}
            self._records = records
            self.skipped_rows = skipped
            return self._fingerprint() != before

    def _fingerprint(self):
        return (
            tuple(sorted(
                (
                    alert_id,
                    record["alert"]["first_detected_at"],
                    json.dumps(record["finding"], sort_keys=True, default=str),
                )
                for alert_id, record in self._records.items()
            )),
            len(self.transactions),
            len(self.accounts),
        )

    def _record_from_row(self, row):
        detector = PATTERN_TO_DETECTOR.get(row["pattern"])

        if detector is None:
            raise ValueError(f"unknown pattern {row['pattern']!r}")

        evidence = json.loads(row.get("evidence_json") or "{}")
        thresholds = json.loads(row.get("thresholds_json") or "{}")

        if not isinstance(evidence, dict) or not isinstance(thresholds, dict):
            raise ValueError("evidence_json or thresholds_json is not an object")

        finding = {
            "detector": detector,
            "pattern": row["pattern"],
            **self._from_columns(row),
            # Detector metrics in evidence_json take precedence.
            **evidence,
        }

        detected_at = normalize_timestamp(row["detected_at"]) + "+00:00"
        alert = self._build_alert(
            finding,
            alert_id=row["alert_id"],
            first_detected_at=detected_at,
            last_updated_at=detected_at,
            revision=1,
            merged_alert_ids=[],
        )
        alert["accounts_involved"] = _unique(
            (row.get("accounts") or []) or alert["accounts_involved"]
        )
        alert["source"] = "databricks"
        alert["thresholds"] = thresholds

        return {"alert": alert, "finding": finding, "evidence": set()}

    @staticmethod
    def _from_columns(row):
        """Fields the pipeline stores in table columns rather than evidence_json."""
        accounts = list(row.get("accounts") or [])
        transaction_ids = list(row.get("transaction_ids") or [])
        fields = {"accounts": accounts}

        if transaction_ids:
            fields["transaction_ids"] = transaction_ids
        if row.get("total_amount") is not None:
            fields["total_amount"] = float(row["total_amount"])

        if row["pattern"] in SINGLE_ACCOUNT_PATTERNS:
            if len(accounts) != 1:
                raise ValueError(f"expected one account, got {len(accounts)}")
            fields["account"] = accounts[0]

        if row["pattern"] == "suspicious_transaction_chain" and transaction_ids:
            fields["hops"] = len(transaction_ids)

        if row["pattern"] == "rapid_cashout":
            # The pipeline stores the deposit followed by the withdrawals.
            if not transaction_ids:
                raise ValueError("rapid cash-out row has no transaction_ids")
            fields["deposit_id"] = transaction_ids[0]
            fields["withdrawal_ids"] = transaction_ids[1:]

        if row["pattern"] == "transaction_structuring":
            fields["transaction_count"] = len(transaction_ids)

        return fields

    # --------------------------------------------------
    # Writes are not allowed
    # --------------------------------------------------

    def process_transaction(self, transaction, source="api"):
        raise ReadOnlySourceError(
            "Detection results come from Databricks. Add transactions to the "
            "Databricks pipeline instead."
        )

    def process_account(self, account, source="api"):
        raise ReadOnlySourceError(
            "Detection results come from Databricks. Add accounts to the "
            "Databricks pipeline instead."
        )

    # --------------------------------------------------
    # Reads
    # --------------------------------------------------

    def source_info(self):
        with self._lock:
            return {
                "kind": "databricks",
                "read_only": True,
                "status": self.status,
                "error": self.error,
                "last_refreshed_at": self.last_refreshed_at,
                "host": getattr(self._client, "host", None),
                "warehouse": getattr(self._client, "warehouse_name", None)
                or getattr(self._client, "warehouse_id", None),
                "tables": dict(self.tables),
                "alert_rows": len(self._records) + len(self.skipped_rows),
                "enabled_detectors": self.enabled_detectors(),
                "skipped_rows": list(self.skipped_rows),
            }

    def get_investigation(self, alert_id):
        investigation = super().get_investigation(alert_id)

        if investigation is None:
            return None

        finding = investigation["detector_output"]
        notes = list(investigation["detector_notes"])
        accounts = finding.get("accounts") or []

        if len(accounts) != len(set(accounts)):
            notes.insert(0, (
                "Data quality: Databricks lists the same account more than "
                "once in this alert's account list. Check the upstream detector "
                "before relying on this alert."
            ))

        if not investigation["timeline"]:
            notes.append(
                "No matching transactions were found in "
                f"{self.tables['transactions']}."
            )

        if not investigation["alert"].get("thresholds"):
            notes.append(THRESHOLD_NOTE)
        investigation["detector_notes"] = notes
        investigation["data_classification"] = self.data_classification
        investigation["data_source"] = {
            "kind": "databricks",
            "table": self.tables["alerts"],
            "alert_id": alert_id,
        }
        return investigation
