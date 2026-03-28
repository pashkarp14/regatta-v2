from __future__ import annotations

from flask import current_app
from flask_socketio import SocketIO
from redis import Redis

from .library_store import LibraryStore
from .live_runtime import LiveRuntimeRegistry
from .room_store import RoomStore


def redis_client() -> Redis | None:
    return current_app.extensions.get("redis_client")


def room_store() -> RoomStore:
    return current_app.extensions["room_store"]


def live_runtime() -> LiveRuntimeRegistry:
    return current_app.extensions["live_runtime"]


def library_store() -> LibraryStore:
    return current_app.extensions["library_store"]


def socketio_ext() -> SocketIO:
    return current_app.extensions["socketio"]
