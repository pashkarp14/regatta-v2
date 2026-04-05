from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from ..dependencies import get_legacy_bridge
from ..legacy import LegacyBridge, proxy_response
from ..schemas import ApiError, BootstrapResponse


router = APIRouter(tags=["bootstrap"])


@router.get(
    "/bootstrap",
    response_model=BootstrapResponse,
    responses={400: {"model": ApiError}, 500: {"model": ApiError}},
)
def get_bootstrap(
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> BootstrapResponse | Response:
    legacy_response = bridge.request(request, "GET", "/api/bootstrap")
    if legacy_response.is_success:
        return BootstrapResponse.model_validate(legacy_response.json())
    return proxy_response(legacy_response)
