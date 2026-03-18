from __future__ import annotations

from dataclasses import dataclass

from flask import session


@dataclass(frozen=True)
class RoomSessionState:
    room_code: str | None
    player_token: str | None
    display_name: str


def current_session_state() -> RoomSessionState:
    return RoomSessionState(
        room_code=session.get("room_code"),
        player_token=session.get("player_token"),
        display_name=session.get("display_name", ""),
    )


def display_name(default: str = "") -> str:
    return session.get("display_name", default)


def bind_room_session(room_code: str, player_token: str, player_display_name: str) -> None:
    session["room_code"] = room_code
    session["player_token"] = player_token
    session["display_name"] = player_display_name


def clear_room_session() -> None:
    session.pop("room_code", None)
    session.pop("player_token", None)
