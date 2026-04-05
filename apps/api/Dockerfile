FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv/app

COPY requirements.txt /srv/app/requirements.txt
COPY apps/api/requirements.txt /srv/app/apps/api/requirements.txt
RUN pip install --no-cache-dir -r /srv/app/apps/api/requirements.txt

COPY regatta_app /srv/app/regatta_app
COPY static /srv/app/static
COPY templates /srv/app/templates
COPY apps /srv/app/apps

EXPOSE 8000

CMD ["uvicorn", "apps.api.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
