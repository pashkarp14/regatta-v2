from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from ..dependencies import get_legacy_bridge
from ..legacy import LegacyBridge, proxy_response
from ..schemas import ApiError, HealthResponse


router = APIRouter(tags=["system"])


@router.get(
    "/healthz",
    response_model=HealthResponse,
    responses={500: {"model": ApiError}},
)
def get_health(
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> HealthResponse | Response:
    legacy_response = bridge.request(request, "GET", "/healthz")
    if legacy_response.is_success:
        return HealthResponse.model_validate(legacy_response.json())
    return proxy_response(legacy_response)
