from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class RoomPlayer(BaseModel):
    player_id: str
    name: str
    seat_index: int | None = None
    is_host: bool
    is_self: bool
    is_observer: bool

    model_config = ConfigDict(extra="allow")


class RoomSelf(BaseModel):
    player_id: str | None = None
    name: str | None = None
    seat_index: int | None = None
    is_observer: bool
    token_present: bool

    model_config = ConfigDict(extra="allow")


class RoomView(BaseModel):
    code: str
    status: str
    server_time_ms: int
    max_players: int
    max_racers: int
    max_observers: int
    joined_count: int
    joined_racers_count: int
    joined_observers_count: int
    capacity: int
    start_ready: bool
    can_start: bool
    revision: int
    play_mode: str
    host_mode: str
    is_host: bool
    players: list[RoomPlayer]
    self: RoomSelf
    game_state: dict[str, Any] | None = None

    model_config = ConfigDict(extra="allow")


class RoomEnvelope(BaseModel):
    room: RoomView | None = None

    model_config = ConfigDict(extra="allow")


class CreateRoomRequest(BaseModel):
    display_name: str | None = None
    max_players: int = Field(default=2, ge=2, le=20)
    host_role: Literal["player", "observer"] = "player"
    game_state: dict[str, Any]

    model_config = ConfigDict(extra="allow")


class JoinRoomRequest(BaseModel):
    room_code: str
    display_name: str | None = None

    model_config = ConfigDict(extra="allow")


class StartRoomRequest(BaseModel):
    arm_realtime: bool = True
    game_state: dict[str, Any] | None = None

    model_config = ConfigDict(extra="allow")


class KickRoomRequest(BaseModel):
    player_id: str

    model_config = ConfigDict(extra="allow")


class LeaveRoomResponse(BaseModel):
    room: None = None

    model_config = ConfigDict(extra="allow")
