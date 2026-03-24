from __future__ import annotations

from contextlib import contextmanager
import threading

from .room_store import RoomStore, RoomForbidden, RoomFull, RoomNotFound, RoomValidationError, normalize_lobby_preview_state, normalize_name, normalize_room_code, player_for_id, player_for_token, player_is_observer, reshape_room_player_states, room_joined_racer_count, MAX_ROOM_PLAYERS, make_player_id, make_player_token, make_room_code, now_ts, validate_game_state, validate_game_state_shape


class LockedRoomStore(RoomStore):
    def __init__(self, redis_client, ttl_seconds: int) -> None:
        super().__init__(redis_client, ttl_seconds)
        self._named_locks: dict[str, threading.Lock] = {}

    def _memory_named_lock(self, lock_name: str) -> threading.Lock:
        with self._lock:
            lock = self._named_locks.get(lock_name)
            if lock is None:
                lock = threading.Lock()
                self._named_locks[lock_name] = lock
            return lock

    @contextmanager
    def _named_guard(self, lock_name: str):
        if self.redis is not None:
            lock = self.redis.lock(
                f"room-lock:{lock_name}",
                timeout=max(self.ttl_seconds, 30),
                blocking_timeout=10,
            )
            acquired = lock.acquire(blocking=True)
            if not acquired:
                raise RoomValidationError("Room is busy. Try again.")
            try:
                yield
            finally:
                try:
                    lock.release()
                except Exception:
                    pass
            return

        local_lock = self._memory_named_lock(lock_name)
        local_lock.acquire()
        try:
            yield
        finally:
            local_lock.release()

    @contextmanager
    def _room_guard(self, room_code: str):
        normalized = normalize_room_code(room_code)
        if not normalized:
            yield
            return
        with self._named_guard(f"room:{normalized}"):
            yield

    def create_room(self, host_name: str, max_players: int, game_state: dict, *, host_role: str = "player"):
        if isinstance(max_players, int) and max_players > MAX_ROOM_PLAYERS:
            raise RoomValidationError(f"Room size cannot exceed {MAX_ROOM_PLAYERS} boats.")

        with self._named_guard("room:create"):
            source_state = validate_game_state_shape(game_state)
            for _ in range(12):
                room_code = make_room_code()
                if self.get_room(room_code) is None:
                    break
            else:
                raise RoomValidationError("Unable to generate a room code. Try again.")

            player_token = make_player_token()
            host_is_observer = host_role == "observer"
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
                "initial_lobby_state": source_state.copy() if isinstance(source_state, dict) else source_state,
                "game_state": source_state.copy() if isinstance(source_state, dict) else source_state,
            }
            reshape_room_player_states(room)
            room["start_state"] = validate_game_state(room, room["start_state"])
            room["initial_lobby_state"] = validate_game_state(room, room["initial_lobby_state"])
            room["game_state"] = normalize_lobby_preview_state(room["start_state"])
            self.save_room(room)
            return room, player_token

    def join_room(self, room_code: str, player_name: str, player_token: str | None = None):
        normalized_code = normalize_room_code(room_code)
        with self._room_guard(normalized_code):
            room = self.get_room(normalized_code)
            if room is None:
                raise RoomNotFound("Room not found.")

            existing = player_for_token(room, player_token)
            if existing is not None:
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
            self.save_room(room)
            newest_player = room["players"][-1]
            return room, newest_player["token"]

    def _remove_player_from_room(self, room: dict, player_token: str):
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
        reshape_room_player_states(room)
        if room["status"] == "lobby":
            room["game_state"] = normalize_lobby_preview_state(room["start_state"])
        room["revision"] += 1
        return self.save_room(room)

    def remove_player(self, room_code: str, player_token: str | None = None):
        if not player_token:
            return None
        normalized_code = normalize_room_code(room_code)
        with self._room_guard(normalized_code):
            room = self.get_room(normalized_code)
            if room is None:
                return None
            return self._remove_player_from_room(room, player_token)

    def kick_player(self, room_code: str, actor_token: str | None, player_id: str | None):
        normalized_code = normalize_room_code(room_code)
        with self._room_guard(normalized_code):
            room = self.get_room(normalized_code)
            if room is None:
                raise RoomNotFound("Room not found.")
            if room.get("host_token") != actor_token:
                raise RoomForbidden("Only the host can kick participants.")

            target_player = player_for_id(room, player_id)
            if target_player is None:
                raise RoomNotFound("Player not found.")
            if target_player["token"] == room.get("host_token"):
                raise RoomForbidden("The host cannot kick themselves.")

            updated_room = self._remove_player_from_room(room, target_player["token"])
            if updated_room is None:
                raise RoomNotFound("Room not found.")
            return updated_room
