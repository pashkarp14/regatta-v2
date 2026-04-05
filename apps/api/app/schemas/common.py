from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ApiError(BaseModel):
    error: str


class HealthResponse(BaseModel):
    status: str
    version: str
    redis: bool
    redis_backend: str
    session_backend: str
    metrics_enabled: bool
    structured_logs: bool
    client_telemetry_enabled: bool

    model_config = ConfigDict(extra="allow")
