from __future__ import annotations

from typing import Any

from flask import Blueprint, request

from ..game_state import room_requires_live_loop
from ..room_events import broadcast_room_snapshot, serialize_room
from ..room_service import (
    create_room_from_payload,
    join_room_from_payload,
    leave_current_room,
    room_view,
    start_room_match,
)
from ..sockets import ensure_realtime_room_loop


bp = Blueprint("rooms", __name__)


def json_payload() -> dict[str, Any]:
    return request.get_json(silent=True) or {}


@bp.post("/api/rooms")
def create_room():
    return {"room": create_room_from_payload(json_payload())}


@bp.post("/api/rooms/join")
def join_room():
    return {"room": join_room_from_payload(json_payload())}


@bp.post("/api/rooms/leave")
def leave_room():
    leave_current_room()
    return {"room": None}


@bp.get("/api/rooms/<room_code>")
def get_room(room_code: str):
    return {"room": room_view(room_code)}


@bp.post("/api/rooms/<room_code>/start")
def start_room(room_code: str):
    arm_realtime = bool(json_payload().get("arm_realtime", True))
    room, player_token = start_room_match(room_code, arm_realtime=arm_realtime)
    if room_requires_live_loop(room):
        ensure_realtime_room_loop(room["code"])
    broadcast_room_snapshot(room)
    return serialize_room(room, player_token)
