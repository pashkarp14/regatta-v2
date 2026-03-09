from regatta_app import app, socketio


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=app.config["PORT"], debug=True)
