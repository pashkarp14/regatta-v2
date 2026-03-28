from __future__ import annotations

import logging
import time
from typing import Any

from flask import current_app, has_app_context

from .app_state import socketio_ext
from .observability import log_event, observe_socket_outbound, payload_bytes
from .room_store import public_room_presence_view, public_room_view


def serialize_room(room: dict[str, Any], player_token: str | None) -> dict[str, Any]:
    return {"room": public_room_view(room, player_token)}


def serialize_room_presence(room: dict[str, Any]) -> dict[str, Any]:
    return {"room": public_room_presence_view(room, None)}


def _broadcast_room_event(
    event_name: str,
    room: dict[str, Any],
    *,
    payload: dict[str, Any] | None = None,
) -> None:
    started_at = time.perf_counter()
    payload = payload or serialize_room(room, None)
    outbound_bytes = payload_bytes(payload)
    observe_socket_outbound(event_name, outbound_bytes)
    socketio_ext().emit(event_name, payload, to=room["code"])
    logger = current_app.logger if has_app_context() else logging.getLogger(__name__)
    log_event(
        logger,
        "realtime.loop.broadcast" if event_name == "room:state_updated" else "socket.broadcast",
        level=logging.DEBUG if event_name == "room:state_updated" else logging.INFO,
        room_code=room.get("code"),
        socket_event=event_name,
        duration_ms=round((time.perf_counter() - started_at) * 1000.0, 4),
        payload_bytes=outbound_bytes,
        fanout=len(room.get("players", [])),
        revision=room.get("revision"),
    )


def broadcast_room_presence(room: dict[str, Any]) -> None:
    _broadcast_room_event("room:presence", room, payload=serialize_room_presence(room))


def broadcast_room_snapshot(room: dict[str, Any]) -> None:
    _broadcast_room_event("room:snapshot", room)


def broadcast_room_state(room: dict[str, Any]) -> None:
    _broadcast_room_event("room:state_updated", room)
