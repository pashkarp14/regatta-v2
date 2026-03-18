from __future__ import annotations

from typing import Any

from flask import Blueprint, request

from ..app_state import library_store
from ..session_state import display_name as session_display_name


bp = Blueprint("library", __name__)


def json_payload() -> dict[str, Any]:
    return request.get_json(silent=True) or {}


def save_library_record(kind: str, response_key: str) -> dict[str, Any]:
    payload = json_payload()
    record = library_store().save_record(
        kind,
        name=payload.get("name"),
        snapshot=payload.get("snapshot"),
        author=payload.get("author") or session_display_name() or "Skipper",
        description=payload.get("description"),
        tags=payload.get("tags"),
        meta=payload.get("meta"),
    )
    return {response_key: record}


@bp.get("/api/library/maps")
def list_maps():
    return {"maps": library_store().list_records("maps")}


@bp.get("/api/library/maps/<record_id>")
def get_map(record_id: str):
    return {"map": library_store().get_record("maps", record_id)}


@bp.post("/api/library/maps")
def save_map():
    return save_library_record("maps", "map")


@bp.delete("/api/library/maps/<record_id>")
def delete_map(record_id: str):
    library_store().delete_record("maps", record_id)
    return {"deleted": True}


@bp.get("/api/library/races")
def list_races():
    return {"races": library_store().list_records("races")}


@bp.get("/api/library/races/<record_id>")
def get_race(record_id: str):
    return {"race": library_store().get_record("races", record_id)}


@bp.post("/api/library/races")
def save_race():
    return save_library_record("races", "race")


@bp.delete("/api/library/races/<record_id>")
def delete_race(record_id: str):
    library_store().delete_record("races", record_id)
    return {"deleted": True}
