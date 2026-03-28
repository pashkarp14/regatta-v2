from __future__ import annotations

from typing import Any

from flask import Blueprint, current_app, request

from ..observability import client_telemetry_enabled, log_event, observe_client_telemetry_batch, payload_bytes


bp = Blueprint("telemetry", __name__)


def json_payload() -> dict[str, Any]:
    return request.get_json(silent=True) or {}


@bp.post("/api/telemetry")
def ingest_telemetry():
    if not client_telemetry_enabled():
        return {"accepted": 0, "enabled": False}, 202

    payload = json_payload()
    raw_events = payload.get("events")
    events = raw_events if isinstance(raw_events, list) else []
    normalized_events = [event for event in events if isinstance(event, dict)][:200]
    accepted = observe_client_telemetry_batch(normalized_events)
    log_event(
        current_app.logger,
        "client.telemetry",
        accepted=accepted,
        received=len(events),
        payload_bytes=payload_bytes(payload),
    )
    return {"accepted": accepted, "enabled": True}, 202
