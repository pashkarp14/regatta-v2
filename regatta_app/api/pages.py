from __future__ import annotations

from flask import Blueprint, current_app, render_template

from ..app_state import redis_client
from ..room_service import current_room
from ..room_store import public_room_view
from ..session_state import current_session_state


bp = Blueprint("pages", __name__)


@bp.get("/")
def index():
    html = render_template(
        "index.html",
        app_name=current_app.config["APP_NAME"],
        version=current_app.config["ASSET_VERSION"],
    )
    helper_script = f'\n  <script src="/static/game_session.js?v={current_app.config["ASSET_VERSION"]}"></script>\n'
    html = html.replace("</body>", f"{helper_script}</body>")
    response = current_app.make_response(html)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@bp.get("/healthz")
def healthz():
    redis = redis_client()
    redis_ok = False
    if redis is not None:
        try:
            redis_ok = bool(redis.ping())
        except Exception:
            redis_ok = False

    return {
        "status": "ok",
        "version": current_app.config["APP_VERSION"],
        "redis": redis_ok,
        "session_backend": current_app.config["SESSION_TYPE"],
    }


@bp.get("/api/bootstrap")
def bootstrap():
    session_state = current_session_state()
    room = current_room()
    return {
        "version": current_app.config["APP_VERSION"],
        "asset_version": current_app.config["ASSET_VERSION"],
        "display_name": session_state.display_name,
        "room": public_room_view(room, session_state.player_token) if room else None,
    }
