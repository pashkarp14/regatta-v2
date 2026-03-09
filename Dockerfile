FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./
COPY regatta_app ./regatta_app
COPY templates ./templates
COPY static ./static

EXPOSE 5000

CMD ["gunicorn", "--worker-class", "gthread", "--threads", "8", "--bind", "0.0.0.0:5000", "app:app"]
