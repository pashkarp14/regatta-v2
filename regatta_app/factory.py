from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from flask import Flask
from redis import Redis

from .config import get_config
from .error_handlers import register_error_handlers
from .extensions import session_ext, socketio
from .library_store import LibraryStore
from .room_store import RoomStore
from .routes import bp as main_bp
from .sockets import register_socket_handlers


def build_redis_client(app: Flask) -> Redis | None:
    redis_url = app.config.get("REDIS_URL")
    if not redis_url:
        return None
    # Flask-Session stores binary payloads in Redis, so responses must stay as bytes.
    return Redis.from_url(redis_url, decode_responses=False)


def create_app(config_overrides: Mapping[str, Any] | None = None) -> Flask:
    app = Flask(__name__, static_folder="../static", template_folder="../templates")
    app.config.from_object(get_config())
    if config_overrides:
        app.config.update(config_overrides)
        if "SESSION_TYPE" not in config_overrides:
            app.config["SESSION_TYPE"] = "redis" if app.config.get("REDIS_URL") else "filesystem"

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
    app.extensions["room_store"] = RoomStore(redis_client, app.config["ROOM_TTL_SECONDS"])
    app.extensions["library_store"] = LibraryStore(
        app.config["LIBRARY_DIR"],
        app.config["STANDARD_MAPS_DIR"],
    )
    app.extensions["socketio"] = socketio

    register_error_handlers(app)
    app.register_blueprint(main_bp)
    register_socket_handlers()
    return app
