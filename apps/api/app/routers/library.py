from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from ..dependencies import get_legacy_bridge
from ..legacy import LegacyBridge, proxy_response
from ..schemas import ApiError


class SaveLibraryRecordRequest(BaseModel):
    name: str | None = None
    snapshot: dict[str, Any]
    author: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    meta: dict[str, Any] | None = None

    model_config = ConfigDict(extra="allow")


router = APIRouter(prefix="/library", tags=["library"])


@router.get("/maps", responses={400: {"model": ApiError}, 500: {"model": ApiError}})
def list_maps(
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> dict[str, Any] | Response:
    legacy_response = bridge.request(request, "GET", "/api/library/maps")
    if legacy_response.is_success:
        return legacy_response.json()
    return proxy_response(legacy_response)


@router.get("/maps/{record_id}", responses={400: {"model": ApiError}, 404: {"model": ApiError}, 500: {"model": ApiError}})
def get_map(
    record_id: str,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> dict[str, Any] | Response:
    legacy_response = bridge.request(request, "GET", f"/api/library/maps/{record_id}")
    if legacy_response.is_success:
        return legacy_response.json()
    return proxy_response(legacy_response)


@router.post("/maps", responses={400: {"model": ApiError}, 500: {"model": ApiError}})
def save_map(
    payload: SaveLibraryRecordRequest,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> dict[str, Any] | Response:
    legacy_response = bridge.request(
        request,
        "POST",
        "/api/library/maps",
        json_body=payload.model_dump(exclude_none=True),
    )
    if legacy_response.is_success:
        return legacy_response.json()
    return proxy_response(legacy_response)


@router.delete("/maps/{record_id}", responses={400: {"model": ApiError}, 404: {"model": ApiError}, 500: {"model": ApiError}})
def delete_map(
    record_id: str,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> dict[str, Any] | Response:
    legacy_response = bridge.request(request, "DELETE", f"/api/library/maps/{record_id}")
    if legacy_response.is_success:
        return legacy_response.json()
    return proxy_response(legacy_response)


@router.get("/races", responses={400: {"model": ApiError}, 500: {"model": ApiError}})
def list_races(
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> dict[str, Any] | Response:
    legacy_response = bridge.request(request, "GET", "/api/library/races")
    if legacy_response.is_success:
        return legacy_response.json()
    return proxy_response(legacy_response)


@router.get("/races/{record_id}", responses={400: {"model": ApiError}, 404: {"model": ApiError}, 500: {"model": ApiError}})
def get_race(
    record_id: str,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> dict[str, Any] | Response:
    legacy_response = bridge.request(request, "GET", f"/api/library/races/{record_id}")
    if legacy_response.is_success:
        return legacy_response.json()
    return proxy_response(legacy_response)


@router.post("/races", responses={400: {"model": ApiError}, 500: {"model": ApiError}})
def save_race(
    payload: SaveLibraryRecordRequest,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> dict[str, Any] | Response:
    legacy_response = bridge.request(
        request,
        "POST",
        "/api/library/races",
        json_body=payload.model_dump(exclude_none=True),
    )
    if legacy_response.is_success:
        return legacy_response.json()
    return proxy_response(legacy_response)


@router.delete("/races/{record_id}", responses={400: {"model": ApiError}, 404: {"model": ApiError}, 500: {"model": ApiError}})
def delete_race(
    record_id: str,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> dict[str, Any] | Response:
    legacy_response = bridge.request(request, "DELETE", f"/api/library/races/{record_id}")
    if legacy_response.is_success:
        return legacy_response.json()
    return proxy_response(legacy_response)
