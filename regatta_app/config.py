from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent


class BaseConfig:
    APP_NAME = "Парусная регата"
    APP_VERSION = os.getenv("APP_VERSION", "2.0.0")
    APP_LOG_LEVEL = os.getenv("APP_LOG_LEVEL", "INFO")
    METRICS_ENABLED = os.getenv("METRICS_ENABLED", "0") == "1"
    STRUCTURED_LOGS = os.getenv("STRUCTURED_LOGS", "0") == "1"
    CLIENT_TELEMETRY_ENABLED = os.getenv("CLIENT_TELEMETRY_ENABLED", "0") == "1"
    REALTIME_TRACE_COLLISIONS = os.getenv("REALTIME_TRACE_COLLISIONS", "0") == "1"
    REALTIME_DEBUG_LOGS = os.getenv("REALTIME_DEBUG_LOGS", "0") == "1"
    SLOW_TICK_WARN_MS = int(os.getenv("SLOW_TICK_WARN_MS", "40"))
    PORT = int(os.getenv("PORT", "5001"))
    SECRET_KEY = os.getenv("SECRET_KEY", "regatta-v2-dev-secret")
    TESTING = False

    REDIS_URL = os.getenv("REDIS_URL", "")
    ROOM_TTL_SECONDS = int(os.getenv("ROOM_TTL_SECONDS", "86400"))

    SESSION_TYPE = "redis" if REDIS_URL else "filesystem"
    SESSION_FILE_DIR = str(BASE_DIR / ".flask_session")
    SESSION_PERMANENT = False
    SESSION_USE_SIGNER = True
    SESSION_KEY_PREFIX = "regatta:v2:session:"

    SOCKETIO_ASYNC_MODE = os.getenv("SOCKETIO_ASYNC_MODE", "threading")
    SOCKETIO_MESSAGE_QUEUE = os.getenv("SOCKETIO_MESSAGE_QUEUE", "")
    SOCKETIO_PING_INTERVAL = int(os.getenv("SOCKETIO_PING_INTERVAL", "25"))
    SOCKETIO_PING_TIMEOUT = int(os.getenv("SOCKETIO_PING_TIMEOUT", "60"))
    GUNICORN_WORKER_CLASS = os.getenv("GUNICORN_WORKER_CLASS", "gthread")
    GUNICORN_WORKERS = int(os.getenv("GUNICORN_WORKERS", "1"))
    GUNICORN_THREADS = int(os.getenv("GUNICORN_THREADS", "32"))
    LIBRARY_DIR = os.getenv("LIBRARY_DIR", str(BASE_DIR / ".regatta_library"))
    STANDARD_MAPS_DIR = os.getenv("STANDARD_MAPS_DIR", str(BASE_DIR / "regatta_app" / "standard_maps"))


class DevelopmentConfig(BaseConfig):
    pass


class TestingConfig(BaseConfig):
    TESTING = True
    REDIS_URL = ""
    SESSION_TYPE = "filesystem"


class ProductionConfig(BaseConfig):
    pass


Config = DevelopmentConfig

CONFIG_BY_ENV = {
    "dev": DevelopmentConfig,
    "development": DevelopmentConfig,
    "prod": ProductionConfig,
    "production": ProductionConfig,
    "test": TestingConfig,
    "testing": TestingConfig,
}


def get_config(env_name: str | None = None) -> type[BaseConfig]:
    selected_env = (env_name or os.getenv("APP_ENV", "development")).lower()
    return CONFIG_BY_ENV.get(selected_env, DevelopmentConfig)
