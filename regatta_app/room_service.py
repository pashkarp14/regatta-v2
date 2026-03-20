from __future__ import annotations

from copy import deepcopy
from typing import Any

from .app_state import room_store
from .game_state import normalize_lobby_preview_state, normalize_room_start_state
from .room_store import (
    RoomForbidden,
    RoomNotFound,
    RoomValidationError,
    normalize_host_role,
    normalize_name,
    normalize_room_code,
    player_for_token,
    public_room_view,
    room_start_ready,
    validate_game_state,
)
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


def leave_current_room() -> None:
    session_state = current_session_state()
    if session_state.room_code and session_state.player_token:
        room_store().remove_player(session_state.room_code, session_state.player_token)
    clear_room_session()


def create_room_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    game_state = payload.get("game_state")
    max_players = int(payload.get("max_players", 0))
    host_role = normalize_host_role(payload.get("host_role"))
    player_name = normalize_name(payload.get("display_name") or session_display_name())

    leave_current_room()
    room, player_token = room_store().create_room(
        player_name,
        max_players,
        game_state,
        host_role=host_role,
    )
    bind_room_session(room["code"], player_token, player_name)
    return public_room_view(room, player_token)


def join_room_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    session_state = current_session_state()
    room_code = normalize_room_code(payload.get("room_code"))
    player_name = normalize_name(payload.get("display_name") or session_display_name())

    if session_state.room_code and session_state.room_code != room_code:
        leave_current_room()
        session_state = current_session_state()

    room, player_token = room_store().join_room(
        room_code,
        player_name,
        session_state.player_token,
    )
    bind_room_session(room["code"], player_token, player_name)
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
    room = room_store().get_room(room_code)
    if room is None:
        raise RoomNotFound("Room not found.")
    if room["host_token"] != player_token:
        raise RoomForbidden("Only the room host can start the match.")
    if not room_start_ready(room):
        raise RoomValidationError("Wait until every racing seat is occupied.")

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
    room_store().save_room(room)
    return room, player_token


def edit_room_match(room_code: str) -> tuple[dict[str, Any], str | None]:
    player_token = current_session_state().player_token
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
    room_store().save_room(room)
    return room, player_token


def reset_room_lobby(room_code: str) -> tuple[dict[str, Any], str | None]:
    player_token = current_session_state().player_token
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
    room_store().save_room(room)
    return room, player_token
