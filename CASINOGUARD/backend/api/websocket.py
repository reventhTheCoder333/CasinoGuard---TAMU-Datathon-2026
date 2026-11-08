import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect


logger = logging.getLogger("casinoguard.websocket")

router = APIRouter()

SEND_TIMEOUT_SECONDS = 2


class ConnectionManager:

    def __init__(self):
        self.active_connections = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def _send(self, connection, message):
        try:
            await asyncio.wait_for(
                connection.send_json(message),
                timeout=SEND_TIMEOUT_SECONDS
            )
        except Exception:
            # A stalled client must not hold up detection for everyone else.
            logger.info("Dropping unresponsive WebSocket client")
            self.disconnect(connection)

    async def broadcast(self, message: dict):
        await asyncio.gather(*(
            self._send(connection, message)
            for connection in list(self.active_connections)
        ))


manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):

    await manager.connect(websocket)

    try:
        await websocket.send_json({
            "event": "connected",
            "message": "Connected to CASINOGUARD live stream"
        })

        while True:
            # Keep connection alive and answer client heartbeats.
            if await websocket.receive_text() == "ping":
                await websocket.send_json({"event": "pong"})

    except WebSocketDisconnect:
        pass

    except Exception:
        logger.exception("WebSocket connection failed")

    finally:
        manager.disconnect(websocket)
