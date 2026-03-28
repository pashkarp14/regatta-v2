from __future__ import annotations

from collections.abc import Mapping
import logging
from pathlib import Path
from typing import Any

from flask import Flask
from redis import Redis

from .config import get_config
from .error_handlers import register_error_handlers
from .extensions import session_ext, socketio
from .library_store import LibraryStore
from .locked_room_store import LockedRoomStore
from .observability import configure_json_logging, log_event, register_observability
from .routes import bp as main_bp
from .sockets import register_socket_handlers


def build_redis_client(app: Flask) -> Redis | None:
    redis_url = app.config.get("REDIS_URL")
    if not redis_url:
        return None
    return Redis.from_url(redis_url, decode_responses=False)


def build_asset_version(app: Flask) -> str:
    base_version = str(app.config.get("APP_VERSION", "dev"))
    static_root = Path(app.static_folder or "")
    if not static_root.exists():
        return base_version

    latest_mtime_ns = 0
    for path in static_root.rglob("*"):
        if not path.is_file() or path.suffix not in {".js", ".css"}:
            continue
        latest_mtime_ns = max(latest_mtime_ns, path.stat().st_mtime_ns)

    return f"{base_version}-{latest_mtime_ns}" if latest_mtime_ns else base_version


def configure_logging(app: Flask) -> None:
    level_name = str(app.config.get("APP_LOG_LEVEL", "INFO")).upper()
    level = getattr(logging, level_name, logging.INFO)
    app.logger.setLevel(level)
    if not app.logger.handlers:
        app.logger.addHandler(logging.StreamHandler())
    for handler in app.logger.handlers:
        handler.setLevel(level)
    configure_json_logging(app)


def create_app(config_overrides: Mapping[str, Any] | None = None) -> Flask:
    app = Flask(__name__, static_folder="../static", template_folder="../templates")
    app.config.from_object(get_config())
    if config_overrides:
        app.config.update(config_overrides)
        if "SESSION_TYPE" not in config_overrides:
            app.config["SESSION_TYPE"] = "redis" if app.config.get("REDIS_URL") else "filesystem"
    app.config["ASSET_VERSION"] = build_asset_version(app)
    configure_logging(app)

    redis_client = build_redis_client(app)
    if redis_client is not None:
        app.config["SESSION_REDIS"] = redis_client

    session_ext.init_app(app)
    socketio.init_app(
        app,
        async_mode=app.config["SOCKETIO_ASYNC_MODE"],
        message_queue=app.config["REDIS_URL"] or None,
    )

    app.extensions["redis_client"] = redis_client
    app.extensions["room_store"] = LockedRoomStore(redis_client, app.config["ROOM_TTL_SECONDS"])
    app.extensions["library_store"] = LibraryStore(
        app.config["LIBRARY_DIR"],
        app.config["STANDARD_MAPS_DIR"],
    )
    app.extensions["socketio"] = socketio

    register_observability(app)
    register_error_handlers(app)
    app.register_blueprint(main_bp)
    register_socket_handlers()
    log_event(
        app.logger,
        "app.startup",
        version=app.config["APP_VERSION"],
        redis_enabled=redis_client is not None,
        metrics_enabled=bool(app.config.get("METRICS_ENABLED")),
        structured_logs=bool(app.config.get("STRUCTURED_LOGS")),
        client_telemetry=bool(app.config.get("CLIENT_TELEMETRY_ENABLED")),
    )
    return app
