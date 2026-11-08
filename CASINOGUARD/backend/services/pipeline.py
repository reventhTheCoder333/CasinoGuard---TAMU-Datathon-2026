"""Ingest a record, then tell every connected dashboard what changed.

REST requests and the simulator both go through here, so demo traffic gets
exactly the same detection and broadcasting as real submissions.
"""

import asyncio

from backend.api.websocket import manager
from backend.services.detection_service import service
from backend.services.simulator import SimulatorManager


async def _publish(result):
    if "transaction" in result:
        await manager.broadcast({
            "event": "transaction_received",
            "data": result["transaction"]
        })

    if "account" in result:
        await manager.broadcast({
            "event": "account_registered",
            "data": result["account"]
        })

    # Broadcast newly detected alerts.
    for alert in result["new_alerts"]:
        await manager.broadcast({
            "event": "new_alert",
            "data": alert
        })

    for alert in result["updated_alerts"]:
        await manager.broadcast({
            "event": "alert_updated",
            "data": alert
        })

    await manager.broadcast({
        "event": "summary",
        "data": await asyncio.to_thread(service.get_summary)
    })


async def ingest_transaction(transaction, source="api"):
    # Detection is CPU work, so keep the event loop free for WebSocket clients.
    result = await asyncio.to_thread(
        service.process_transaction, transaction, source
    )
    await _publish(result)
    return result


async def ingest_account(account, source="api"):
    result = await asyncio.to_thread(service.process_account, account, source)
    await _publish(result)
    return result


async def _publish_simulator_status(status):
    await manager.broadcast({
        "event": "simulator_status",
        "data": status
    })


simulator = SimulatorManager(
    ingest_transaction,
    ingest_account,
    _publish_simulator_status,
)


def is_read_only():
    return service.source_info().get("read_only", False)


async def refresh_source(force=False):
    """Reload from Databricks and tell dashboards to reload if anything changed."""
    changed = await asyncio.to_thread(service.refresh, force)

    if changed or force:
        await manager.broadcast({"event": "state_reset", "data": {}})

    await manager.broadcast({
        "event": "summary",
        "data": await asyncio.to_thread(service.get_summary)
    })
    return changed


async def reset_demo():
    await simulator.reset()
    await asyncio.to_thread(service.reset)
    await manager.broadcast({"event": "state_reset", "data": {}})
    await _publish_simulator_status(simulator.status())


async def _publish_databricks_simulation(status):
    await manager.broadcast({
        "event": "databricks_simulation",
        "data": status
    })


def _create_databricks_simulation():
    from backend.services.databricks_pipeline import DatabricksSimulation

    return DatabricksSimulation(
        service,
        _publish_databricks_simulation,
        refresh_source,
    )


databricks_simulation = _create_databricks_simulation() if is_read_only() else None
