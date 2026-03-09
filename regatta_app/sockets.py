from __future__ import annotations

from flask import current_app, session
from flask_socketio import emit, join_room

from .extensions import socketio
from .room_store import RoomForbidden, RoomNotFound, RoomStoreError, public_room_view, validate_game_state


def room_store():
    return current_app.extensions["room_store"]


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
        {"room": public_room_view(room, player_token)},
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

        if room["status"] == "lobby":
            if room["host_token"] != player_token:
                raise RoomForbidden("Only the host can edit the course before the start.")
        else:
            current_player = (room.get("game_state", {}).get("race") or {}).get("currentPlayer")
            actor = next((player for player in room["players"] if player["token"] == player_token), None)
            if actor is None or actor["seat_index"] != current_player:
                raise RoomForbidden("It is not your turn.")

        room["game_state"] = game_state
        room["revision"] += 1
        room_store().save_room(room)
    except RoomStoreError as exc:
        emit("room:error", {"error": str(exc)})
        return

    socketio.emit(
        "room:state_updated",
        {"room": public_room_view(room, player_token)},
        to=room["code"],
    )
