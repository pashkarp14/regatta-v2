from __future__ import annotations

from flask import Flask, jsonify

from .library_store import LibraryStoreError
from .room_store import RoomStoreError


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(RoomStoreError)
    def handle_room_store_error(exc: RoomStoreError):
        return jsonify({"error": str(exc)}), exc.status_code

    @app.errorhandler(LibraryStoreError)
    def handle_library_store_error(exc: LibraryStoreError):
        return jsonify({"error": str(exc)}), exc.status_code
