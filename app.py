import os

from regatta_app import app, socketio


if __name__ == "__main__":
    debug_enabled = os.getenv("FLASK_DEBUG", "0") == "1"
    use_reloader = os.getenv("FLASK_USE_RELOADER", "0") == "1"
    socketio.run(
        app,
        host="0.0.0.0",
        port=app.config["PORT"],
        debug=debug_enabled,
        use_reloader=use_reloader,
        allow_unsafe_werkzeug=True,
    )
