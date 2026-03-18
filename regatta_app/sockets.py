from __future__ import annotations

import threading
import time
from copy import deepcopy
from typing import Any

from flask import current_app
from flask_socketio import emit, join_room

from .app_state import room_store
from .extensions import socketio
from .game_state import (
    apply_room_view_settings,
    normalize_view_settings_payload,
    room_requires_live_loop,
    state_play_mode,
)
from .realtime_engine import simulate_realtime_tick, simulate_weather_tick
from .room_events import broadcast_room_presence, broadcast_room_state, serialize_room
from .room_store import (
    RoomForbidden,
    RoomStoreError,
    normalize_lobby_preview_state,
    player_for_token,
    player_is_observer,
    validate_game_state,
)
from .session_state import current_session_state


REALTIME_TICK_HZ = 12
_realtime_lock = threading.Lock()
_realtime_loops: set[str] = set()
_realtime_controls: dict[str, dict[int, dict[str, Any]]] = {}
_handlers_registered = False


def normalize_control_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    updated_at = int(time.time() * 1000)
    normalized = {
        "active": False,
        "target": None,
        "direction": None,
        "updatedAt": updated_at,
    }

    direction = (payload or {}).get("direction")
    if isinstance(direction, dict):
        dx = direction.get("x")
        dy = direction.get("y")
        if isinstance(dx, (int, float)) and isinstance(dy, (int, float)):
            normalized["direction"] = {"x": float(dx), "y": float(dy)}

    target = (payload or {}).get("target")
    if isinstance(target, dict):
        x = target.get("x")
        y = target.get("y")
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            normalized["target"] = {"x": float(x), "y": float(y)}

    normalized["active"] = bool((payload or {}).get("active", True)) and (
        normalized["direction"] is not None or normalized["target"] is not None
    )
    return normalized


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


def realtime_controls_snapshot(room_code: str) -> dict[int, dict[str, Any]]:
    with _realtime_lock:
        room_controls = _realtime_controls.get(room_code, {})
        return {seat_index: deepcopy(control) for seat_index, control in room_controls.items()}


def any_active_control(controls: dict[int, dict[str, Any]]) -> bool:
    return any(control.get("active") for control in controls.values())


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
                room = room_store().get_room(room_code)
                if room is None:
                    break

                now_ms = int(time.time() * 1000)
                controls = realtime_controls_snapshot(room_code)
                changed = False

                if room.get("status") == "lobby":
                    if not any_active_control(controls):
                        break
                    changed = simulate_realtime_tick(room["game_state"], controls, tick_dt, now_ms)
                else:
                    if not room_requires_live_loop(room):
                        break
                    if ((room.get("game_state", {}).get("race") or {}).get("phase")) == "finished":
                        break
                    if state_play_mode(room.get("game_state")) == "realtime":
                        changed = simulate_realtime_tick(room["game_state"], controls, tick_dt, now_ms)
                    else:
                        changed = simulate_weather_tick(room["game_state"], now_ms)
                if changed:
                    room["revision"] += 1
                    room_store().save_room(room)
                    broadcast_room_state(room)
            socketio.sleep(tick_dt)
    finally:
        with _realtime_lock:
            _realtime_loops.discard(room_code)
        pop_realtime_control(room_code)


def emit_room_error(message: str) -> None:
    emit("room:error", {"error": message})


def load_socket_room(payload: dict[str, Any] | None) -> tuple[dict[str, Any] | None, str | None]:
    session_state = current_session_state()
    room_code = (payload or {}).get("room_code") or session_state.room_code
    room = room_store().get_room(room_code)
    if room is None or session_state.player_token is None:
        emit_room_error("Room session is not available.")
        return None, None
    return room, session_state.player_token


def register_socket_handlers() -> None:
    global _handlers_registered

    if _handlers_registered:
        return
    _handlers_registered = True

    @socketio.on("room:join_socket")
    def on_room_join_socket(payload: dict[str, Any] | None):
        room, player_token = load_socket_room(payload)
        if room is None or player_token is None:
            return

        join_room(room["code"])
        emit("room:snapshot", serialize_room(room, player_token))
        broadcast_room_presence(room)
        if room_requires_live_loop(room):
            ensure_realtime_room_loop(room["code"])

    @socketio.on("room:push_state")
    def on_room_push_state(payload: dict[str, Any] | None):
        room, player_token = load_socket_room(payload)
        if room is None or player_token is None:
            return

        try:
            game_state = validate_game_state(room, (payload or {}).get("state"))
            actor = player_for_token(room, player_token)

            if room["status"] == "lobby":
                if room["host_token"] != player_token:
                    raise RoomForbidden("Only the host can edit the course before the start.")
                room["start_state"] = deepcopy(game_state)
                room["game_state"] = normalize_lobby_preview_state(game_state)
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
            emit_room_error(str(exc))
            return

        if room_requires_live_loop(room):
            ensure_realtime_room_loop(room["code"])
        broadcast_room_state(room)

    @socketio.on("room:control")
    def on_room_control(payload: dict[str, Any] | None):
        room, player_token = load_socket_room(payload)
        if room is None or player_token is None:
            return

        actor = player_for_token(room, player_token)
        if actor is None:
            emit_room_error("You are not part of this room.")
            return
        if player_is_observer(actor) or not isinstance(actor.get("seat_index"), int):
            return
        if room.get("status") == "lobby":
            set_realtime_control(room["code"], actor["seat_index"], payload)
            ensure_realtime_room_loop(room["code"])
            return
        if room.get("status") != "live" or state_play_mode(room.get("game_state")) != "realtime":
            return

        set_realtime_control(room["code"], actor["seat_index"], payload)
        ensure_realtime_room_loop(room["code"])

    @socketio.on("room:view_settings")
    def on_room_view_settings(payload: dict[str, Any] | None):
        room, player_token = load_socket_room(payload)
        if room is None or player_token is None:
            return

        try:
            if room.get("host_token") != player_token:
                raise RoomForbidden("Only the host can change shared room hints.")
            view_settings = normalize_view_settings_payload(payload)
            if not view_settings:
                return
            if not apply_room_view_settings(room, view_settings):
                return
            room["revision"] += 1
            room_store().save_room(room)
        except RoomStoreError as exc:
            emit_room_error(str(exc))
            return

        broadcast_room_state(room)

    @socketio.on("disconnect")
    def on_disconnect():
        session_state = current_session_state()
        if not session_state.room_code or not session_state.player_token:
            return

        room = room_store().get_room(session_state.room_code)
        if room is None:
            pop_realtime_control(session_state.room_code)
            return

        actor = player_for_token(room, session_state.player_token)
        if actor is None:
            pop_realtime_control(session_state.room_code)
            return
        if isinstance(actor.get("seat_index"), int):
            pop_realtime_control(session_state.room_code, actor["seat_index"])
