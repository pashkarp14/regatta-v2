from __future__ import annotations

from typing import Any

from .app_state import socketio_ext
from .room_store import public_room_view


def serialize_room(room: dict[str, Any], player_token: str | None) -> dict[str, Any]:
    return {"room": public_room_view(room, player_token)}


def broadcast_room_presence(room: dict[str, Any]) -> None:
    socketio_ext().emit("room:presence", serialize_room(room, None), to=room["code"])


def broadcast_room_snapshot(room: dict[str, Any]) -> None:
    socketio_ext().emit("room:snapshot", serialize_room(room, None), to=room["code"])


def broadcast_room_state(room: dict[str, Any]) -> None:
    socketio_ext().emit("room:state_updated", serialize_room(room, None), to=room["code"])
