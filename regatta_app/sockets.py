from __future__ import annotations

import threading
import time
from copy import deepcopy
from typing import Any

from flask import current_app, session
from flask_socketio import emit, join_room

from .extensions import socketio
from .realtime_engine import simulate_realtime_tick
from .room_store import RoomForbidden, RoomStoreError, public_room_view, validate_game_state


REALTIME_TICK_HZ = 12
REALTIME_CONTROL_STALE_MS = 1200

_realtime_lock = threading.Lock()
_realtime_loops: set[str] = set()
_realtime_controls: dict[str, dict[int, dict[str, Any]]] = {}


def room_store():
    return current_app.extensions["room_store"]


def room_actor(room: dict[str, Any], player_token: str | None):
    return next((player for player in room.get("players", []) if player.get("token") == player_token), None)


def state_play_mode(game_state: dict[str, Any] | None) -> str:
    if not isinstance(game_state, dict):
        return "turns"
    settings = game_state.get("settings") or {}
    mode = settings.get("playMode")
    if mode in {"realtime", "hybrid"}:
        return "realtime"
    return "turns"


def normalize_control_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    target = (payload or {}).get("target")
    if not isinstance(target, dict):
        return {"active": False, "target": None, "updatedAt": int(time.time() * 1000)}
    x = target.get("x")
    y = target.get("y")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return {"active": False, "target": None, "updatedAt": int(time.time() * 1000)}
    return {
        "active": bool((payload or {}).get("active", True)),
        "target": {"x": float(x), "y": float(y)},
        "updatedAt": int(time.time() * 1000),
    }


def set_realtime_control(room_code: str, seat_index: int, payload: dict[str, Any] | None) -> None:
    control = normalize_control_payload(payload)
    with _realtime_lock:
        room_controls = _realtime_controls.setdefault(room_code, {})
        room_controls[seat_index] = control


def pop_realtime_control(room_code: str, seat_index: int | None = None) -> None:
    with _realtime_lock:
        if seat_index is None:
            _realtime_controls.pop(room_code, None)
            return
        room_controls = _realtime_controls.get(room_code)
        if not room_controls:
            return
        room_controls.pop(seat_index, None)
        if not room_controls:
            _realtime_controls.pop(room_code, None)


def realtime_controls_snapshot(room_code: str, now_ms: int) -> dict[int, dict[str, Any]]:
    with _realtime_lock:
        room_controls = _realtime_controls.get(room_code, {})
        fresh: dict[int, dict[str, Any]] = {}
        stale: list[int] = []
        for seat_index, control in room_controls.items():
            updated_at = int(control.get("updatedAt") or 0)
            if now_ms - updated_at > REALTIME_CONTROL_STALE_MS:
                stale.append(seat_index)
                continue
            fresh[seat_index] = deepcopy(control)
        for seat_index in stale:
            room_controls.pop(seat_index, None)
        if not room_controls and room_code in _realtime_controls:
            _realtime_controls.pop(room_code, None)
        return fresh


def ensure_realtime_room_loop(room_code: str) -> None:
    app = current_app._get_current_object()
    with _realtime_lock:
        if room_code in _realtime_loops:
            return
        _realtime_loops.add(room_code)
    socketio.start_background_task(run_realtime_room_loop, app, room_code)


def run_realtime_room_loop(app, room_code: str) -> None:
    tick_dt = 1.0 / REALTIME_TICK_HZ
    try:
        while True:
            with app.app_context():
                store = room_store()
                room = store.get_room(room_code)
                if room is None or room.get("status") != "live" or state_play_mode(room.get("game_state")) != "realtime":
                    break
                if ((room.get("game_state", {}).get("race") or {}).get("phase")) == "finished":
                    break

                now_ms = int(time.time() * 1000)
                controls = realtime_controls_snapshot(room_code, now_ms)
                changed = simulate_realtime_tick(room["game_state"], controls, tick_dt, now_ms)
                if changed:
                    room["revision"] += 1
                    store.save_room(room)
                    socketio.emit(
                        "room:state_updated",
                        {"room": public_room_view(room, None)},
                        to=room["code"],
                    )
            socketio.sleep(tick_dt)
    finally:
        with _realtime_lock:
            _realtime_loops.discard(room_code)
        pop_realtime_control(room_code)


@socketio.on("room:join_socket")
def on_room_join_socket(payload):
    room_code = (payload or {}).get("room_code") or session.get("room_code")
    player_token = session.get("player_token")
    room = room_store().get_room(room_code)
    if room is None or player_token is None:
        emit("room:error", {"error": "Room session is not available."})
        return

    join_room(room["code"])
    emit("room:snapshot", {"room": public_room_view(room, player_token)})
    socketio.emit(
        "room:presence",
        {"room": public_room_view(room, None)},
        to=room["code"],
    )
    if room.get("status") == "live" and state_play_mode(room.get("game_state")) == "realtime":
        ensure_realtime_room_loop(room["code"])


@socketio.on("room:push_state")
def on_room_push_state(payload):
    room_code = (payload or {}).get("room_code") or session.get("room_code")
    player_token = session.get("player_token")
    room = room_store().get_room(room_code)
    if room is None or player_token is None:
        emit("room:error", {"error": "Room session is not available."})
        return

    try:
        game_state = validate_game_state(room, (payload or {}).get("state"))
        actor = room_actor(room, player_token)

        if room["status"] == "lobby":
            if room["host_token"] != player_token:
                raise RoomForbidden("Only the host can edit the course before the start.")
            room["game_state"] = game_state
        else:
            if actor is None:
                raise RoomForbidden("You are not part of this room.")
            if state_play_mode(room.get("game_state")) == "realtime":
                raise RoomForbidden("Realtime rooms use cursor controls instead of turn snapshots.")
            current_player = (room.get("game_state", {}).get("race") or {}).get("currentPlayer")
            if actor["seat_index"] != current_player:
                raise RoomForbidden("It is not your turn.")
            room["game_state"] = game_state

        room["revision"] += 1
        room_store().save_room(room)
    except RoomStoreError as exc:
        emit("room:error", {"error": str(exc)})
        return

    socketio.emit(
        "room:state_updated",
        {"room": public_room_view(room, None)},
        to=room["code"],
    )


@socketio.on("room:control")
def on_room_control(payload):
    room_code = (payload or {}).get("room_code") or session.get("room_code")
    player_token = session.get("player_token")
    room = room_store().get_room(room_code)
    if room is None or player_token is None:
        emit("room:error", {"error": "Room session is not available."})
        return

    actor = room_actor(room, player_token)
    if actor is None:
        emit("room:error", {"error": "You are not part of this room."})
        return
    if room.get("status") != "live" or state_play_mode(room.get("game_state")) != "realtime":
        return

    set_realtime_control(room["code"], actor["seat_index"], payload)
    ensure_realtime_room_loop(room["code"])


@socketio.on("disconnect")
def on_disconnect():
    room_code = session.get("room_code")
    player_token = session.get("player_token")
    if not room_code or not player_token:
        return
    room = room_store().get_room(room_code)
    if room is None:
        pop_realtime_control(room_code)
        return
    actor = room_actor(room, player_token)
    if actor is None:
        pop_realtime_control(room_code)
        return
    pop_realtime_control(room_code, actor["seat_index"])
