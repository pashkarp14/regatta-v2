FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=5001

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./
COPY regatta_app ./regatta_app
COPY templates ./templates
COPY static ./static

EXPOSE 5001

CMD ["sh", "-c", "export SOCKETIO_PING_INTERVAL=${SOCKETIO_PING_INTERVAL:-25}; export SOCKETIO_PING_TIMEOUT=${SOCKETIO_PING_TIMEOUT:-60}; WORKER_CLASS=${GUNICORN_WORKER_CLASS:-geventwebsocket.gunicorn.workers.GeventWebSocketWorker}; if [ \"$WORKER_CLASS\" = \"gthread\" ]; then export SOCKETIO_ASYNC_MODE=${SOCKETIO_ASYNC_MODE:-threading}; exec gunicorn --worker-class \"$WORKER_CLASS\" --workers ${GUNICORN_WORKERS:-1} --threads ${GUNICORN_THREADS:-32} --bind 0.0.0.0:${PORT:-5001} app:app; else export SOCKETIO_ASYNC_MODE=${SOCKETIO_ASYNC_MODE:-gevent}; exec gunicorn --worker-class \"$WORKER_CLASS\" --workers ${GUNICORN_WORKERS:-1} --bind 0.0.0.0:${PORT:-5001} app:app; fi"]
