from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from ..dependencies import get_legacy_bridge
from ..legacy import LegacyBridge, proxy_response
from ..schemas import (
    ApiError,
    CreateRoomRequest,
    JoinRoomRequest,
    KickRoomRequest,
    LeaveRoomResponse,
    RoomEnvelope,
    StartRoomRequest,
)


router = APIRouter(prefix="/rooms", tags=["rooms"])


@router.post(
    "",
    response_model=RoomEnvelope,
    responses={400: {"model": ApiError}, 403: {"model": ApiError}, 500: {"model": ApiError}},
)
def create_room(
    payload: CreateRoomRequest,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> RoomEnvelope | Response:
    legacy_response = bridge.request(
        request,
        "POST",
        "/api/rooms",
        json_body=payload.model_dump(exclude_none=True),
    )
    if legacy_response.is_success:
        return RoomEnvelope.model_validate(legacy_response.json())
    return proxy_response(legacy_response)


@router.post(
    "/join",
    response_model=RoomEnvelope,
    responses={400: {"model": ApiError}, 403: {"model": ApiError}, 404: {"model": ApiError}, 500: {"model": ApiError}},
)
def join_room(
    payload: JoinRoomRequest,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> RoomEnvelope | Response:
    legacy_response = bridge.request(
        request,
        "POST",
        "/api/rooms/join",
        json_body=payload.model_dump(exclude_none=True),
    )
    if legacy_response.is_success:
        return RoomEnvelope.model_validate(legacy_response.json())
    return proxy_response(legacy_response)


@router.post(
    "/leave",
    response_model=LeaveRoomResponse,
    responses={400: {"model": ApiError}, 403: {"model": ApiError}, 500: {"model": ApiError}},
)
def leave_room(
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> LeaveRoomResponse | Response:
    legacy_response = bridge.request(request, "POST", "/api/rooms/leave")
    if legacy_response.is_success:
        return LeaveRoomResponse.model_validate(legacy_response.json())
    return proxy_response(legacy_response)


@router.get(
    "/{room_code}",
    response_model=RoomEnvelope,
    responses={400: {"model": ApiError}, 404: {"model": ApiError}, 500: {"model": ApiError}},
)
def get_room(
    room_code: str,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> RoomEnvelope | Response:
    legacy_response = bridge.request(request, "GET", f"/api/rooms/{room_code}")
    if legacy_response.is_success:
        return RoomEnvelope.model_validate(legacy_response.json())
    return proxy_response(legacy_response)


@router.post(
    "/{room_code}/start",
    response_model=RoomEnvelope,
    responses={400: {"model": ApiError}, 403: {"model": ApiError}, 404: {"model": ApiError}, 500: {"model": ApiError}},
)
def start_room(
    room_code: str,
    payload: StartRoomRequest,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> RoomEnvelope | Response:
    legacy_response = bridge.request(
        request,
        "POST",
        f"/api/rooms/{room_code}/start",
        json_body=payload.model_dump(exclude_none=True),
    )
    if legacy_response.is_success:
        return RoomEnvelope.model_validate(legacy_response.json())
    return proxy_response(legacy_response)


@router.post(
    "/{room_code}/edit",
    response_model=RoomEnvelope,
    responses={400: {"model": ApiError}, 403: {"model": ApiError}, 404: {"model": ApiError}, 500: {"model": ApiError}},
)
def edit_room(
    room_code: str,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> RoomEnvelope | Response:
    legacy_response = bridge.request(request, "POST", f"/api/rooms/{room_code}/edit")
    if legacy_response.is_success:
        return RoomEnvelope.model_validate(legacy_response.json())
    return proxy_response(legacy_response)


@router.post(
    "/{room_code}/reset-lobby",
    response_model=RoomEnvelope,
    responses={400: {"model": ApiError}, 403: {"model": ApiError}, 404: {"model": ApiError}, 500: {"model": ApiError}},
)
def reset_lobby(
    room_code: str,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> RoomEnvelope | Response:
    legacy_response = bridge.request(request, "POST", f"/api/rooms/{room_code}/reset-lobby")
    if legacy_response.is_success:
        return RoomEnvelope.model_validate(legacy_response.json())
    return proxy_response(legacy_response)


@router.post(
    "/{room_code}/kick",
    response_model=RoomEnvelope,
    responses={400: {"model": ApiError}, 403: {"model": ApiError}, 404: {"model": ApiError}, 500: {"model": ApiError}},
)
def kick_room_player(
    room_code: str,
    payload: KickRoomRequest,
    request: Request,
    bridge: LegacyBridge = Depends(get_legacy_bridge),
) -> RoomEnvelope | Response:
    legacy_response = bridge.request(
        request,
        "POST",
        f"/api/rooms/{room_code}/kick",
        json_body=payload.model_dump(exclude_none=True),
    )
    if legacy_response.is_success:
        return RoomEnvelope.model_validate(legacy_response.json())
    return proxy_response(legacy_response)
