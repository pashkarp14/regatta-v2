from __future__ import annotations

import logging
import threading
import time
from copy import deepcopy
from typing import Any

from flask import current_app, request
from flask_socketio import emit, join_room

from .app_state import room_store
from .extensions import socketio
from .game_state import (
    apply_realtime_pause,
    apply_room_view_settings,
    normalize_view_settings_payload,
    room_requires_live_loop,
    state_play_mode,
)
from .observability import (
    correlation_scope,
    log_event,
    observe_error,
    observe_realtime_tick,
    observe_socket_event,
    payload_bytes,
    set_connected_clients,
    set_realtime_loops_active,
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
_socket_memberships: dict[str, tuple[str, str]] = {}
_player_socket_ids: dict[str, set[str]] = {}


def _socket_event_room_code(payload: dict[str, Any] | None) -> str | None:
    raw_code = (payload or {}).get("room_code")
    return str(raw_code).strip().upper() if raw_code else current_session_state().room_code


def _log_socket_event_received(event_name: str, payload: dict[str, Any] | None, room_code: str | None) -> int:
    inbound_bytes = payload_bytes(payload)
    log_event(
        current_app.logger,
        "socket.event.received",
        socket_event=event_name,
        room_code=room_code or "-",
        payload_bytes=inbound_bytes,
        sid=request.sid,
    )
    return inbound_bytes


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


def remap_realtime_controls(room_code: str, old_racer_ids: list[str], new_racer_ids: list[str]) -> None:
    with _realtime_lock:
        room_controls = _realtime_controls.get(room_code)
        if not room_controls:
            return

        remapped: dict[int, dict[str, Any]] = {}
        for old_index, player_id in enumerate(old_racer_ids):
            control = room_controls.get(old_index)
            if control is None or player_id not in new_racer_ids:
                continue
            remapped[new_racer_ids.index(player_id)] = control

        if remapped:
            _realtime_controls[room_code] = remapped
        else:
            _realtime_controls.pop(room_code, None)


def realtime_controls_snapshot(room_code: str) -> dict[int, dict[str, Any]]:
    with _realtime_lock:
        room_controls = _realtime_controls.get(room_code, {})
        return {seat_index: deepcopy(control) for seat_index, control in room_controls.items()}


def any_active_control(controls: dict[int, dict[str, Any]]) -> bool:
    return any(control.get("active") for control in controls.values())


def room_has_connected_socket(room_code: str) -> bool:
    with _realtime_lock:
        return any(saved_room_code == room_code for saved_room_code, _ in _socket_memberships.values())


def register_player_socket(sid: str, room_code: str, player_token: str) -> None:
    with _realtime_lock:
        previous = _socket_memberships.pop(sid, None)
        if previous is not None:
            previous_room_code, previous_player_token = previous
            previous_sids = _player_socket_ids.get(previous_player_token)
            if previous_sids:
                previous_sids.discard(sid)
                if not previous_sids:
                    _player_socket_ids.pop(previous_player_token, None)
        _socket_memberships[sid] = (room_code, player_token)
        _player_socket_ids.setdefault(player_token, set()).add(sid)
        set_connected_clients(len(_socket_memberships))


def unregister_player_socket(sid: str) -> tuple[str | None, str | None]:
    with _realtime_lock:
        membership = _socket_memberships.pop(sid, None)
        if membership is None:
            return None, None

        room_code, player_token = membership
        known_sids = _player_socket_ids.get(player_token)
        if known_sids:
            known_sids.discard(sid)
            if not known_sids:
                _player_socket_ids.pop(player_token, None)
        set_connected_clients(len(_socket_memberships))
        return room_code, player_token


def emit_room_kicked(room_code: str, player_token: str | None) -> None:
    if not room_code or not player_token:
        return

    with _realtime_lock:
        target_sids = list(_player_socket_ids.get(player_token, set()))

    for sid in target_sids:
        socketio.emit("room:kicked", {"room_code": room_code}, to=sid)
        try:
            socketio.server.leave_room(sid, room_code, namespace="/")
        except Exception:
            pass
        unregister_player_socket(sid)


def ensure_realtime_room_loop(room_code: str) -> None:
    app = current_app._get_current_object()
    with _realtime_lock:
        if room_code in _realtime_loops:
            return
        _realtime_loops.add(room_code)
        set_realtime_loops_active(len(_realtime_loops))
    socketio.start_background_task(run_realtime_room_loop, app, room_code)


def run_realtime_room_loop(app, room_code: str) -> None:
    tick_dt = 1.0 / REALTIME_TICK_HZ
    try:
        while True:
            with app.app_context():
                tick_started_at = time.perf_counter()
                room = room_store().get_room(room_code)
                if room is None:
                    break

                if room.get("status") == "live" and not room_has_connected_socket(room_code):
                    break

                now_ms = int(time.time() * 1000)
                controls = realtime_controls_snapshot(room_code)
                changed = False
                simulate_started_at = time.perf_counter()

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
                        race = (room.get("game_state") or {}).get("race") or {}
                        if bool(race.get("realtimePaused")):
                            changed = False
                        else:
                            changed = simulate_realtime_tick(room["game_state"], controls, tick_dt, now_ms)
                    else:
                        changed = simulate_weather_tick(room["game_state"], now_ms)
                simulate_duration_ms = round((time.perf_counter() - simulate_started_at) * 1000.0, 4)
                save_duration_ms = 0.0
                broadcast_duration_ms = 0.0
                if changed:
                    room["revision"] += 1
                    save_started_at = time.perf_counter()
                    room_store().save_room(room)
                    save_duration_ms = round((time.perf_counter() - save_started_at) * 1000.0, 4)
                    broadcast_started_at = time.perf_counter()
                    broadcast_room_state(room)
                    broadcast_duration_ms = round((time.perf_counter() - broadcast_started_at) * 1000.0, 4)
                observe_realtime_tick(
                    tick_budget_seconds=tick_dt,
                    started_at=tick_started_at,
                    changed=changed,
                    room_code=room_code,
                    revision=room.get("revision"),
                )
                if current_app.logger.isEnabledFor(logging.DEBUG):
                    log_event(
                        current_app.logger,
                        "realtime.loop.tick.parts",
                        level=logging.DEBUG,
                        room_code=room_code,
                        revision=room.get("revision"),
                        simulate_ms=simulate_duration_ms,
                        save_ms=save_duration_ms,
                        broadcast_ms=broadcast_duration_ms,
                    )
            socketio.sleep(tick_dt)
    finally:
        with _realtime_lock:
            _realtime_loops.discard(room_code)
            set_realtime_loops_active(len(_realtime_loops))
        pop_realtime_control(room_code)


def emit_room_error(message: str) -> None:
    observe_error("socket", "room_error")
    log_event(current_app.logger, "socket.room_error", level=logging.WARNING, message_text=message, sid=request.sid)
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
    def on_room_join_socket(payload: dict[str, Any] | None):
        with correlation_scope("sock"):
            started_at = time.perf_counter()
            room_code = _socket_event_room_code(payload)
            inbound_bytes = _log_socket_event_received("room:join_socket", payload, room_code)
            result = "ok"
            error_kind: str | None = None
            player_token_present = False
            revision: int | None = None
            try:
                room, player_token = load_socket_room(payload)
                player_token_present = player_token is not None
                if room is None or player_token is None:
                    result = "rejected"
                    error_kind = "RoomSessionUnavailable"
                    return

                room_code = room["code"]
                revision = room.get("revision")
                join_room(room["code"])
                register_player_socket(request.sid, room["code"], player_token)
                emit("room:snapshot", serialize_room(room, player_token))
                if room_requires_live_loop(room):
                    ensure_realtime_room_loop(room["code"])
                broadcast_room_presence(room)
            except RoomStoreError as exc:
                result = "rejected"
                error_kind = type(exc).__name__
                observe_error("socket", error_kind)
                emit_room_error(str(exc))
            except Exception as exc:
                result = "error"
                error_kind = type(exc).__name__
                observe_error("socket", error_kind)
                raise
            finally:
                observe_socket_event(
                    "room:join_socket",
                    started_at=started_at,
                    result=result,
                    payload_size=inbound_bytes,
                    room_code=room_code,
                    player_token_present=player_token_present,
                    error_kind=error_kind,
                    revision=revision,
                )

    def on_room_push_state(payload: dict[str, Any] | None):
        with correlation_scope("sock"):
            started_at = time.perf_counter()
            room_code = _socket_event_room_code(payload)
            inbound_bytes = _log_socket_event_received("room:push_state", payload, room_code)
            result = "ok"
            error_kind: str | None = None
            player_token_present = False
            revision: int | None = None
            try:
                room, player_token = load_socket_room(payload)
                player_token_present = player_token is not None
                if room is None or player_token is None:
                    result = "rejected"
                    error_kind = "RoomSessionUnavailable"
                    return

                room_code = room["code"]
                game_state = validate_game_state(room, (payload or {}).get("state"))
                actor = player_for_token(room, player_token)
                if actor is None:
                    raise RoomForbidden("You are not part of this room.")

                if room["status"] == "lobby":
                    if room["host_token"] != player_token:
                        raise RoomForbidden("Only the host can edit the course before the start.")
                    room["start_state"] = deepcopy(game_state)
                    room["game_state"] = normalize_lobby_preview_state(game_state)
                else:
                    raise RoomForbidden("Live rooms use cursor controls instead of snapshot pushes.")

                room["revision"] += 1
                revision = room["revision"]
                room_store().save_room(room)
                if room_requires_live_loop(room):
                    ensure_realtime_room_loop(room["code"])
                broadcast_room_state(room)
            except RoomStoreError as exc:
                result = "rejected"
                error_kind = type(exc).__name__
                observe_error("socket", error_kind)
                emit_room_error(str(exc))
            except Exception as exc:
                result = "error"
                error_kind = type(exc).__name__
                observe_error("socket", error_kind)
                raise
            finally:
                observe_socket_event(
                    "room:push_state",
                    started_at=started_at,
                    result=result,
                    payload_size=inbound_bytes,
                    room_code=room_code,
                    player_token_present=player_token_present,
                    error_kind=error_kind,
                    revision=revision,
                )

    def on_room_control(payload: dict[str, Any] | None):
        with correlation_scope("sock"):
            started_at = time.perf_counter()
            room_code = _socket_event_room_code(payload)
            inbound_bytes = _log_socket_event_received("room:control", payload, room_code)
            result = "ok"
            error_kind: str | None = None
            player_token_present = False
            revision: int | None = None
            try:
                room, player_token = load_socket_room(payload)
                player_token_present = player_token is not None
                if room is None or player_token is None:
                    result = "rejected"
                    error_kind = "RoomSessionUnavailable"
                    return

                room_code = room["code"]
                revision = room.get("revision")
                actor = player_for_token(room, player_token)
                if actor is None:
                    result = "rejected"
                    error_kind = "RoomActorMissing"
                    emit_room_error("You are not part of this room.")
                    return
                if player_is_observer(actor) or not isinstance(actor.get("seat_index"), int):
                    result = "ignored"
                    error_kind = "ObserverControlIgnored"
                    return
                if room.get("status") == "lobby":
                    set_realtime_control(room["code"], actor["seat_index"], payload)
                    ensure_realtime_room_loop(room["code"])
                    return
                if room.get("status") != "live":
                    result = "ignored"
                    error_kind = "RoomNotLive"
                    return

                set_realtime_control(room["code"], actor["seat_index"], payload)
                ensure_realtime_room_loop(room["code"])
            except RoomStoreError as exc:
                result = "rejected"
                error_kind = type(exc).__name__
                observe_error("socket", error_kind)
                emit_room_error(str(exc))
            except Exception as exc:
                result = "error"
                error_kind = type(exc).__name__
                observe_error("socket", error_kind)
                raise
            finally:
                observe_socket_event(
                    "room:control",
                    started_at=started_at,
                    result=result,
                    payload_size=inbound_bytes,
                    room_code=room_code,
                    player_token_present=player_token_present,
                    error_kind=error_kind,
                    revision=revision,
                )

    def on_room_view_settings(payload: dict[str, Any] | None):
        with correlation_scope("sock"):
            started_at = time.perf_counter()
            room_code = _socket_event_room_code(payload)
            inbound_bytes = _log_socket_event_received("room:view_settings", payload, room_code)
            result = "ok"
            error_kind: str | None = None
            player_token_present = False
            revision: int | None = None
            try:
                room, player_token = load_socket_room(payload)
                player_token_present = player_token is not None
                if room is None or player_token is None:
                    result = "rejected"
                    error_kind = "RoomSessionUnavailable"
                    return

                room_code = room["code"]
                if room.get("host_token") != player_token:
                    raise RoomForbidden("Only the host can change shared room hints.")
                view_settings = normalize_view_settings_payload(payload)
                if not view_settings:
                    result = "ignored"
                    error_kind = "EmptyViewSettings"
                    return
                if not apply_room_view_settings(room, view_settings):
                    result = "ignored"
                    error_kind = "UnchangedViewSettings"
                    return
                room["revision"] += 1
                revision = room["revision"]
                room_store().save_room(room)
                broadcast_room_state(room)
            except RoomStoreError as exc:
                result = "rejected"
                error_kind = type(exc).__name__
                observe_error("socket", error_kind)
                emit_room_error(str(exc))
            except Exception as exc:
                result = "error"
                error_kind = type(exc).__name__
                observe_error("socket", error_kind)
                raise
            finally:
                observe_socket_event(
                    "room:view_settings",
                    started_at=started_at,
                    result=result,
                    payload_size=inbound_bytes,
                    room_code=room_code,
                    player_token_present=player_token_present,
                    error_kind=error_kind,
                    revision=revision,
                )

    def on_room_pause(payload: dict[str, Any] | None):
        with correlation_scope("sock"):
            started_at = time.perf_counter()
            room_code = _socket_event_room_code(payload)
            inbound_bytes = _log_socket_event_received("room:pause", payload, room_code)
            result = "ok"
            error_kind: str | None = None
            player_token_present = False
            revision: int | None = None
            try:
                room, player_token = load_socket_room(payload)
                player_token_present = player_token is not None
                if room is None or player_token is None:
                    result = "rejected"
                    error_kind = "RoomSessionUnavailable"
                    return

                room_code = room["code"]
                if room.get("host_token") != player_token:
                    raise RoomForbidden("Only the host can pause or resume the room.")
                if room.get("status") != "live":
                    raise RoomForbidden("Pause is only available during a live realtime race.")

                should_pause = bool((payload or {}).get("paused"))
                if not apply_realtime_pause(room["game_state"], paused=should_pause, now_ms=int(time.time() * 1000)):
                    result = "ignored"
                    error_kind = "PauseStateUnchanged"
                    return
                room["revision"] += 1
                revision = room["revision"]
                room_store().save_room(room)
                ensure_realtime_room_loop(room["code"])
                broadcast_room_state(room)
            except RoomStoreError as exc:
                result = "rejected"
                error_kind = type(exc).__name__
                observe_error("socket", error_kind)
                emit_room_error(str(exc))
            except Exception as exc:
                result = "error"
                error_kind = type(exc).__name__
                observe_error("socket", error_kind)
                raise
            finally:
                observe_socket_event(
                    "room:pause",
                    started_at=started_at,
                    result=result,
                    payload_size=inbound_bytes,
                    room_code=room_code,
                    player_token_present=player_token_present,
                    error_kind=error_kind,
                    revision=revision,
                )

    def on_disconnect():
        with correlation_scope("sock"):
            started_at = time.perf_counter()
            inbound_bytes = _log_socket_event_received("disconnect", None, None)
            room_code, player_token = unregister_player_socket(request.sid)
            if not room_code or not player_token:
                session_state = current_session_state()
                room_code = session_state.room_code
                player_token = session_state.player_token
            if room_code and player_token:
                room = room_store().get_room(room_code)
                if room is None:
                    pop_realtime_control(room_code)
                else:
                    actor = player_for_token(room, player_token)
                    if actor is None:
                        pop_realtime_control(room_code)
                    elif isinstance(actor.get("seat_index"), int):
                        pop_realtime_control(room_code, actor["seat_index"])
            observe_socket_event(
                "disconnect",
                started_at=started_at,
                result="ok",
                payload_size=inbound_bytes,
                room_code=room_code,
                player_token_present=bool(player_token),
            )

    socketio.on_event("room:join_socket", on_room_join_socket)
    socketio.on_event("room:push_state", on_room_push_state)
    socketio.on_event("room:control", on_room_control)
    socketio.on_event("room:view_settings", on_room_view_settings)
    socketio.on_event("room:pause", on_room_pause)
    socketio.on_event("disconnect", on_disconnect)
