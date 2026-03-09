from flask_session import Session
from flask_socketio import SocketIO

session_ext = Session()
socketio = SocketIO(cors_allowed_origins="*", manage_session=False)
