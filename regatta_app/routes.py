from __future__ import annotations

from flask import Blueprint

from .api import library_bp, pages_bp, rooms_bp, telemetry_bp


bp = Blueprint("main", __name__)
bp.register_blueprint(pages_bp)
bp.register_blueprint(library_bp)
bp.register_blueprint(rooms_bp)
bp.register_blueprint(telemetry_bp)


__all__ = ["bp"]
