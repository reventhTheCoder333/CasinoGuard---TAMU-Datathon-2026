import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.api.routes import router as api_router
from backend.api.websocket import manager, router as websocket_router
from backend.services.detection_service import service
from backend.services import pipeline
from backend.services.pipeline import is_read_only, refresh_source, simulator


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("casinoguard")

FRONTEND_BUILD = Path(__file__).resolve().parent.parent / "frontend" / "dist"


async def keep_source_fresh():
    """Load from Databricks at startup, then optionally on an interval.

    Polling is off by default: each refresh runs queries on the SQL warehouse
    and keeps it from auto-stopping. Set DATABRICKS_REFRESH_SECONDS to enable.
    """
    await refresh_source()

    interval = int(os.getenv("DATABRICKS_REFRESH_SECONDS", "0") or 0)

    while interval > 0:
        await asyncio.sleep(max(interval, 15))
        await refresh_source()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Startup must not wait for a cold warehouse; the dashboard shows loading.
    task = asyncio.create_task(keep_source_fresh()) if is_read_only() else None

    yield

    if task:
        task.cancel()
    if pipeline.databricks_simulation:
        await pipeline.databricks_simulation.stop()
    await simulator.stop()


app = FastAPI(
    title="CASINOGUARD API",
    description="Real-Time Casino Financial Intelligence Platform",
    version="1.1.0",
    lifespan=lifespan
)


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, error: RequestValidationError):
    # The default response echoes the input, and cannot serialize values such
    # as an amount of 1e999. Clients only need to know what was wrong.
    return JSONResponse(
        status_code=422,
        content={
            "detail": [
                {
                    "loc": list(item["loc"]),
                    "msg": item["msg"],
                    "type": item["type"]
                }
                for item in error.errors()
            ]
        }
    )


@app.exception_handler(Exception)
async def unhandled_error(request: Request, error: Exception):
    logger.error(
        "Unhandled error on %s %s",
        request.method,
        request.url.path,
        exc_info=error
    )

    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    )


@app.get("/health")
def health_check():

    errors = service.detector_errors
    source = service.source_info()
    healthy = not errors and source["status"] != "error"

    return {
        "status": "healthy" if healthy else "degraded",
        "application": "CASINOGUARD",
        "data_classification": service.data_classification,
        "source": {k: source.get(k) for k in ("kind", "status", "error", "last_refreshed_at")},
        "transactions": len(service.transactions),
        "websocket_clients": len(manager.active_connections),
        "detector_errors": errors
    }


app.include_router(
    api_router,
    prefix="/api"
)

app.include_router(
    websocket_router
)

# One-port demo mode: serve the built dashboard when it exists.
if FRONTEND_BUILD.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=FRONTEND_BUILD, html=True),
        name="dashboard"
    )
