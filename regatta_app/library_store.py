from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MAX_LIBRARY_SNAPSHOT_BYTES = 500_000
SUPPORTED_KINDS = {"maps", "races"}


class LibraryStoreError(Exception):
    status_code = 400


class LibraryNotFound(LibraryStoreError):
    status_code = 404


class LibraryForbidden(LibraryStoreError):
    status_code = 403


class LibraryValidationError(LibraryStoreError):
    status_code = 422


def utc_iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def default_record_name(kind: str) -> str:
    return "Новая карта" if kind == "maps" else "Сохраненная гонка"


def clean_text(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    return text[:120] if text else fallback


def normalize_tags(raw_tags: Any) -> list[str]:
    if not isinstance(raw_tags, list):
        return []
    tags: list[str] = []
    for item in raw_tags:
        tag = str(item or "").strip()
        if tag:
            tags.append(tag[:40])
    return tags[:8]


def summarize_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    settings = snapshot.get("settings") or {}
    course = snapshot.get("course") or {}
    race = snapshot.get("race") or {}
    world = snapshot.get("world") or {}
    boats = snapshot.get("boats") or []
    return {
        "player_count": len(boats),
        "mark_count": int(course.get("markCount") or 0),
        "play_mode": "realtime" if settings.get("playMode") in {"realtime", "hybrid"} else "turns",
        "phase": race.get("phase") or "race",
        "world": {
            "width": float(world.get("width") or 0),
            "height": float(world.get("height") or 0),
        },
    }


def validate_snapshot(snapshot: Any) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        raise LibraryValidationError("Snapshot must be a JSON object.")

    try:
        encoded = json.dumps(snapshot, separators=(",", ":"), ensure_ascii=False)
    except TypeError as exc:
        raise LibraryValidationError(f"Snapshot is not serializable: {exc}") from exc

    if len(encoded.encode("utf-8")) > MAX_LIBRARY_SNAPSHOT_BYTES:
        raise LibraryValidationError("Snapshot payload is too large.")

    boats = snapshot.get("boats")
    if not isinstance(boats, list) or not (2 <= len(boats) <= 8):
        raise LibraryValidationError("Snapshot must contain between 2 and 8 boats.")

    race = snapshot.get("race") or {}
    current_player = race.get("currentPlayer")
    if not isinstance(current_player, int) or not (0 <= current_player < len(boats)):
        raise LibraryValidationError("Snapshot current player is out of range.")

    return snapshot


def trim_record(record: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in record.items()
        if key != "snapshot"
    }


class LibraryStore:
    def __init__(self, root_dir: str | Path, standard_maps_dir: str | Path) -> None:
        self.root_dir = Path(root_dir)
        self.standard_maps_dir = Path(standard_maps_dir)
        self.root_dir.mkdir(parents=True, exist_ok=True)
        (self.root_dir / "maps").mkdir(parents=True, exist_ok=True)
        (self.root_dir / "races").mkdir(parents=True, exist_ok=True)

    def _kind_dir(self, kind: str) -> Path:
        if kind not in SUPPORTED_KINDS:
            raise LibraryValidationError("Unsupported library record kind.")
        return self.root_dir / kind

    def _custom_record_path(self, kind: str, record_id: str) -> Path:
        safe_id = "".join(ch for ch in str(record_id or "") if ch.isalnum() or ch in {"-", "_"})
        if not safe_id:
            raise LibraryValidationError("Invalid record id.")
        return self._kind_dir(kind) / f"{safe_id}.json"

    def _read_json(self, path: Path) -> dict[str, Any]:
        try:
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except FileNotFoundError as exc:
            raise LibraryNotFound("Record not found.") from exc
        except json.JSONDecodeError as exc:
            raise LibraryValidationError(f"Library record is corrupted: {path.name}") from exc

        if not isinstance(payload, dict):
            raise LibraryValidationError(f"Library record must be a JSON object: {path.name}")
        return payload

    def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)

    def _normalize_record(self, kind: str, payload: dict[str, Any], *, scope: str, record_id: str | None = None) -> dict[str, Any]:
        snapshot = validate_snapshot(payload.get("snapshot"))
        created_at = str(payload.get("created_at") or utc_iso_now())
        updated_at = str(payload.get("updated_at") or created_at)
        normalized = {
            "id": record_id or str(payload.get("id") or ""),
            "kind": "map" if kind == "maps" else "race",
            "scope": scope,
            "name": clean_text(payload.get("name"), default_record_name(kind)),
            "author": clean_text(payload.get("author"), "Skipper"),
            "description": clean_text(payload.get("description"), ""),
            "created_at": created_at,
            "updated_at": updated_at,
            "tags": normalize_tags(payload.get("tags")),
            "sort_index": int(payload.get("sort_index") or 999),
            "meta": payload.get("meta") if isinstance(payload.get("meta"), dict) else {},
            "summary": payload.get("summary") if isinstance(payload.get("summary"), dict) else summarize_snapshot(snapshot),
            "snapshot": snapshot,
        }

        if not normalized["id"]:
            raise LibraryValidationError("Library record id is missing.")
        return normalized

    def _load_standard_maps(self) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        if not self.standard_maps_dir.exists():
            return records

        for path in sorted(self.standard_maps_dir.glob("*.json")):
            payload = self._read_json(path)
            record_id = str(payload.get("id") or path.stem)
            record = self._normalize_record("maps", payload, scope="standard", record_id=record_id)
            records.append(record)
        return records

    def list_records(self, kind: str) -> list[dict[str, Any]]:
        standard_records: list[dict[str, Any]] = []
        if kind == "maps":
            standard_records.extend(trim_record(record) for record in self._load_standard_maps())
            standard_records.sort(key=lambda item: int(item.get("sort_index") or 999))

        custom_records: list[dict[str, Any]] = []
        custom_dir = self._kind_dir(kind)
        for path in sorted(custom_dir.glob("*.json"), reverse=True):
            payload = self._read_json(path)
            record = self._normalize_record(kind, payload, scope="custom", record_id=path.stem)
            custom_records.append(trim_record(record))

        custom_records.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        return standard_records + custom_records

    def get_record(self, kind: str, record_id: str) -> dict[str, Any]:
        if kind == "maps":
            for record in self._load_standard_maps():
                if record["id"] == record_id:
                    return record

        path = self._custom_record_path(kind, record_id)
        payload = self._read_json(path)
        return self._normalize_record(kind, payload, scope="custom", record_id=path.stem)

    def save_record(
        self,
        kind: str,
        *,
        name: Any,
        snapshot: Any,
        author: Any = "",
        description: Any = "",
        tags: Any = None,
        meta: Any = None,
    ) -> dict[str, Any]:
        snapshot = validate_snapshot(snapshot)
        now = utc_iso_now()
        entity_prefix = "map" if kind == "maps" else "race"
        record_id = f"{entity_prefix}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(3)}"
        record = {
            "id": record_id,
            "kind": entity_prefix,
            "scope": "custom",
            "name": clean_text(name, default_record_name(kind)),
            "author": clean_text(author, "Skipper"),
            "description": clean_text(description, ""),
            "created_at": now,
            "updated_at": now,
            "tags": normalize_tags(tags),
            "sort_index": 999,
            "meta": meta if isinstance(meta, dict) else {},
            "summary": summarize_snapshot(snapshot),
            "snapshot": snapshot,
        }
        self._write_json(self._custom_record_path(kind, record_id), record)
        return record

    def delete_record(self, kind: str, record_id: str) -> None:
        if kind == "maps":
            for record in self._load_standard_maps():
                if record["id"] == record_id:
                    raise LibraryForbidden("Standard maps cannot be deleted.")

        path = self._custom_record_path(kind, record_id)
        if not path.exists():
            raise LibraryNotFound("Record not found.")
        path.unlink()
