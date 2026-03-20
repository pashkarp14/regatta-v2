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

    provided_snapshot = None
    if game_state is not None:
        provided_snapshot = validate_game_state(room, deepcopy(game_state))
        room["start_state"] = deepcopy(provided_snapshot)

    start_snapshot = deepcopy(provided_snapshot or room.get("start_state") or room.get("game_state"))
    room["game_state"] = normalize_room_start_state(
        validate_game_state(room, start_snapshot),
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
        raise RoomValidationError("Only a finished live match can return to the lobby.")

    race = (room.get("game_state") or {}).get("race") or {}
    if race.get("phase") != "finished":
        raise RoomValidationError("Finish the current race before editing the course again.")

    start_snapshot = deepcopy(room.get("start_state") or room.get("game_state"))
    room["game_state"] = normalize_lobby_preview_state(validate_game_state(room, start_snapshot))
    room["status"] = "lobby"
    room["revision"] += 1
    room_store().save_room(room)
    return room, player_token
