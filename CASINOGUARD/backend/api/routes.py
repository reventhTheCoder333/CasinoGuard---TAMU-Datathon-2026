import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response

from backend.api.schemas import (
    Account,
    DatabricksSimulationRequest,
    SimulatorRun,
    TrafficSettings,
    Transaction,
)
from backend.integrations.clients import (
    IntegrationError,
    IntegrationNotConfigured,
    databricks,
    serpapi,
    tableau,
    to_csv,
)
from backend.services.alert_enrichment import DETECTORS
from backend.services.detection_service import (
    CapacityError,
    DuplicateError,
    get_accounts,
    get_detection_report,
    get_transactions,
    service,
)
from backend.services.graph_service import build_graph
from backend.services.databricks_source import ReadOnlySourceError
from backend.integrations.databricks_sql import DatabricksNotConfigured
from backend.services import pipeline
from backend.services.pipeline import (
    ingest_account,
    ingest_transaction,
    is_read_only,
    refresh_source,
    reset_demo,
    simulator,
)
from backend.services.simulator import SCENARIOS


router = APIRouter()


def require_local_detection():
    """The simulator feeds local detection, so it is off in Databricks mode."""
    if is_read_only():
        raise HTTPException(
            status_code=409,
            detail="The simulator is unavailable: detection results come from Databricks."
        )


# --------------------------------------------------
# Transactions and accounts
# --------------------------------------------------

@router.get("/transactions")
def transactions_endpoint(
    limit: int | None = Query(default=None, ge=1, le=5000),
    account: str | None = Query(default=None, max_length=64),
):
    """Transactions in arrival order. `limit` returns the most recent ones."""
    transactions = get_transactions()

    if account is not None:
        transactions = [
            tx for tx in transactions
            if account in (tx["account"], tx["from"], tx["to"])
        ]

    return transactions[-limit:] if limit else transactions


@router.get("/accounts")
def accounts_endpoint():

    return get_accounts()


@router.post("/transactions")
async def create_transaction(transaction: Transaction):

    transaction_data = transaction.model_dump(
        by_alias=True,
        mode="json"
    )

    try:

        result = await ingest_transaction(transaction_data)

    except (DuplicateError, ReadOnlySourceError) as error:

        raise HTTPException(status_code=409, detail=str(error))

    except CapacityError as error:

        raise HTTPException(status_code=503, detail=str(error))

    return {
        "message": "Transaction processed successfully",
        "transaction": result["transaction"],
        "new_alerts": result["new_alerts"],
        "updated_alerts": result["updated_alerts"],
        "total_alerts": result["report"]["total_alerts"]
    }


@router.post("/accounts")
async def create_account(account: Account):

    try:

        result = await ingest_account(account.model_dump())

    except (DuplicateError, ReadOnlySourceError) as error:

        raise HTTPException(status_code=409, detail=str(error))

    return {
        "message": "Account registered successfully",
        "account": result["account"],
        "new_alerts": result["new_alerts"],
        "updated_alerts": result["updated_alerts"],
        "total_alerts": result["report"]["total_alerts"]
    }


# --------------------------------------------------
# Detection results
# --------------------------------------------------

@router.get("/detect")
def detect_endpoint():

    return get_detection_report()


@router.get("/detectors")
def detectors_endpoint():
    """The enabled detectors with their default thresholds."""
    return [
        {"key": key, **DETECTORS[key]}
        for key in service.enabled_detectors()
    ]


@router.get("/summary")
def summary_endpoint():

    return service.get_summary()


@router.get("/alerts")
def alerts_endpoint(
    detector: Literal[
        "transaction_chains",
        "transaction_structuring",
        "rapid_cashouts",
        "unusual_volume",
        "circular_transactions",
        "multiple_accounts",
    ] | None = None,
    severity: Literal["high", "medium"] | None = None,
):
    alerts = service.get_alerts()

    if detector:
        alerts = [a for a in alerts if a["detector"] == detector]

    if severity:
        alerts = [a for a in alerts if a["severity"] == severity]

    return alerts


@router.get("/alerts/{alert_id}")
def alert_investigation_endpoint(alert_id: str):

    investigation = service.get_investigation(alert_id)

    if investigation is None:
        raise HTTPException(status_code=404, detail="Alert not found")

    return investigation


@router.get("/graph")
def graph_endpoint():

    return build_graph(service)


# --------------------------------------------------
# Simulator
# --------------------------------------------------

@router.get("/simulator")
def simulator_endpoint():

    return {
        "scenarios": [
            {
                "key": key,
                "name": scenario["name"],
                "description": scenario["description"],
                "target_detector": scenario["target_detector"],
            }
            for key, scenario in SCENARIOS.items()
        ],
        "status": simulator.status(),
    }


@router.post("/simulator/run", status_code=202)
async def simulator_run_endpoint(run: SimulatorRun):

    require_local_detection()

    keys = list(SCENARIOS) if run.scenario == "all" else [run.scenario]

    try:

        runs = await simulator.start(keys, run.interval)

    except RuntimeError as error:

        raise HTTPException(status_code=409, detail=str(error))

    return {"runs": runs}


@router.post("/simulator/traffic")
async def simulator_traffic_endpoint(settings: TrafficSettings):

    require_local_detection()

    return await simulator.set_traffic(settings.enabled, settings.interval)


@router.post("/simulator/stop")
async def simulator_stop_endpoint():

    await simulator.stop()

    return simulator.status()


@router.post("/simulator/reset")
async def simulator_reset_endpoint():
    """Restore the seed dataset and discard everything added since."""
    require_local_detection()
    await reset_demo()

    return service.get_summary()


# --------------------------------------------------
# Data source
# --------------------------------------------------

@router.get("/source")
def source_endpoint():

    return service.source_info()


@router.post("/source/refresh")
async def source_refresh_endpoint():
    """Reload alerts, transactions and accounts from Databricks."""
    if not is_read_only():
        raise HTTPException(
            status_code=409,
            detail="Refresh applies only when Databricks is the data source."
        )

    changed = await refresh_source()
    info = service.source_info()

    if info["status"] == "error":
        raise HTTPException(status_code=502, detail=info["error"])

    return {**info, "changed": changed}


@router.get("/databricks/simulation")
def databricks_simulation_endpoint():

    if pipeline.databricks_simulation is None:
        raise HTTPException(status_code=409, detail="Databricks is not the data source.")

    return pipeline.databricks_simulation.status()


@router.post("/databricks/simulate", status_code=202)
async def databricks_simulate_endpoint(request: DatabricksSimulationRequest | None = None):
    """Generate data for a scenario, run the Databricks pipeline, then reload.

    The body is optional; without one, all five patterns are embedded.
    """
    if pipeline.databricks_simulation is None:
        raise HTTPException(status_code=409, detail="Databricks is not the data source.")

    request = request or DatabricksSimulationRequest()

    try:

        current = await pipeline.databricks_simulation.start(request.scenario, request.seed)

    except DatabricksNotConfigured as error:

        raise HTTPException(status_code=503, detail=str(error))

    except RuntimeError as error:

        raise HTTPException(status_code=409, detail=str(error))

    return current


# --------------------------------------------------
# Integrations
# --------------------------------------------------

@router.get("/integrations")
def integrations_endpoint():

    return [databricks.status(), serpapi.status(), tableau.status()]


@router.post("/integrations/databricks/export")
async def databricks_export_endpoint():

    if is_read_only():
        raise HTTPException(
            status_code=409,
            detail="Export is off while Databricks is the source of truth."
        )

    try:

        return await asyncio.to_thread(
            databricks.export_alerts, service.get_alerts()
        )

    except IntegrationNotConfigured as error:

        raise HTTPException(status_code=503, detail=str(error))

    except IntegrationError as error:

        raise HTTPException(status_code=502, detail=str(error))


@router.get("/integrations/serpapi/search")
async def serpapi_search_endpoint(
    q: str = Query(min_length=2, max_length=200),
    limit: int = Query(default=5, ge=1, le=10),
):

    try:

        return await asyncio.to_thread(serpapi.search, q, limit)

    except IntegrationNotConfigured as error:

        raise HTTPException(status_code=503, detail=str(error))

    except IntegrationError as error:

        raise HTTPException(status_code=502, detail=str(error))


@router.get("/export/alerts.csv")
def export_alerts_endpoint():

    rows = [
        {**alert, "accounts_involved": " ".join(alert["accounts_involved"]),
         "data_classification": "synthetic"}
        for alert in service.get_alerts()
    ]

    return Response(
        to_csv(rows, [
            "id", "detector", "pattern", "severity", "title", "summary",
            "accounts_involved", "exposure", "first_detected_at",
            "last_updated_at", "revision", "data_classification",
        ]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=casinoguard_alerts.csv"},
    )


@router.get("/export/transactions.csv")
def export_transactions_endpoint():

    return Response(
        to_csv(get_transactions(), [
            "id", "account", "from", "to", "amount", "timestamp", "type",
            "source", "synthetic",
        ]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=casinoguard_transactions.csv"},
    )
