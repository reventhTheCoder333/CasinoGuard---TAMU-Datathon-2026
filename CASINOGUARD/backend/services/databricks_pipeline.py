"""Simulate data through the Databricks pipeline.

1. Generate a day of background activity with the chosen suspicious
   pattern(s) embedded (data/scenarios.py).
2. Upload it as the CSV files the CASINOGUARD_AML notebook ingests into the
   bronze tables (the notebook's first cells overwrite bronze from them).
3. Run the Databricks job: CSV → bronze → silver → five detectors → gold.
4. Check the job really rebuilt bronze, silver and aml_alerts_gold from this
   upload, so stale results are never presented as fresh.
5. Reload the dashboard from Databricks, then compare the alerts Databricks
   produced with the patterns that were embedded.

Detection only ever runs in Databricks.
"""

import asyncio
import csv
import io
import logging
import os
import random
import re
import time
import uuid
from datetime import datetime, timezone

from backend.api.schemas import Account, Transaction
from backend.integrations.databricks_sql import DatabricksError, DatabricksNotConfigured
from data.scenarios import FULL, SCENARIOS, generate_scenario_data


logger = logging.getLogger("casinoguard.databricks_pipeline")

POLL_SECONDS = 5
TERMINAL_STATES = {"TERMINATED", "SKIPPED", "INTERNAL_ERROR"}

TRANSACTION_COLUMNS = ["id", "account", "from", "to", "amount", "timestamp", "type"]
ACCOUNT_COLUMNS = ["account", "phone", "email", "payment_card"]

STEPS = [
    ("generating", "Generate synthetic data"),
    ("uploading", "Upload to Databricks"),
    ("running_job", "Run Databricks pipeline"),
    ("verifying", "Check results are fresh"),
    ("loading_results", "Load alerts"),
]


def _now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _csv(rows, columns):
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode()


def generate_dataset(scenario=FULL, seed=None):
    """Scenario data, validated like API submissions."""
    transactions, accounts, expected = generate_scenario_data(scenario, seed)

    for tx in transactions:
        # Raises ValueError (pydantic) if the generator ever emits bad data.
        Transaction.model_validate(tx)
    for account in accounts:
        Account.model_validate(account)

    return transactions, accounts, expected


def scenario_label(scenario):
    return "Full simulation" if scenario == FULL else SCENARIOS[scenario]


def compare_with_expected(expected, alerts):
    """Which embedded patterns Databricks detected, and anything else it found.

    This is a check on the run, not a source of alerts: the dashboard always
    shows exactly what Databricks returned.
    """
    unmatched = list(alerts)
    patterns = []

    for item in expected:
        wanted = set(item["accounts"])
        match = next(
            (
                alert for alert in unmatched
                if alert.get("pattern") == item["pattern"]
                and set(alert["accounts_involved"]) == wanted
            ),
            None,
        )
        if match:
            unmatched.remove(match)
        patterns.append({
            "pattern": item["pattern"],
            "accounts": item["accounts"],
            "detected": match is not None,
            "alert_id": match["id"] if match else None,
        })

    unexpected = [
        {"pattern": alert.get("pattern"), "alert_id": alert["id"], "title": alert["title"]}
        for alert in unmatched
    ]

    return {
        "matched": all(p["detected"] for p in patterns) and not unexpected,
        "expected": patterns,
        "unexpected": unexpected,
    }


def pipeline_config():
    volume = os.getenv(
        "DATABRICKS_UPLOAD_VOLUME", "/Volumes/workspace/default/casinoguard_data"
    ).rstrip("/")

    return {
        "job_id": os.getenv("DATABRICKS_PIPELINE_JOB_ID") or None,
        "volume": volume,
        "transactions_path": f"{volume}/transactions.csv",
        "accounts_path": f"{volume}/accounts.csv",
        "timeout_seconds": int(os.getenv("DATABRICKS_JOB_TIMEOUT_SECONDS", "1800")),
        "bronze": {
            "transactions": os.getenv(
                "DATABRICKS_TRANSACTIONS_BRONZE_TABLE", "workspace.default.transactions_bronze"
            ),
            "accounts": os.getenv(
                "DATABRICKS_ACCOUNTS_BRONZE_TABLE", "workspace.default.accounts_bronze"
            ),
        },
    }


class PipelineFailure(RuntimeError):
    """A step failed. The message is safe to show to users."""


class DatabricksSimulation:
    """Runs one simulation at a time and reports progress."""

    def __init__(self, service, publish, refresh, sleep=asyncio.sleep, clock=time.monotonic):
        self._service = service
        self._publish = publish
        self._refresh = refresh
        self._sleep = sleep
        self._clock = clock
        self._task = None
        self.current = None

    @property
    def busy(self):
        return self._task is not None and not self._task.done()

    def status(self):
        config = pipeline_config()
        return {
            "configured": bool(config["job_id"]),
            "busy": self.busy,
            "current": self.current,
            "steps": [{"key": key, "label": label} for key, label in STEPS],
            "scenarios": [
                {"key": FULL, "label": scenario_label(FULL)},
                *({"key": key, "label": label} for key, label in SCENARIOS.items()),
            ],
        }

    async def start(self, scenario=FULL, seed=None):
        if self.busy:
            raise RuntimeError("A simulation is already running")

        if scenario != FULL and scenario not in SCENARIOS:
            raise ValueError(f"Unknown scenario: {scenario!r}")

        if not pipeline_config()["job_id"]:
            raise DatabricksNotConfigured(
                "Set DATABRICKS_PIPELINE_JOB_ID to the Databricks job that runs the pipeline"
            )

        self.current = {
            "id": uuid.uuid4().hex[:12],
            "scenario": scenario,
            "scenario_label": scenario_label(scenario),
            # A fresh seed per run gives new data; it is kept so a run can be repeated.
            "seed": seed if seed is not None else random.SystemRandom().randrange(2**31),
            "expected": None,
            "check": None,
            "state": "generating",
            "started_at": _now(),
            "finished_at": None,
            "job_run_id": None,
            "job_run_url": None,
            "job_state": None,
            "uploaded": None,
            "alerts_loaded": None,
            "failed_step": None,
            "error": None,
        }
        self._task = asyncio.create_task(self._run(self.current))
        await self._publish(self.status())
        return self.current

    async def stop(self):
        if self.busy:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        # A task cancelled before it started never reached its own handler.
        if self.current and self.current["state"] not in ("succeeded", "failed", "cancelled"):
            self.current.update(state="cancelled", finished_at=_now())
            await self._publish(self.status())

    async def _set(self, simulation, **changes):
        simulation.update(changes)
        await self._publish(self.status())

    async def _run(self, simulation):
        client = self._service.client
        config = pipeline_config()

        try:
            # 1. Generate.
            transactions, accounts, expected = await asyncio.to_thread(
                generate_dataset, simulation["scenario"], simulation["seed"]
            )
            simulation["expected"] = expected

            # Databricks' own clock, so freshness checks can't be fooled by skew.
            started = (await asyncio.to_thread(
                client.query, "SELECT current_timestamp() AS now"
            ))[0]["now"]

            active = await asyncio.to_thread(client.active_job_runs, config["job_id"])
            if active:
                raise PipelineFailure(
                    "The Databricks pipeline job is already running. Try again when it finishes."
                )

            # 2. Upload the notebook's input files.
            await self._set(simulation, state="uploading")
            await asyncio.to_thread(
                client.upload_file, config["transactions_path"],
                _csv(transactions, TRANSACTION_COLUMNS),
            )
            await asyncio.to_thread(
                client.upload_file, config["accounts_path"],
                _csv(accounts, ACCOUNT_COLUMNS),
            )
            uploaded = {"transactions": len(transactions), "accounts": len(accounts)}

            # 3. Run the job.
            run_id = await asyncio.to_thread(client.run_job, config["job_id"])
            await self._set(simulation, state="running_job", uploaded=uploaded, job_run_id=run_id)
            run = await self._wait_for_job(client, run_id, config["timeout_seconds"], simulation)

            result = run["state"].get("result_state")
            if result != "SUCCESS":
                message = run["state"].get("state_message") or "no message"
                raise PipelineFailure(
                    f"The Databricks job finished with {result or run['state'].get('life_cycle_state')}: "
                    f"{message[:300]}"
                )

            # 4. Verify the job used this upload and rebuilt gold.
            await self._set(simulation, state="verifying")
            await asyncio.to_thread(self._verify, client, config, started, uploaded)

            # 5. Load the new results into the dashboard.
            await self._set(simulation, state="loading_results")
            await self._refresh(force=True)

            info = self._service.source_info()
            if info["status"] == "error":
                raise PipelineFailure(f"The job succeeded but loading alerts failed: {info['error']}")

            alerts = self._service.get_alerts()
            await self._set(
                simulation,
                state="succeeded",
                finished_at=_now(),
                alerts_loaded=len(alerts),
                check=compare_with_expected(expected, alerts),
            )

        except asyncio.CancelledError:
            await self._cancel_job(client, simulation)
            simulation.update(state="cancelled", finished_at=_now())
            raise

        except (PipelineFailure, DatabricksError, ValueError) as error:
            logger.warning("Databricks simulation failed: %s", error)
            await self._set(
                simulation, state="failed", failed_step=simulation["state"],
                finished_at=_now(), error=str(error),
            )

        except Exception:
            logger.exception("Databricks simulation failed")
            await self._set(
                simulation, state="failed", failed_step=simulation["state"],
                finished_at=_now(), error="Unexpected error. See the API server logs.",
            )

    async def _wait_for_job(self, client, run_id, timeout, simulation):
        deadline = self._clock() + timeout

        while True:
            run = await asyncio.to_thread(client.get_job_run, run_id)
            state = run["state"]["life_cycle_state"]

            if simulation["job_state"] != state or not simulation["job_run_url"]:
                await self._set(simulation, job_state=state, job_run_url=run.get("run_page_url"))

            if state in TERMINAL_STATES:
                return run

            if self._clock() > deadline:
                await asyncio.to_thread(client.cancel_job_run, run_id)
                raise PipelineFailure(
                    f"The Databricks job took longer than {timeout // 60} minutes and was cancelled"
                )

            await self._sleep(POLL_SECONDS)

    async def _cancel_job(self, client, simulation):
        if simulation.get("job_run_id") and simulation.get("state") == "running_job":
            try:
                await asyncio.to_thread(client.cancel_job_run, simulation["job_run_id"])
            except DatabricksError:
                logger.warning("Could not cancel Databricks run %s", simulation["job_run_id"])

    def _verify(self, client, config, started, uploaded):
        tables = self._service.tables
        checks = [
            (config["bronze"]["transactions"], uploaded["transactions"]),
            (config["bronze"]["accounts"], uploaded["accounts"]),
            (tables["transactions"], uploaded["transactions"]),
        ]

        for table, expected in checks:
            count = client.query(f"SELECT COUNT(*) AS n FROM {table}")[0]["n"]
            if count != expected:
                raise PipelineFailure(
                    f"{table} has {count} rows but {expected} were uploaded. "
                    "The job may not have ingested this upload."
                )

        if not re.fullmatch(r"\d{4}-\d\d-\d\dT[\d:.]+Z?", str(started)):
            raise PipelineFailure("Databricks returned an unexpected timestamp")

        written = client.query(f"DESCRIBE HISTORY {tables['alerts']} LIMIT 1")
        last_write = written[0]["timestamp"] if written else None

        if not last_write or last_write < started:
            raise PipelineFailure(
                f"The job succeeded but {tables['alerts']} wasn't rebuilt "
                f"(last written {last_write or 'never'}). Showing earlier results."
            )

        stale = client.query(
            f"SELECT COUNT(*) AS n FROM {tables['alerts']} "
            f"WHERE detected_at < '{started}'"
        )[0]["n"]

        if stale:
            raise PipelineFailure(
                f"{stale} rows in {tables['alerts']} are older than this simulation."
            )
