from __future__ import annotations

from typing import Any

from flask import Blueprint, request

from ..game_state import room_requires_live_loop
from ..room_events import broadcast_room_snapshot, serialize_room
from ..room_service import (
    create_room_from_payload,
    edit_room_match,
    join_room_from_payload,
    kick_room_player,
    leave_current_room,
    reset_room_lobby,
    room_view,
    start_room_match,
)
from ..sockets import emit_room_kicked, ensure_realtime_room_loop, pop_realtime_control, remap_realtime_controls


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
    room_code, room = leave_current_room()
    if room_code and room is not None:
        if room_requires_live_loop(room):
            ensure_realtime_room_loop(room["code"])
        broadcast_room_snapshot(room)
    return {"room": None}


@bp.get("/api/rooms/<room_code>")
def get_room(room_code: str):
    return {"room": room_view(room_code)}


@bp.post("/api/rooms/<room_code>/start")
def start_room(room_code: str):
    payload = json_payload()
    arm_realtime = bool(payload.get("arm_realtime", True))
    room, player_token = start_room_match(
        room_code,
        arm_realtime=arm_realtime,
        game_state=payload.get("game_state"),
    )
    if room_requires_live_loop(room):
        ensure_realtime_room_loop(room["code"])
    broadcast_room_snapshot(room)
    return serialize_room(room, player_token)


@bp.post("/api/rooms/<room_code>/edit")
def edit_room(room_code: str):
    room, player_token = edit_room_match(room_code)
    pop_realtime_control(room["code"])
    broadcast_room_snapshot(room)
    return serialize_room(room, player_token)


@bp.post("/api/rooms/<room_code>/reset-lobby")
def reset_lobby(room_code: str):
    room, player_token = reset_room_lobby(room_code)
    pop_realtime_control(room["code"])
    broadcast_room_snapshot(room)
    return serialize_room(room, player_token)


@bp.post("/api/rooms/<room_code>/kick")
def kick_room(room_code: str):
    payload = json_payload()
    room, player_token, kicked_token, old_racer_ids, new_racer_ids = kick_room_player(room_code, payload.get("player_id"))
    remap_realtime_controls(room_code, old_racer_ids, new_racer_ids)
    emit_room_kicked(room_code, kicked_token)
    if room_requires_live_loop(room):
        ensure_realtime_room_loop(room["code"])
    broadcast_room_snapshot(room)
    return serialize_room(room, player_token)
