from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from .rooms import RoomView


class ObservabilitySettings(BaseModel):
    client_telemetry_enabled: bool

    model_config = ConfigDict(extra="allow")


class BootstrapResponse(BaseModel):
    version: str
    asset_version: str
    display_name: str | None = None
    observability: ObservabilitySettings
    room: RoomView | None = None

    model_config = ConfigDict(extra="allow")
