from __future__ import annotations

from typing import Any

from flask import Blueprint, current_app, request

from ..game_state import room_requires_live_loop
from ..observability import log_event, payload_bytes
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


def payload_boat_count(payload: dict[str, Any]) -> int | None:
    boats = (payload.get("game_state") or {}).get("boats") if isinstance(payload, dict) else None
    return len(boats) if isinstance(boats, list) else None


def remote_addr_label() -> str:
    forwarded_for = request.headers.get("X-Forwarded-For", "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.remote_addr or "-"


@bp.post("/api/rooms")
def create_room():
    payload = json_payload()
    log_event(
        current_app.logger,
        "room.create.request",
        remote_addr=remote_addr_label(),
        content_length=request.content_length or 0,
        display_name=payload.get("display_name"),
        host_role=payload.get("host_role"),
        requested_max_players=payload.get("max_players"),
        game_state_boats=payload_boat_count(payload),
    )
    room = create_room_from_payload(payload)
    log_event(
        current_app.logger,
        "room.create.response",
        room_code=room.get("code"),
        status=room.get("status"),
        joined_count=room.get("joined_count"),
        joined_racers_count=room.get("joined_racers_count"),
        payload_bytes=payload_bytes({"room": room}),
    )
    return {"room": room}


@bp.post("/api/rooms/join")
def join_room():
    payload = json_payload()
    room = join_room_from_payload(payload)
    log_event(
        current_app.logger,
        "room.join.response",
        room_code=room.get("code"),
        joined_count=room.get("joined_count"),
        joined_racers_count=room.get("joined_racers_count"),
        payload_bytes=payload_bytes({"room": room}),
    )
    return {"room": room}


@bp.post("/api/rooms/leave")
def leave_room():
    room_code, room = leave_current_room()
    if room_code and room is not None:
        if room_requires_live_loop(room):
            ensure_realtime_room_loop(room["code"])
        broadcast_room_snapshot(room)
    log_event(
        current_app.logger,
        "room.leave.response",
        room_code=room_code or "-",
        room_present=room is not None,
    )
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
    log_event(
        current_app.logger,
        "room.start.response",
        room_code=room.get("code"),
        revision=room.get("revision"),
        payload_bytes=payload_bytes({"room": room}),
    )
    return serialize_room(room, player_token)


@bp.post("/api/rooms/<room_code>/edit")
def edit_room(room_code: str):
    room, player_token = edit_room_match(room_code)
    pop_realtime_control(room["code"])
    broadcast_room_snapshot(room)
    log_event(current_app.logger, "room.edit.response", room_code=room.get("code"), revision=room.get("revision"))
    return serialize_room(room, player_token)


@bp.post("/api/rooms/<room_code>/reset-lobby")
def reset_lobby(room_code: str):
    room, player_token = reset_room_lobby(room_code)
    pop_realtime_control(room["code"])
    broadcast_room_snapshot(room)
    log_event(current_app.logger, "room.reset_lobby.response", room_code=room.get("code"), revision=room.get("revision"))
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
    log_event(
        current_app.logger,
        "room.kick.response",
        room_code=room.get("code"),
        kicked_token_present=bool(kicked_token),
        old_racers=len(old_racer_ids),
        new_racers=len(new_racer_ids),
    )
    return serialize_room(room, player_token)
