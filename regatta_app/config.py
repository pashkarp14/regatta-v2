from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent


class Config:
    APP_NAME = "Парусная регата"
    APP_VERSION = os.getenv("APP_VERSION", "2.0.0")
    PORT = int(os.getenv("PORT", "5001"))
    SECRET_KEY = os.getenv("SECRET_KEY", "regatta-v2-dev-secret")

    REDIS_URL = os.getenv("REDIS_URL", "")
    ROOM_TTL_SECONDS = int(os.getenv("ROOM_TTL_SECONDS", "86400"))

    SESSION_TYPE = "redis" if REDIS_URL else "filesystem"
    SESSION_FILE_DIR = str(BASE_DIR / ".flask_session")
    SESSION_PERMANENT = False
    SESSION_USE_SIGNER = True
    SESSION_KEY_PREFIX = "regatta:v2:session:"

    SOCKETIO_ASYNC_MODE = os.getenv("SOCKETIO_ASYNC_MODE", "threading")
    LIBRARY_DIR = os.getenv("LIBRARY_DIR", str(BASE_DIR / ".regatta_library"))
    STANDARD_MAPS_DIR = os.getenv("STANDARD_MAPS_DIR", str(BASE_DIR / "regatta_app" / "standard_maps"))
