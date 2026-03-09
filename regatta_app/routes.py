from __future__ import annotations

from flask import Blueprint, current_app, jsonify, render_template, request, session

from .room_store import (
    RoomForbidden,
    RoomNotFound,
    RoomStoreError,
    RoomValidationError,
    normalize_name,
    normalize_room_code,
    player_for_token,
    public_room_view,
    validate_game_state,
)


bp = Blueprint("main", __name__)


def room_store():
    return current_app.extensions["room_store"]


def current_room():
    room_code = session.get("room_code")
    player_token = session.get("player_token")
    if not room_code or not player_token:
        return None

    room = room_store().get_room(room_code)
    if room is None or player_for_token(room, player_token) is None:
        clear_room_session()
        return None
    return room


def clear_room_session() -> None:
    session.pop("room_code", None)
    session.pop("player_token", None)


def leave_existing_room() -> None:
    room_code = session.get("room_code")
    player_token = session.get("player_token")
    if room_code and player_token:
        room_store().remove_player(room_code, player_token)
    clear_room_session()


def json_payload() -> dict:
    return request.get_json(silent=True) or {}


def error_response(exc: RoomStoreError):
    return jsonify({"error": str(exc)}), exc.status_code


@bp.get("/")
def index():
    return render_template(
        "index.html",
        app_name=current_app.config["APP_NAME"],
        version=current_app.config["APP_VERSION"],
    )


@bp.get("/healthz")
def healthz():
    redis_client = current_app.extensions.get("redis_client")
    redis_ok = False
    if redis_client is not None:
        try:
            redis_ok = bool(redis_client.ping())
        except Exception:
            redis_ok = False

    return {
        "status": "ok",
        "version": current_app.config["APP_VERSION"],
        "redis": redis_ok,
        "session_backend": current_app.config["SESSION_TYPE"],
    }


@bp.get("/api/bootstrap")
def bootstrap():
    room = current_room()
    payload = {
        "version": current_app.config["APP_VERSION"],
        "display_name": session.get("display_name", ""),
        "room": public_room_view(room, session.get("player_token")) if room else None,
    }
    return payload


@bp.post("/api/rooms")
def create_room():
    payload = json_payload()
    game_state = payload.get("game_state")
    max_players = int(payload.get("max_players", 0))
    display_name = normalize_name(payload.get("display_name") or session.get("display_name"))

    try:
        leave_existing_room()
        room, player_token = room_store().create_room(display_name, max_players, game_state)
    except RoomStoreError as exc:
        return error_response(exc)

    session["room_code"] = room["code"]
    session["player_token"] = player_token
    session["display_name"] = display_name

    return {"room": public_room_view(room, player_token)}


@bp.post("/api/rooms/join")
def join_room():
    payload = json_payload()
    room_code = normalize_room_code(payload.get("room_code"))
    display_name = normalize_name(payload.get("display_name") or session.get("display_name"))

    try:
        if session.get("room_code") and session.get("room_code") != room_code:
            leave_existing_room()
        room, player_token = room_store().join_room(room_code, display_name, session.get("player_token"))
    except RoomStoreError as exc:
        return error_response(exc)

    session["room_code"] = room["code"]
    session["player_token"] = player_token
    session["display_name"] = display_name

    return {"room": public_room_view(room, player_token)}


@bp.post("/api/rooms/leave")
def leave_room():
    leave_existing_room()
    return {"room": None}


@bp.get("/api/rooms/<room_code>")
def get_room(room_code: str):
    room = room_store().get_room(room_code)
    if room is None:
        return error_response(RoomNotFound("Room not found."))
    return {"room": public_room_view(room, session.get("player_token"))}


@bp.post("/api/rooms/<room_code>/start")
def start_room(room_code: str):
    player_token = session.get("player_token")
    room = room_store().get_room(room_code)
    if room is None:
        return error_response(RoomNotFound("Room not found."))
    if room["host_token"] != player_token:
        return error_response(RoomForbidden("Only the room host can start the match."))
    if len(room["players"]) != room["max_players"]:
        return error_response(RoomValidationError("Wait until every player has joined."))

    payload = json_payload()
    try:
        room["game_state"] = validate_game_state(room, payload.get("game_state"))
    except RoomStoreError as exc:
        return error_response(exc)

    room["status"] = "live"
    room["revision"] += 1
    room_store().save_room(room)
    current_app.extensions["socketio"].emit(
        "room:snapshot",
        {"room": public_room_view(room, None)},
        to=room["code"],
    )
    return {"room": public_room_view(room, player_token)}
