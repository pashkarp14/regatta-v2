from __future__ import annotations

from copy import deepcopy

from flask import current_app, session
from flask_socketio import emit, join_room

from .extensions import socketio
from .room_store import RoomForbidden, RoomStoreError, public_room_view, validate_game_state


def room_store():
    return current_app.extensions["room_store"]


def room_actor(room: dict, player_token: str | None):
    return next((player for player in room.get("players", []) if player.get("token") == player_token), None)


def clamp_int(value, fallback: int, min_value: int, max_value: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(min_value, min(max_value, parsed))


def state_play_mode(game_state: dict | None) -> str:
    if not isinstance(game_state, dict):
        return "turns"
    settings = game_state.get("settings") or {}
    race = game_state.get("race") or {}
    if settings.get("playMode") == "hybrid" and race.get("phase") == "race":
        return "hybrid"
    return "turns"


def normalize_hybrid_moves(boats: list[dict], raw_moves, moves_per_turn: int) -> list[int]:
    if not isinstance(raw_moves, list) or len(raw_moves) != len(boats):
        return [0 if boat.get("finished") else moves_per_turn for boat in boats]

    normalized: list[int] = []
    for index, boat in enumerate(boats):
        if boat.get("finished"):
            normalized.append(0)
            continue
        normalized.append(clamp_int(raw_moves[index], moves_per_turn, 0, moves_per_turn))
    return normalized


def recalc_hybrid_budget(boats: list[dict], hybrid_moves_left: list[int], previous_budget: int, next_budget: int) -> list[int]:
    recalculated: list[int] = []
    for index, boat in enumerate(boats):
        if boat.get("finished"):
            recalculated.append(0)
            continue
        previous_left = clamp_int(hybrid_moves_left[index], previous_budget, 0, previous_budget)
        spent = max(0, previous_budget - previous_left)
        recalculated.append(max(0, next_budget - spent))
    return recalculated


def merge_hybrid_state(room: dict, candidate_state: dict, actor: dict) -> dict:
    base_state = deepcopy(room.get("game_state") or {})
    merged_state = deepcopy(base_state)

    base_boats = list(merged_state.get("boats") or [])
    candidate_boats = list(candidate_state.get("boats") or [])
    actor_seat = actor["seat_index"]
    if actor_seat >= len(base_boats) or actor_seat >= len(candidate_boats):
        raise RoomForbidden("Room state is out of sync with your seat.")

    settings = merged_state.setdefault("settings", {})
    race = merged_state.setdefault("race", {})
    current_budget = clamp_int(settings.get("movesPerTurn"), 1, 1, 10)
    hybrid_moves_left = normalize_hybrid_moves(base_boats, race.get("hybridMovesLeft"), current_budget)

    candidate_settings = candidate_state.get("settings") or {}
    requested_budget = clamp_int(candidate_settings.get("movesPerTurn"), current_budget, 1, 10)
    if room.get("host_token") == actor.get("token") and requested_budget != current_budget:
        hybrid_moves_left = recalc_hybrid_budget(base_boats, hybrid_moves_left, current_budget, requested_budget)
        settings["movesPerTurn"] = requested_budget
        current_budget = requested_budget
    else:
        settings["movesPerTurn"] = current_budget

    actor_before = base_boats[actor_seat]
    actor_after = deepcopy(candidate_boats[actor_seat])
    actor_changed = actor_before != actor_after

    merged_boats = deepcopy(base_boats)
    merged_boats[actor_seat] = actor_after
    merged_state["boats"] = merged_boats

    hybrid_moves_left = normalize_hybrid_moves(merged_boats, hybrid_moves_left, current_budget)
    if actor_changed and not actor_before.get("finished") and hybrid_moves_left[actor_seat] > 0:
        hybrid_moves_left[actor_seat] -= 1
    if merged_boats[actor_seat].get("finished"):
        hybrid_moves_left[actor_seat] = 0

    race_finished_count = sum(1 for boat in merged_boats if boat.get("finished"))
    current_round = clamp_int(race.get("hybridRound"), 1, 1, 999_999)
    unfinished_can_move = any(
        (not boat.get("finished")) and hybrid_moves_left[index] > 0
        for index, boat in enumerate(merged_boats)
    )
    if not unfinished_can_move and race_finished_count < len(merged_boats):
        current_round += 1
        hybrid_moves_left = [0 if boat.get("finished") else current_budget for boat in merged_boats]

    race["hybridRound"] = current_round
    race["hybridMovesLeft"] = hybrid_moves_left
    race["raceFinishedCount"] = race_finished_count

    current_player = race.get("currentPlayer")
    if actor_changed:
        current_player = actor_seat
    if not isinstance(current_player, int) or not (0 <= current_player < len(merged_boats)):
        current_player = actor_seat
    if merged_boats[current_player].get("finished") or hybrid_moves_left[current_player] <= 0:
        current_player = next(
            (
                index
                for index, boat in enumerate(merged_boats)
                if not boat.get("finished") and hybrid_moves_left[index] > 0
            ),
            actor_seat,
        )

    race["currentPlayer"] = current_player
    race["subMovesLeft"] = hybrid_moves_left[current_player] if 0 <= current_player < len(hybrid_moves_left) else 0
    return merged_state


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

            if state_play_mode(room.get("game_state")) == "hybrid":
                room["game_state"] = merge_hybrid_state(room, game_state, actor)
            else:
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
