from .factory import create_app
from .extensions import socketio

app = create_app()

__all__ = ["app", "create_app", "socketio"]
