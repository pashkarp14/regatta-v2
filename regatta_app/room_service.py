from __future__ import annotations

from copy import deepcopy
import logging
from typing import Any

from flask import current_app

from .app_state import live_runtime, room_store, socketio_ext
from .game_state import normalize_lobby_preview_state, normalize_room_start_state, room_requires_live_loop
from .observability import log_event
from .room_events import broadcast_room_snapshot
from .room_store import (
    RoomStoreError,
    RoomForbidden,
    RoomNotFound,
    RoomValidationError,
    normalize_host_role,
    normalize_name,
    normalize_room_code,
    now_ms,
    player_for_id,
    player_for_token,
    public_room_view,
    room_can_start,
    validate_game_state,
)
from .sockets import ensure_realtime_room_loop
from .session_state import (
    bind_room_session,
    clear_room_session,
    current_session_state,
    display_name as session_display_name,
)


def current_room() -> dict[str, Any] | None:
    session_state = current_session_state()
    if not session_state.room_code or not session_state.player_token:
        return None

    room = room_store().get_room(session_state.room_code)
    if room is None or player_for_token(room, session_state.player_token) is None:
        clear_room_session()
        return None
    return room


def leave_current_room() -> tuple[str | None, dict[str, Any] | None]:
    session_state = current_session_state()
    room_code = session_state.room_code
    updated_room = None
    if session_state.room_code and session_state.player_token:
        live_runtime().flush_now(session_state.room_code, now_ms())
        log_event(
            current_app.logger,
            "room.leave.begin",
            room_code=session_state.room_code,
            player_token_present=bool(session_state.player_token),
        )
        updated_room = room_store().remove_player(session_state.room_code, session_state.player_token)
    clear_room_session()
    log_event(
        current_app.logger,
        "room.leave.success",
        room_code=room_code or "-",
        room_present=updated_room is not None,
    )
    return room_code, updated_room


def _boat_count(snapshot: Any) -> int | None:
    if not isinstance(snapshot, dict):
        return None
    boats = snapshot.get("boats")
    return len(boats) if isinstance(boats, list) else None


def _cleanup_previous_room_async(room_code: str | None, player_token: str | None) -> None:
    if not room_code or not player_token:
        return

    app = current_app._get_current_object()
    log_event(
        current_app.logger,
        "room.create.cleanup_previous_room.scheduled",
        previous_room_code=room_code,
    )

    def task() -> None:
        with app.app_context():
            try:
                live_runtime().flush_now(room_code, now_ms())
                log_event(
                    app.logger,
                    "room.create.cleanup_previous_room.begin",
                    previous_room_code=room_code,
                )
                updated_room = room_store().remove_player(room_code, player_token)
                log_event(
                    app.logger,
                    "room.create.cleanup_previous_room.done",
                    previous_room_code=room_code,
                    previous_room_still_exists=updated_room is not None,
                )
                if updated_room is not None:
                    if room_requires_live_loop(updated_room):
                        live_runtime().replace_room(updated_room, now_ms())
                        ensure_realtime_room_loop(updated_room["code"])
                    else:
                        live_runtime().drop_room(room_code)
                    broadcast_room_snapshot(updated_room)
                else:
                    live_runtime().drop_room(room_code)
            except RoomStoreError as exc:
                log_event(
                    app.logger,
                    "room.create.cleanup_previous_room.rejected",
                    level=logging.WARNING,
                    previous_room_code=room_code,
                    error=str(exc),
                )
            except Exception:
                log_event(
                    app.logger,
                    "room.create.cleanup_previous_room.crashed",
                    level=logging.ERROR,
                    previous_room_code=room_code,
                )
                app.logger.exception("room.create.cleanup_previous_room.crashed previous_room_code=%s", room_code)

    socketio_ext().start_background_task(task)


def create_room_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    session_state = current_session_state()
    game_state = payload.get("game_state")
    max_players = int(payload.get("max_players", 0))
    host_role = normalize_host_role(payload.get("host_role"))
    player_name = normalize_name(payload.get("display_name") or session_display_name())

    log_event(
        current_app.logger,
        "room.create.begin",
        session_room_code=session_state.room_code or "-",
        session_has_player=bool(session_state.player_token),
        display_name=player_name,
        host_role=host_role,
        requested_max_players=max_players,
        game_state_boats=_boat_count(game_state),
    )

    if session_state.room_code or session_state.player_token:
        log_event(
            current_app.logger,
            "room.create.session_reset",
            previous_room_code=session_state.room_code or "-",
            session_had_player=bool(session_state.player_token),
        )
        clear_room_session()
        _cleanup_previous_room_async(session_state.room_code, session_state.player_token)

    try:
        room, player_token = room_store().create_room(
            player_name,
            max_players,
            game_state,
            host_role=host_role,
        )
    except RoomStoreError as exc:
        log_event(
            current_app.logger,
            "room.create.rejected",
            level=logging.WARNING,
            display_name=player_name,
            host_role=host_role,
            requested_max_players=max_players,
            game_state_boats=_boat_count(game_state),
            error=str(exc),
        )
        raise
    except Exception:
        log_event(
            current_app.logger,
            "room.create.crashed",
            level=logging.ERROR,
            display_name=player_name,
            host_role=host_role,
            requested_max_players=max_players,
            game_state_boats=_boat_count(game_state),
        )
        current_app.logger.exception(
            "room.create.crashed display_name=%r host_role=%s requested_max_players=%s game_state_boats=%s",
            player_name,
            host_role,
            max_players,
            _boat_count(game_state),
        )
        raise

    bind_room_session(room["code"], player_token, player_name)
    log_event(
        current_app.logger,
        "room.create.success",
        room_code=room.get("code"),
        host_role=host_role,
        joined_players=len(room.get("players", [])),
        joined_racers=len(room.get("racer_player_ids", [])),
        room_boats=_boat_count(room.get("game_state")),
    )
    return public_room_view(room, player_token)


def join_room_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    session_state = current_session_state()
    room_code = normalize_room_code(payload.get("room_code"))
    player_name = normalize_name(payload.get("display_name") or session_display_name())
    log_event(
        current_app.logger,
        "room.join.begin",
        room_code=room_code or "-",
        display_name=player_name,
        session_room_code=session_state.room_code or "-",
        session_has_player=bool(session_state.player_token),
    )

    if session_state.room_code and session_state.room_code != room_code:
        leave_current_room()
        session_state = current_session_state()

    room, player_token = room_store().join_room(
        room_code,
        player_name,
        session_state.player_token,
    )
    bind_room_session(room["code"], player_token, player_name)
    log_event(
        current_app.logger,
        "room.join.success",
        room_code=room.get("code"),
        joined_players=len(room.get("players", [])),
        joined_racers=len(room.get("racer_player_ids", [])),
    )
    return public_room_view(room, player_token)


def room_view(room_code: str) -> dict[str, Any]:
    room = room_store().get_room(room_code)
    if room is None:
        raise RoomNotFound("Room not found.")
    return public_room_view(room, current_session_state().player_token)


def _validated_room_snapshot(room: dict[str, Any], snapshot: dict[str, Any] | None) -> dict[str, Any]:
    if snapshot is None:
        raise RoomValidationError("Room state is not available.")
    return validate_game_state(room, deepcopy(snapshot))


def _ensure_initial_lobby_state(room: dict[str, Any]) -> None:
    if isinstance(room.get("initial_lobby_state"), dict):
        return
    fallback = room.get("start_state") or room.get("game_state")
    if isinstance(fallback, dict):
        room["initial_lobby_state"] = _validated_room_snapshot(room, fallback)


def start_room_match(
    room_code: str,
    *,
    arm_realtime: bool = True,
    game_state: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], str | None]:
    player_token = current_session_state().player_token
    log_event(
        current_app.logger,
        "room.start.begin",
        room_code=room_code,
        arm_realtime=arm_realtime,
        game_state_boats=_boat_count(game_state),
        player_token_present=bool(player_token),
    )
    room = room_store().get_room(room_code)
    if room is None:
        raise RoomNotFound("Room not found.")
    if room["host_token"] != player_token:
        raise RoomForbidden("Only the room host can start the match.")
    if not room_can_start(room):
        raise RoomValidationError("Add at least one racing skipper before starting the room.")

    _ensure_initial_lobby_state(room)
    provided_snapshot = None
    if game_state is not None:
        provided_snapshot = _validated_room_snapshot(room, game_state)
        room["start_state"] = deepcopy(provided_snapshot)

    start_snapshot = deepcopy(provided_snapshot or room.get("start_state") or room.get("game_state"))
    room["game_state"] = normalize_room_start_state(
        _validated_room_snapshot(room, start_snapshot),
        arm_realtime=arm_realtime,
    )
    room["status"] = "live"
    room["revision"] += 1
    room = room_store().save_room(room)
    log_event(
        current_app.logger,
        "room.start.success",
        room_code=room.get("code"),
        revision=room.get("revision"),
        joined_racers=len(room.get("racer_player_ids", [])),
    )
    return room, player_token


def kick_room_player(room_code: str, player_id: str | None) -> tuple[dict[str, Any], str | None, str | None, list[str], list[str]]:
    actor_token = current_session_state().player_token
    log_event(
        current_app.logger,
        "room.kick.begin",
        room_code=room_code,
        player_id=player_id or "-",
        actor_token_present=bool(actor_token),
    )
    live_runtime().flush_now(room_code, now_ms())
    room = room_store().get_room(room_code)
    if room is None:
        raise RoomNotFound("Room not found.")

    target_player = player_for_id(room, player_id)
    if target_player is None:
        raise RoomNotFound("Player not found.")

    old_racer_ids = [player["player_id"] for player in room.get("players", []) if not player.get("is_observer")]
    kicked_token = target_player.get("token")
    updated_room = room_store().kick_player(room_code, actor_token, player_id)
    new_racer_ids = [player["player_id"] for player in updated_room.get("players", []) if not player.get("is_observer")]
    log_event(
        current_app.logger,
        "room.kick.success",
        room_code=updated_room.get("code"),
        kicked_token_present=bool(kicked_token),
        old_racers=len(old_racer_ids),
        new_racers=len(new_racer_ids),
    )
    return updated_room, actor_token, kicked_token, old_racer_ids, new_racer_ids


def edit_room_match(room_code: str) -> tuple[dict[str, Any], str | None]:
    player_token = current_session_state().player_token
    live_runtime().flush_now(room_code, now_ms())
    room = room_store().get_room(room_code)
    if room is None:
        raise RoomNotFound("Room not found.")
    if room["host_token"] != player_token:
        raise RoomForbidden("Only the room host can reopen the lobby.")
    if room.get("status") != "live":
        raise RoomValidationError("Only a live match can return to the lobby.")

    _ensure_initial_lobby_state(room)
    start_snapshot = _validated_room_snapshot(room, room.get("start_state") or room.get("game_state"))
    room["start_state"] = deepcopy(start_snapshot)
    room["game_state"] = normalize_lobby_preview_state(start_snapshot)
    room["status"] = "lobby"
    room["revision"] += 1
    room = room_store().save_room(room)
    return room, player_token


def reset_room_lobby(room_code: str) -> tuple[dict[str, Any], str | None]:
    player_token = current_session_state().player_token
    live_runtime().flush_now(room_code, now_ms())
    room = room_store().get_room(room_code)
    if room is None:
        raise RoomNotFound("Room not found.")
    if room["host_token"] != player_token:
        raise RoomForbidden("Only the room host can restore the original lobby.")
    if room.get("status") not in {"lobby", "live"}:
        raise RoomValidationError("Only an active room can restore the original lobby.")

    _ensure_initial_lobby_state(room)
    baseline_snapshot = _validated_room_snapshot(
        room,
        room.get("initial_lobby_state") or room.get("start_state") or room.get("game_state"),
    )
    room["start_state"] = deepcopy(baseline_snapshot)
    room["game_state"] = normalize_lobby_preview_state(baseline_snapshot)
    room["status"] = "lobby"
    room["revision"] += 1
    room = room_store().save_room(room)
    return room, player_token
