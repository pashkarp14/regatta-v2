from __future__ import annotations

from copy import deepcopy
import threading
from typing import Any

from flask import current_app


class LiveRuntimeRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: dict[str, dict[str, Any]] = {}

    def ensure_room(self, room: dict[str, Any], now_ms: int) -> dict[str, Any]:
        room_code = str(room.get("code") or "")
        with self._lock:
            entry = self._entries.get(room_code)
            if entry is None:
                entry = {
                    "room": deepcopy(room),
                    "dirty": False,
                    "last_checkpoint_ms": int(now_ms),
                }
                self._entries[room_code] = entry
            return deepcopy(entry["room"])

    def get_room(self, room_code: str) -> dict[str, Any] | None:
        with self._lock:
            entry = self._entries.get(room_code)
            if entry is None:
                return None
            return deepcopy(entry["room"])

    def replace_room(self, room: dict[str, Any], now_ms: int) -> dict[str, Any]:
        room_code = str(room.get("code") or "")
        with self._lock:
            previous = self._entries.get(room_code)
            self._entries[room_code] = {
                "room": deepcopy(room),
                "dirty": bool(previous["dirty"]) if previous is not None else False,
                "last_checkpoint_ms": int(previous["last_checkpoint_ms"]) if previous is not None else int(now_ms),
            }
            return deepcopy(self._entries[room_code]["room"])

    def mark_dirty(self, room_code: str) -> None:
        with self._lock:
            entry = self._entries.get(room_code)
            if entry is None:
                return
            entry["dirty"] = True

    def flush_due(self, room_code: str, now_ms: int, min_interval_ms: int = 250) -> dict[str, Any] | None:
        return self._flush(room_code, now_ms, force=False, min_interval_ms=min_interval_ms)

    def flush_now(self, room_code: str, now_ms: int) -> dict[str, Any] | None:
        return self._flush(room_code, now_ms, force=True, min_interval_ms=0)

    def drop_room(self, room_code: str) -> None:
        with self._lock:
            self._entries.pop(room_code, None)

    def _flush(
        self,
        room_code: str,
        now_ms: int,
        *,
        force: bool,
        min_interval_ms: int,
    ) -> dict[str, Any] | None:
        with self._lock:
            entry = self._entries.get(room_code)
            if entry is None or not entry["dirty"]:
                return None
            elapsed_ms = int(now_ms) - int(entry["last_checkpoint_ms"])
            if not force and elapsed_ms < max(int(min_interval_ms), 0):
                return None

            saved_room = current_app.extensions["room_store"].save_room(entry["room"])
            entry["room"] = deepcopy(saved_room)
            entry["dirty"] = False
            entry["last_checkpoint_ms"] = int(now_ms)
            return deepcopy(saved_room)
