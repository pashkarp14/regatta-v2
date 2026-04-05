from __future__ import annotations

from fastapi import Request

from .legacy import LegacyBridge


def get_legacy_bridge(request: Request) -> LegacyBridge:
    return request.app.state.legacy_bridge
