from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from ..dependencies import get_legacy_bridge
from ..legacy import LegacyBridge, proxy_response
from ..schemas import ApiError


class TelemetryRequest(BaseModel):
    events: list[dict[str, Any]] = Field(default_factory=list)

    model_config = ConfigDict(extra="allow")


router = APIRouter(tags=["telemetry"])


@router.post("/telemetry", responses={202: {"description": "Accepted"}, 500: {"model": ApiError}})
def ingest_telemetry(
    payload: TelemetryRequest,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> dict[str, Any] | Response:
    legacy_response = bridge.request(
        request,
        "POST",
        "/api/telemetry",
        json_body=payload.model_dump(exclude_none=True),
    )
    if legacy_response.is_success:
        return legacy_response.json()
    return proxy_response(legacy_response)
