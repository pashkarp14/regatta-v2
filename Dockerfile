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

CMD ["sh", "-c", "gunicorn --worker-class ${GUNICORN_WORKER_CLASS:-gthread} --workers ${GUNICORN_WORKERS:-1} --threads ${GUNICORN_THREADS:-32} --bind 0.0.0.0:${PORT:-5001} app:app"]
