# Regatta Project Guide

Start here before scanning the repo. This file is intentionally compact and points to the smallest next context file to open.

## First reads

- Backend, REST, Socket.IO, room lifecycle, Redis/session behavior: `regatta_app/AGENTS.md`
- Frontend shell, browser networking, CSS, DOM contracts: `static/AGENTS.md`
- Gameplay bundle, physics, AI, rendering, section workflow: `static/regatta_src/AGENTS.md`
- HTML shell structure and script loading order: `templates/AGENTS.md`
- Repo-local skills for code-writing tasks: `.agents/skills/`

## Repo-local skills

- `regatta-python-backend`: use for Flask/Socket.IO/Redis Python work in `regatta_app/` and `app.py`
- `regatta-javascript-frontend`: use for browser code in `static/` and `templates/`

## Architecture at a glance

- App entrypoint: `app.py`
- Flask app factory and extension wiring: `regatta_app/factory.py`
- Single-page HTML shell: `templates/index.html`
- Browser runtime load order:
  - `static/vendor/socket.io.min.js`
  - `static/regatta.js`
  - `static/multiplayer.js`
  - `static/game_shell.js`
- Optional Redis:
  - with `REDIS_URL`, rooms are stored in Redis and Flask sessions use Redis
  - without `REDIS_URL`, rooms fall back to in-process memory and Flask sessions use `.flask_session/`
- Custom library data lives in `.regatta_library/maps/` and `.regatta_library/races/`
- Standard maps live in `regatta_app/standard_maps/`

## Source of truth

- Gameplay/runtime logic: edit `static/regatta_src/sections/*.js`, then rebuild `static/regatta.js`
- Main menu, launch flow, command deck orchestration: `static/game_shell.js`
- Browser-side room state, REST calls, Socket.IO bridge: `static/multiplayer.js`
- DOM structure and element ids: `templates/index.html`
- Shared styling: `static/regatta.css`
- Vendored code in `static/vendor/` should not be edited by default

These paths are usually artifacts or history, not the primary source for product behavior:

- `.venv/`
- `__pycache__/`
- `.flask_session/`
- `.regatta_library/`
- `output/`
- `output_ui_checks/`
- `server*.log`
- `progress.md`

## Commands

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python app.py
```

- Default app URL: `http://127.0.0.1:5001/`
- Health check: `GET /healthz`
- Docker: `docker compose up --build`
- Regatta bundle sync:

```powershell
.venv\Scripts\python tools\sync_regatta_sections.py build
.venv\Scripts\python tools\sync_regatta_sections.py verify
```

## Important contracts

- REST endpoints:
  - `GET /api/bootstrap`
  - `POST /api/rooms`
  - `POST /api/rooms/join`
  - `POST /api/rooms/leave`
  - `GET /api/rooms/<room_code>`
  - `POST /api/rooms/<room_code>/start`
  - `GET/POST/DELETE /api/library/maps...`
  - `GET/POST/DELETE /api/library/races...`
- Socket.IO events:
  - client -> server: `room:join_socket`, `room:push_state`, `room:control`, `room:view_settings`
  - server -> client: `room:error`, `room:presence`, `room:snapshot`, `room:state_updated`
- Browser custom events:
  - `regatta:state-changed`
  - `regatta:realtime-intent`
  - `regatta:view-settings-changed`
  - `regatta:room-state`
  - `regatta:room-draft`

## High-risk areas

- Any DOM id rename usually requires matching updates in `templates/index.html`, `static/regatta.js`, `static/multiplayer.js`, and/or `static/game_shell.js`
- Room snapshots must keep boat count equal to room `max_players` and stay under the backend payload limit
- `/healthz` exists; `/health` does not
- The repo may contain in-flight frontend edits, so check `git status` before changing shared UI files
