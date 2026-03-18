from __future__ import annotations

import json
import secrets
import string
import threading
import time
from copy import deepcopy
from typing import Any

from redis import Redis


ROOM_PREFIX = "regatta:v2:room:"
ROOM_CODE_ALPHABET = string.ascii_uppercase + string.digits
MAX_GAME_STATE_BYTES = 500_000
MIN_ROOM_PLAYERS = 2
MAX_ROOM_PLAYERS = 20


class RoomStoreError(Exception):
    status_code = 400


class RoomNotFound(RoomStoreError):
    status_code = 404


class RoomFull(RoomStoreError):
    status_code = 409


class RoomForbidden(RoomStoreError):
    status_code = 403


class RoomValidationError(RoomStoreError):
    status_code = 422


def now_ts() -> int:
    return int(time.time())


def now_ms() -> int:
    return int(time.time() * 1000)


def normalize_name(raw_name: str | None) -> str:
    cleaned = (raw_name or "").strip()
    if not cleaned:
        return "Skipper"
    return cleaned[:24]


def normalize_room_code(raw_code: str | None) -> str:
    return (raw_code or "").strip().upper()


def make_player_token() -> str:
    return secrets.token_urlsafe(18)


def make_room_code() -> str:
    return "".join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(6))


def player_for_token(room: dict[str, Any], player_token: str | None) -> dict[str, Any] | None:
    if not player_token:
        return None
    for player in room.get("players", []):
        if player.get("token") == player_token:
            return player
    return None


def player_is_observer(player: dict[str, Any] | None) -> bool:
    return bool((player or {}).get("is_observer"))


def normalize_host_role(raw_role: str | None) -> str:
    return "observer" if raw_role == "observer" else "player"


def room_host_player(room: dict[str, Any]) -> dict[str, Any] | None:
    return player_for_token(room, room.get("host_token"))


def room_racer_slot_count(room: dict[str, Any]) -> int:
    return int(room.get("max_players") or 0)


def room_joined_racer_count(room: dict[str, Any]) -> int:
    return sum(
        1
        for player in room.get("players", [])
        if not player_is_observer(player) and isinstance(player.get("seat_index"), int)
    )


def room_total_capacity(room: dict[str, Any]) -> int:
    host_player = room_host_player(room)
    return room_racer_slot_count(room) + (1 if player_is_observer(host_player) else 0)


def room_start_ready(room: dict[str, Any]) -> bool:
    return room_joined_racer_count(room) == room_racer_slot_count(room)


def next_open_seat(room: dict[str, Any]) -> int | None:
    used_seats = {
        player.get("seat_index")
        for player in room.get("players", [])
        if isinstance(player.get("seat_index"), int)
    }
    for seat_index in range(room_racer_slot_count(room)):
        if seat_index not in used_seats:
            return seat_index
    return None


def normalize_lobby_preview_state(game_state: Any) -> dict[str, Any]:
    if not isinstance(game_state, dict):
        raise RoomValidationError("Game state must be a JSON object.")

    preview_state = deepcopy(game_state)
    settings = preview_state.setdefault("settings", {})
    race = preview_state.setdefault("race", {})
    boats = list(preview_state.get("boats") or [])
    preview_state["boats"] = boats

    for boat in boats:
        if not isinstance(boat, dict):
            continue
        boat.setdefault("distance", 0)
        boat.setdefault("turns", 0)
        boat.setdefault("penalties", 0)
        boat.setdefault("collisions", 0)
        boat.setdefault("nextMark", 0)
        boat.setdefault("finished", False)
        boat.setdefault("place", None)
        boat.setdefault("hasHeading", False)
        boat.setdefault("heading", 0)
        boat.setdefault("tack", 0)
        boat.setdefault("speedCoeff", 1.0)
        boat["currentSpeedUnitsPerSec"] = 0.0
        boat["penaltySlowUntil"] = 0
        boat["lastPenaltyAt"] = 0
        boat["lastPenaltyKey"] = ""
        boat["lastPenaltyReason"] = ""
        boat.setdefault("roundInZone", False)
        boat.setdefault("roundSweep", 0.0)
        boat["startDeltaMs"] = None
        boat["falseStartDeltaMs"] = None

    race["phase"] = "race"
    race["realtimeCountdownEndsAt"] = 0
    race["isLobbyPreview"] = True
    race["subMovesLeft"] = 0
    race["prestartRoundsLeft"] = 0
    race["raceFinishedCount"] = int(race.get("raceFinishedCount") or sum(1 for boat in boats if boat.get("finished")))
    current_player = race.get("currentPlayer")
    if not isinstance(current_player, int) or not (0 <= current_player < len(boats)):
        race["currentPlayer"] = next((idx for idx, boat in enumerate(boats) if not boat.get("finished")), 0)

    if settings.get("playMode") in {"hybrid"}:
        settings["playMode"] = "turns"
        race.pop("hybridRound", None)
        race.pop("hybridMovesLeft", None)

    race.setdefault("gustExpiresAt", 0)
    race.setdefault("nextAutoGustAt", 0)
    return preview_state


def public_room_view(room: dict[str, Any], player_token: str | None) -> dict[str, Any]:
    viewer = player_for_token(room, player_token)
    host_player = room_host_player(room)
    game_state = room.get("game_state")
    current_player = None
    play_mode = "turns"
    if isinstance(game_state, dict):
        current_player = (game_state.get("race") or {}).get("currentPlayer")
        play_mode = ((game_state.get("settings") or {}).get("playMode") or "turns")

    return {
        "code": room["code"],
        "status": room["status"],
        "server_time_ms": now_ms(),
        "max_players": room["max_players"],
        "joined_count": len(room["players"]),
        "joined_racers_count": room_joined_racer_count(room),
        "capacity": room_total_capacity(room),
        "start_ready": room_start_ready(room),
        "revision": room["revision"],
        "current_player": current_player,
        "play_mode": "realtime" if play_mode in {"realtime", "hybrid"} else "turns",
        "host_mode": "observe" if player_is_observer(host_player) else "play",
        "is_host": room.get("host_token") == player_token,
        "players": [
            {
                "name": player["name"],
                "seat_index": player["seat_index"],
                "is_host": player["token"] == room.get("host_token"),
                "is_self": player["token"] == player_token,
                "is_observer": player_is_observer(player),
            }
            for player in room["players"]
        ],
        "game_state": deepcopy(room.get("game_state")),
        "self": {
            "name": viewer["name"] if viewer else None,
            "seat_index": viewer["seat_index"] if viewer else None,
            "is_observer": player_is_observer(viewer),
            "token_present": viewer is not None,
        },
    }


def validate_game_state(room: dict[str, Any], game_state: Any) -> dict[str, Any]:
    if not isinstance(game_state, dict):
        raise RoomValidationError("Game state must be a JSON object.")

    try:
        encoded = json.dumps(game_state, separators=(",", ":"), ensure_ascii=False)
    except TypeError as exc:
        raise RoomValidationError(f"Game state is not serializable: {exc}") from exc

    if len(encoded.encode("utf-8")) > MAX_GAME_STATE_BYTES:
        raise RoomValidationError("Game state payload is too large.")

    boats = game_state.get("boats")
    if not isinstance(boats, list):
        raise RoomValidationError("Game state must contain a boats list.")
    if len(boats) != room["max_players"]:
        raise RoomValidationError("Boat count must match the room size.")

    current_player = (game_state.get("race") or {}).get("currentPlayer")
    if not isinstance(current_player, int) or not (0 <= current_player < room["max_players"]):
        raise RoomValidationError("Current player is out of range.")

    hybrid_moves_left = (game_state.get("race") or {}).get("hybridMovesLeft")
    if hybrid_moves_left is not None:
        if not isinstance(hybrid_moves_left, list) or len(hybrid_moves_left) != room["max_players"]:
            raise RoomValidationError("Hybrid move budget is out of range.")

    return game_state


class RoomStore:
    def __init__(self, redis_client: Redis | None, ttl_seconds: int) -> None:
        self.redis = redis_client
        self.ttl_seconds = ttl_seconds
        self._memory_rooms: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def _key(self, room_code: str) -> str:
        return f"{ROOM_PREFIX}{room_code}"

    def _load_memory(self, room_code: str) -> dict[str, Any] | None:
        room = self._memory_rooms.get(room_code)
        return deepcopy(room) if room else None

    def _save_memory(self, room: dict[str, Any]) -> None:
        self._memory_rooms[room["code"]] = deepcopy(room)

    def get_room(self, room_code: str) -> dict[str, Any] | None:
        room_code = normalize_room_code(room_code)
        if not room_code:
            return None

        if self.redis is not None:
            raw = self.redis.get(self._key(room_code))
            if raw is None:
                return None
            return json.loads(raw)

        with self._lock:
            return self._load_memory(room_code)

    def save_room(self, room: dict[str, Any]) -> dict[str, Any]:
        room = deepcopy(room)
        room["updated_at"] = now_ts()
        if self.redis is not None:
            self.redis.setex(
                self._key(room["code"]),
                self.ttl_seconds,
                json.dumps(room, separators=(",", ":"), ensure_ascii=False),
            )
            return room

        with self._lock:
            self._save_memory(room)
        return room

    def delete_room(self, room_code: str) -> None:
        room_code = normalize_room_code(room_code)
        if self.redis is not None:
            self.redis.delete(self._key(room_code))
            return

        with self._lock:
            self._memory_rooms.pop(room_code, None)

    def create_room(
        self,
        host_name: str,
        max_players: int,
        game_state: dict[str, Any],
        *,
        host_role: str = "player",
    ) -> tuple[dict[str, Any], str]:
        if not isinstance(max_players, int) or not (MIN_ROOM_PLAYERS <= max_players <= MAX_ROOM_PLAYERS):
            raise RoomValidationError(
                f"Room size must be between {MIN_ROOM_PLAYERS} and {MAX_ROOM_PLAYERS} players."
            )

        for _ in range(12):
            room_code = make_room_code()
            if self.get_room(room_code) is None:
                break
        else:
            raise RoomValidationError("Unable to generate a room code. Try again.")

        player_token = make_player_token()
        host_is_observer = normalize_host_role(host_role) == "observer"
        room = {
            "code": room_code,
            "status": "lobby",
            "max_players": max_players,
            "host_token": player_token,
            "revision": 1,
            "created_at": now_ts(),
            "updated_at": now_ts(),
            "players": [
                {
                    "token": player_token,
                    "name": normalize_name(host_name),
                    "seat_index": None if host_is_observer else 0,
                    "is_observer": host_is_observer,
                    "joined_at": now_ts(),
                }
            ],
            "start_state": None,
            "game_state": None,
        }
        room["start_state"] = validate_game_state(room, deepcopy(game_state))
        room["game_state"] = normalize_lobby_preview_state(room["start_state"])
        self.save_room(room)
        return room, player_token

    def join_room(self, room_code: str, player_name: str, player_token: str | None = None) -> tuple[dict[str, Any], str]:
        room = self.get_room(room_code)
        if room is None:
            raise RoomNotFound("Room not found.")

        existing = player_for_token(room, player_token)
        if existing is not None:
            return room, existing["token"]

        if room["status"] != "lobby":
            raise RoomForbidden("The match is already running.")

        if len(room["players"]) >= room_total_capacity(room):
            raise RoomFull("Room is already full.")

        seat_index = next_open_seat(room)
        if seat_index is None:
            raise RoomFull("Every racing seat is already occupied.")
        new_token = make_player_token()
        room["players"].append(
            {
                "token": new_token,
                "name": normalize_name(player_name),
                "seat_index": seat_index,
                "is_observer": False,
                "joined_at": now_ts(),
            }
        )
        room["revision"] += 1
        self.save_room(room)
        return room, new_token

    def remove_player(self, room_code: str, player_token: str | None) -> dict[str, Any] | None:
        room = self.get_room(room_code)
        if room is None or not player_token:
            return None

        remaining = [player for player in room["players"] if player["token"] != player_token]
        if len(remaining) == len(room["players"]):
            return room

        if not remaining:
            self.delete_room(room["code"])
            return None

        room["players"] = remaining
        if room["host_token"] == player_token:
            room["host_token"] = min(
                remaining,
                key=lambda item: (
                    player_is_observer(item),
                    item["seat_index"] if isinstance(item.get("seat_index"), int) else 10_000,
                    item.get("joined_at") or 0,
                ),
            )["token"]
        room["revision"] += 1
        return self.save_room(room)
