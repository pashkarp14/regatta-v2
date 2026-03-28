from __future__ import annotations

import json
import math
import secrets
import string
import threading
import time
from copy import deepcopy
from typing import Any

from redis import Redis

from .game_state import normalize_lobby_preview_state as build_lobby_preview_state
from .observability import (
    observe_game_state_validation,
    observe_public_room_view,
    observe_room_store_operation,
    payload_bytes,
    remove_room_status,
    update_room_status,
)


ROOM_PREFIX = "regatta:v2:room:"
ROOM_CODE_ALPHABET = string.ascii_uppercase + string.digits
MAX_GAME_STATE_BYTES = 500_000
MAX_ROOM_PLAYERS = 20
BOAT_COLORS = [
    "#e53935",
    "#1e88e5",
    "#43a047",
    "#fdd835",
    "#8e24aa",
    "#ff8f00",
    "#00acc1",
    "#6d4c41",
    "#d81b60",
    "#3949ab",
    "#00897b",
    "#7cb342",
    "#fb8c00",
    "#8d6e63",
    "#5e35b1",
    "#039be5",
    "#c0ca33",
    "#f4511e",
    "#546e7a",
    "#ef5350",
]


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


def make_player_id() -> str:
    return secrets.token_urlsafe(10)


def make_room_code() -> str:
    return "".join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(6))


def player_for_token(room: dict[str, Any], player_token: str | None) -> dict[str, Any] | None:
    if not player_token:
        return None
    for player in room.get("players", []):
        if player.get("token") == player_token:
            return player
    return None


def player_for_id(room: dict[str, Any], player_id: str | None) -> dict[str, Any] | None:
    if not player_id:
        return None
    for player in room.get("players", []):
        if player.get("player_id") == player_id:
            return player
    return None


def player_is_observer(player: dict[str, Any] | None) -> bool:
    return bool((player or {}).get("is_observer"))


def normalize_host_role(raw_role: str | None) -> str:
    return "observer" if raw_role == "observer" else "player"


def room_host_player(room: dict[str, Any]) -> dict[str, Any] | None:
    return player_for_token(room, room.get("host_token"))


def room_racing_players(room: dict[str, Any]) -> list[dict[str, Any]]:
    return [player for player in room.get("players", []) if not player_is_observer(player)]


def room_racer_slot_count(room: dict[str, Any]) -> int:
    return len(room_racing_players(room))


def room_joined_racer_count(room: dict[str, Any]) -> int:
    return room_racer_slot_count(room)


def room_total_capacity(room: dict[str, Any]) -> int:
    host_player = room_host_player(room)
    return MAX_ROOM_PLAYERS + (1 if player_is_observer(host_player) else 0)


def room_can_start(room: dict[str, Any]) -> bool:
    return room_joined_racer_count(room) >= 1


def normalize_lobby_preview_state(game_state: Any) -> dict[str, Any]:
    try:
        return build_lobby_preview_state(game_state)
    except TypeError as exc:
        raise RoomValidationError(str(exc)) from exc


def _room_boat_count(room: dict[str, Any]) -> int:
    return room_joined_racer_count(room)


def _player_sort_key(player: dict[str, Any]) -> tuple[int, int, str]:
    seat_index = player.get("seat_index")
    return (
        1 if player_is_observer(player) else 0,
        seat_index if isinstance(seat_index, int) else 10_000,
        str(player.get("player_id") or player.get("token") or ""),
    )


def public_room_view(room: dict[str, Any], player_token: str | None) -> dict[str, Any]:
    started_at = time.perf_counter()
    viewer = player_for_token(room, player_token)
    host_player = room_host_player(room)
    players = sorted(room.get("players", []), key=_player_sort_key)
    boat_count = _room_boat_count(room)
    snapshot = {
        "code": room["code"],
        "status": room["status"],
        "server_time_ms": now_ms(),
        "max_players": boat_count,
        "joined_count": len(players),
        "joined_racers_count": boat_count,
        "capacity": room_total_capacity(room),
        "start_ready": room_can_start(room),
        "can_start": room_can_start(room),
        "revision": room["revision"],
        "play_mode": "realtime",
        "host_mode": "observe" if player_is_observer(host_player) else "play",
        "is_host": room.get("host_token") == player_token,
        "players": [
            {
                "player_id": player["player_id"],
                "name": player["name"],
                "seat_index": player["seat_index"],
                "is_host": player["token"] == room.get("host_token"),
                "is_self": player["token"] == player_token,
                "is_observer": player_is_observer(player),
            }
            for player in players
        ],
        "game_state": deepcopy(room.get("game_state")),
        "self": {
            "player_id": viewer.get("player_id") if viewer else None,
            "name": viewer["name"] if viewer else None,
            "seat_index": viewer["seat_index"] if viewer else None,
            "is_observer": player_is_observer(viewer),
            "token_present": viewer is not None,
        },
    }
    observe_public_room_view(
        time.perf_counter() - started_at,
        payload_bytes(snapshot),
        len(players),
    )
    return snapshot


def validate_game_state_shape(game_state: Any) -> dict[str, Any]:
    started_at = time.perf_counter()
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
    if len(boats) > MAX_ROOM_PLAYERS:
        raise RoomValidationError(f"Boat count cannot exceed {MAX_ROOM_PLAYERS}.")

    observe_game_state_validation(time.perf_counter() - started_at, len(encoded.encode("utf-8")))
    return game_state


def validate_game_state(room: dict[str, Any], game_state: Any) -> dict[str, Any]:
    normalized_state = validate_game_state_shape(game_state)
    boat_count = _room_boat_count(room)
    boats = normalized_state.get("boats") or []
    if len(boats) != boat_count:
        raise RoomValidationError("Boat count must match the current room roster.")

    return normalized_state


def _boat_speed_coeff(raw_boat: dict[str, Any] | None) -> float:
    value = (raw_boat or {}).get("speedCoeff")
    return float(value) if isinstance(value, (int, float)) else 1.0


def _start_line_points(game_state: dict[str, Any]) -> tuple[dict[str, float], dict[str, float], dict[str, float]]:
    course = game_state.get("course") or {}
    start_a = course.get("startA") if isinstance(course.get("startA"), dict) else {"x": 8.0, "y": 2.0}
    start_b = course.get("startB") if isinstance(course.get("startB"), dict) else {"x": 22.0, "y": 2.0}
    marks = course.get("marks") if isinstance(course.get("marks"), list) else []
    first_mark = marks[0] if marks and isinstance(marks[0], dict) else {"x": 15.0, "y": 8.0}
    return start_a, start_b, first_mark


def _course_normal(start_a: dict[str, float], start_b: dict[str, float], first_mark: dict[str, float]) -> tuple[float, float]:
    dx = float(start_b.get("x", 0.0)) - float(start_a.get("x", 0.0))
    dy = float(start_b.get("y", 0.0)) - float(start_a.get("y", 0.0))
    length = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / length, dx / length
    mid_x = (float(start_a.get("x", 0.0)) + float(start_b.get("x", 0.0))) / 2.0
    mid_y = (float(start_a.get("y", 0.0)) + float(start_b.get("y", 0.0))) / 2.0
    to_mark_x = float(first_mark.get("x", mid_x)) - mid_x
    to_mark_y = float(first_mark.get("y", mid_y)) - mid_y
    if (to_mark_x * nx) + (to_mark_y * ny) < 0:
        nx *= -1
        ny *= -1
    return nx, ny


def _default_boat_snapshot(game_state: dict[str, Any], index: int, total: int) -> dict[str, Any]:
    start_a, start_b, first_mark = _start_line_points(game_state)
    blend = (index + 1) / (max(total, 1) + 1)
    normal_x, normal_y = _course_normal(start_a, start_b, first_mark)
    start_depth = 0.65
    x = float(start_a.get("x", 8.0)) + (float(start_b.get("x", 22.0)) - float(start_a.get("x", 8.0))) * blend
    y = float(start_a.get("y", 2.0)) + (float(start_b.get("y", 2.0)) - float(start_a.get("y", 2.0))) * blend
    return {
        "x": x + normal_x * start_depth,
        "y": y + normal_y * start_depth,
        "distance": 0,
        "turns": 0,
        "penalties": 0,
        "collisions": 0,
        "nextMark": 0,
        "finished": False,
        "place": None,
        "hasHeading": False,
        "heading": 0,
        "tack": 0,
        "color": BOAT_COLORS[index % len(BOAT_COLORS)],
        "speedCoeff": 1.0,
        "currentSpeedUnitsPerSec": 0,
        "penaltySlowUntil": 0,
        "lastPenaltyAt": 0,
        "lastPenaltyKey": "",
        "lastPenaltyReason": "",
        "roundInZone": False,
        "roundSweep": 0,
        "startDeltaMs": None,
        "falseStartDeltaMs": None,
    }


def _normalized_boat_snapshot(
    raw_boat: dict[str, Any] | None,
    template_state: dict[str, Any],
    index: int,
    total: int,
) -> dict[str, Any]:
    fallback = _default_boat_snapshot(template_state, index, total)
    if not isinstance(raw_boat, dict):
        return fallback
    return {
        "x": float(raw_boat.get("x", fallback["x"])),
        "y": float(raw_boat.get("y", fallback["y"])),
        "distance": raw_boat.get("distance", 0),
        "turns": raw_boat.get("turns", 0),
        "penalties": raw_boat.get("penalties", 0),
        "collisions": raw_boat.get("collisions", 0),
        "nextMark": raw_boat.get("nextMark", 0),
        "finished": bool(raw_boat.get("finished", False)),
        "place": raw_boat.get("place"),
        "hasHeading": bool(raw_boat.get("hasHeading", False)),
        "heading": raw_boat.get("heading", 0),
        "tack": raw_boat.get("tack", 0),
        "color": raw_boat.get("color") if isinstance(raw_boat.get("color"), str) else fallback["color"],
        "speedCoeff": _boat_speed_coeff(raw_boat),
        "currentSpeedUnitsPerSec": raw_boat.get("currentSpeedUnitsPerSec", 0),
        "penaltySlowUntil": raw_boat.get("penaltySlowUntil", 0),
        "lastPenaltyAt": raw_boat.get("lastPenaltyAt", 0),
        "lastPenaltyKey": raw_boat.get("lastPenaltyKey", ""),
        "lastPenaltyReason": raw_boat.get("lastPenaltyReason", ""),
        "roundInZone": bool(raw_boat.get("roundInZone", False)),
        "roundSweep": raw_boat.get("roundSweep", 0),
        "startDeltaMs": raw_boat.get("startDeltaMs"),
        "falseStartDeltaMs": raw_boat.get("falseStartDeltaMs"),
    }


def _remap_target_index(raw_index: Any, old_ids: list[str], new_ids: list[str]) -> int | None:
    if not new_ids:
        return None
    if isinstance(raw_index, bool) or not isinstance(raw_index, int):
        return 0
    if 0 <= raw_index < len(old_ids):
        player_id = old_ids[raw_index]
        if player_id in new_ids:
            return new_ids.index(player_id)
    return min(raw_index, len(new_ids) - 1)


def reshape_game_state_for_players(
    game_state: dict[str, Any],
    old_ids: list[str],
    new_ids: list[str],
) -> dict[str, Any]:
    state = validate_game_state_shape(deepcopy(game_state))
    old_boats = list(state.get("boats") or [])
    new_boats: list[dict[str, Any]] = []

    for index, player_id in enumerate(new_ids):
        raw_boat = None
        if player_id in old_ids:
            old_index = old_ids.index(player_id)
            if old_index < len(old_boats):
                raw_boat = old_boats[old_index]
        elif not old_ids and index < len(old_boats):
            raw_boat = old_boats[index]
        new_boats.append(_normalized_boat_snapshot(raw_boat, state, index, len(new_ids)))

    settings = state.setdefault("settings", {})
    settings["playMode"] = "realtime"
    for target_key in ("optimalBoatIndex", "bestStartBoatIndex"):
        if target_key in settings:
            settings[target_key] = _remap_target_index(settings.get(target_key), old_ids, new_ids)

    race = state.setdefault("race", {})
    race["raceFinishedCount"] = sum(1 for boat in new_boats if boat.get("finished"))
    race.pop("currentPlayer", None)
    race.pop("subMovesLeft", None)
    race.pop("hybridRound", None)
    race.pop("hybridMovesLeft", None)
    race.pop("prestartRoundsLeft", None)

    state["boats"] = new_boats
    return state


def _racer_ids_for_room(room: dict[str, Any]) -> list[str]:
    return [player["player_id"] for player in room_racing_players(room)]


def _assign_compact_seats(room: dict[str, Any]) -> None:
    next_seat = 0
    for player in room.get("players", []):
        if player_is_observer(player):
            player["seat_index"] = None
            continue
        player["seat_index"] = next_seat
        next_seat += 1


def reshape_room_player_states(room: dict[str, Any]) -> dict[str, Any]:
    old_ids = list(room.get("racer_player_ids") or [])
    _assign_compact_seats(room)
    new_ids = _racer_ids_for_room(room)
    for state_key in ("start_state", "initial_lobby_state", "game_state"):
        snapshot = room.get(state_key)
        if isinstance(snapshot, dict):
            room[state_key] = reshape_game_state_for_players(snapshot, old_ids, new_ids)
    room["racer_player_ids"] = new_ids
    room["max_players"] = len(new_ids)
    return room


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
        backend = "redis" if self.redis is not None else "memory"
        started_at = time.perf_counter()
        result = "ok"
        payload_size = 0
        room_code = normalize_room_code(room_code)
        if not room_code:
            observe_room_store_operation("get_room", backend, started_at, result=result, payload_size=payload_size)
            return None

        try:
            if self.redis is not None:
                raw = self.redis.get(self._key(room_code))
                if raw is None:
                    return None
                room = json.loads(raw)
                payload_size = len(raw)
                return room

            with self._lock:
                room = self._load_memory(room_code)
            payload_size = payload_bytes(room)
            return room
        except RoomStoreError:
            result = "rejected"
            raise
        except Exception:
            result = "error"
            raise
        finally:
            observe_room_store_operation("get_room", backend, started_at, result=result, payload_size=payload_size)

    def save_room(self, room: dict[str, Any]) -> dict[str, Any]:
        backend = "redis" if self.redis is not None else "memory"
        started_at = time.perf_counter()
        result = "ok"
        room = deepcopy(room)
        room["updated_at"] = now_ts()
        payload_size = payload_bytes(room)
        try:
            if self.redis is not None:
                self.redis.setex(
                    self._key(room["code"]),
                    self.ttl_seconds,
                    json.dumps(room, separators=(",", ":"), ensure_ascii=False),
                )
            else:
                with self._lock:
                    self._save_memory(room)
            update_room_status(room["code"], str(room.get("status") or "unknown"))
            return room
        except RoomStoreError:
            result = "rejected"
            raise
        except Exception:
            result = "error"
            raise
        finally:
            observe_room_store_operation("save_room", backend, started_at, result=result, payload_size=payload_size)

    def delete_room(self, room_code: str) -> None:
        backend = "redis" if self.redis is not None else "memory"
        started_at = time.perf_counter()
        result = "ok"
        room_code = normalize_room_code(room_code)
        try:
            if self.redis is not None:
                self.redis.delete(self._key(room_code))
            else:
                with self._lock:
                    self._memory_rooms.pop(room_code, None)
            remove_room_status(room_code)
        except RoomStoreError:
            result = "rejected"
            raise
        except Exception:
            result = "error"
            raise
        finally:
            observe_room_store_operation("delete_room", backend, started_at, result=result)

    def create_room(
        self,
        host_name: str,
        max_players: int,
        game_state: dict[str, Any],
        *,
        host_role: str = "player",
    ) -> tuple[dict[str, Any], str]:
        backend = "redis" if self.redis is not None else "memory"
        started_at = time.perf_counter()
        result = "ok"
        payload_size = 0
        try:
            if isinstance(max_players, int) and max_players > MAX_ROOM_PLAYERS:
                raise RoomValidationError(f"Room size cannot exceed {MAX_ROOM_PLAYERS} boats.")

            source_state = validate_game_state_shape(deepcopy(game_state))
            for _ in range(12):
                room_code = make_room_code()
                if self.get_room(room_code) is None:
                    break
            else:
                raise RoomValidationError("Unable to generate a room code. Try again.")

            player_token = make_player_token()
            host_is_observer = normalize_host_role(host_role) == "observer"
            host_player_id = make_player_id()
            room = {
                "code": room_code,
                "status": "lobby",
                "max_players": 0,
                "host_token": player_token,
                "revision": 1,
                "created_at": now_ts(),
                "updated_at": now_ts(),
                "players": [
                    {
                        "player_id": host_player_id,
                        "token": player_token,
                        "name": normalize_name(host_name),
                        "seat_index": None if host_is_observer else 0,
                        "is_observer": host_is_observer,
                        "joined_at": now_ts(),
                    }
                ],
                "racer_player_ids": [],
                "start_state": source_state,
                "initial_lobby_state": deepcopy(source_state),
                "game_state": deepcopy(source_state),
            }
            reshape_room_player_states(room)
            room["start_state"] = validate_game_state(room, deepcopy(room["start_state"]))
            room["initial_lobby_state"] = validate_game_state(room, deepcopy(room["initial_lobby_state"]))
            room["game_state"] = normalize_lobby_preview_state(room["start_state"])
            payload_size = payload_bytes(room)
            self.save_room(room)
            return room, player_token
        except RoomStoreError:
            result = "rejected"
            raise
        except Exception:
            result = "error"
            raise
        finally:
            observe_room_store_operation("create_room", backend, started_at, result=result, payload_size=payload_size)

    def join_room(self, room_code: str, player_name: str, player_token: str | None = None) -> tuple[dict[str, Any], str]:
        backend = "redis" if self.redis is not None else "memory"
        started_at = time.perf_counter()
        result = "ok"
        payload_size = 0
        try:
            room = self.get_room(room_code)
            if room is None:
                raise RoomNotFound("Room not found.")

            existing = player_for_token(room, player_token)
            if existing is not None:
                payload_size = payload_bytes(room)
                return room, existing["token"]

            if room["status"] != "lobby":
                raise RoomForbidden("The match is already running.")
            if room_joined_racer_count(room) >= MAX_ROOM_PLAYERS:
                raise RoomFull("Room is already full.")

            room["players"].append(
                {
                    "player_id": make_player_id(),
                    "token": make_player_token(),
                    "name": normalize_name(player_name),
                    "seat_index": None,
                    "is_observer": False,
                    "joined_at": now_ts(),
                }
            )
            reshape_room_player_states(room)
            room["game_state"] = normalize_lobby_preview_state(room["start_state"])
            room["revision"] += 1
            payload_size = payload_bytes(room)
            self.save_room(room)
            newest_player = room["players"][-1]
            return room, newest_player["token"]
        except RoomStoreError:
            result = "rejected"
            raise
        except Exception:
            result = "error"
            raise
        finally:
            observe_room_store_operation("join_room", backend, started_at, result=result, payload_size=payload_size)

    def remove_player(self, room_code: str, player_token: str | None) -> dict[str, Any] | None:
        backend = "redis" if self.redis is not None else "memory"
        started_at = time.perf_counter()
        result = "ok"
        payload_size = 0
        try:
            room = self.get_room(room_code)
            if room is None or not player_token:
                return None

            remaining = [player for player in room["players"] if player["token"] != player_token]
            if len(remaining) == len(room["players"]):
                payload_size = payload_bytes(room)
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
            reshape_room_player_states(room)
            if room["status"] == "lobby":
                room["game_state"] = normalize_lobby_preview_state(room["start_state"])
            room["revision"] += 1
            payload_size = payload_bytes(room)
            return self.save_room(room)
        except RoomStoreError:
            result = "rejected"
            raise
        except Exception:
            result = "error"
            raise
        finally:
            observe_room_store_operation("remove_player", backend, started_at, result=result, payload_size=payload_size)

    def kick_player(self, room_code: str, actor_token: str | None, player_id: str | None) -> dict[str, Any]:
        backend = "redis" if self.redis is not None else "memory"
        started_at = time.perf_counter()
        result = "ok"
        payload_size = 0
        try:
            room = self.get_room(room_code)
            if room is None:
                raise RoomNotFound("Room not found.")
            if room.get("host_token") != actor_token:
                raise RoomForbidden("Only the host can kick participants.")

            target_player = player_for_id(room, player_id)
            if target_player is None:
                raise RoomNotFound("Player not found.")
            if target_player["token"] == room.get("host_token"):
                raise RoomForbidden("The host cannot kick themselves.")

            updated_room = self.remove_player(room_code, target_player["token"])
            if updated_room is None:
                raise RoomNotFound("Room not found.")
            payload_size = payload_bytes(updated_room)
            return updated_room
        except RoomStoreError:
            result = "rejected"
            raise
        except Exception:
            result = "error"
            raise
        finally:
            observe_room_store_operation("kick_player", backend, started_at, result=result, payload_size=payload_size)
