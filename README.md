# Парусная регата

Проект находится в переходе от Flask-only монолита к разделенной архитектуре:

- legacy-контур на `Flask + Flask-SocketIO`
- новый backend-контур на `FastAPI`
- новый frontend-контур на `React + TypeScript`

## Текущее состояние

### Legacy runtime

Текущий рабочий монолит остается в корне репозитория:

- `app.py`
- `regatta_app/`
- `templates/`
- `static/`

Этот слой пока хранит действующую доменную и realtime-логику.

### Новый модульный контур

Новые приложения лежат в `apps/`:

- `apps/api` — новый `FastAPI`-backend c версионированным API `/api/v1`
- `apps/web` — новый `React` SPA-клиент

Подробная схема перехода описана в:

- `docs/architecture/fastapi-react-split.md`

## Локальный запуск legacy-приложения

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python app.py
```

Legacy-приложение откроется на `http://127.0.0.1:5001/`.

## Модульный деплой

1. Скопируй `.env.example` в `.env`.
2. Проверь `SECRET_KEY` и остальные переменные.
3. Запусти:

```bash
docker compose -f docker-compose.modular.yml up --build
```

После старта gateway будет доступен на `http://127.0.0.1:5001/`.

## Архитектурная идея

- frontend больше не зависит от Flask templates
- backend публикует стабильный внешний контракт через `FastAPI`
- legacy Flask используется как временный внутренний bridge для безопасной миграции
- realtime переносится отдельным этапом, чтобы не смешивать его с REST и UI migration
