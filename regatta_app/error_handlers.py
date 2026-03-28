from __future__ import annotations

from flask import Flask, jsonify

from .observability import log_event, observe_error
from .library_store import LibraryStoreError
from .room_store import RoomStoreError


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(RoomStoreError)
    def handle_room_store_error(exc: RoomStoreError):
        observe_error("http", type(exc).__name__)
        log_event(app.logger, "http.error", level=40, kind=type(exc).__name__, source="room_store", error=str(exc))
        return jsonify({"error": str(exc)}), exc.status_code

    @app.errorhandler(LibraryStoreError)
    def handle_library_store_error(exc: LibraryStoreError):
        observe_error("http", type(exc).__name__)
        log_event(app.logger, "http.error", level=40, kind=type(exc).__name__, source="library_store", error=str(exc))
        return jsonify({"error": str(exc)}), exc.status_code
