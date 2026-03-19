---
name: "regatta-python-backend"
description: "Use when editing Flask, Socket.IO, Redis-backed session, room, library, or realtime Python code in Regatta, especially files under regatta_app/ and app.py. Use it to keep backend changes small, typed, contract-safe, and aligned with room payload validation and frontend expectations."
---

# Regatta Python Backend

Use this skill for Python changes in `app.py` and `regatta_app/`.

## First context

1. Read `AGENTS.md`.
2. Read `regatta_app/AGENTS.md`.
3. Read only the target module and its immediate collaborators before editing.

## Choose the narrowest seam

Start from the smallest module that owns the behavior:

- app wiring or extension setup: `factory.py`, `extensions.py`, `config.py`
- REST endpoint behavior: `api/*.py`
- room lifecycle and session ownership: `room_service.py`, `room_store.py`, `session_state.py`
- Socket.IO behavior and realtime loops: `sockets.py`, `room_events.py`
- game-state normalization: `game_state.py`
- realtime simulation rules: `realtime_engine.py`
- map/race persistence: `library_store.py`

Avoid broad refactors when a single helper or validation change will do.

## Backend rules for this repo

- Preserve the public room payload contract from `room_store.public_room_view()`.
- Preserve the payload size and boat-count validation rules unless the task explicitly changes them.
- Keep player tokens private. Never expose internal tokens in public responses.
- Raise domain errors from backend layers using the existing error families:
  - `RoomStoreError` subclasses for room and socket-related validation
  - `LibraryStoreError` subclasses for library validation
- Let `error_handlers.py` map those errors to JSON responses instead of hand-rolling new response shapes everywhere.
- Be deliberate with mutable state:
  - use `deepcopy()` only where room or game-state mutation boundaries require it
  - avoid accidental in-place edits to data that should be treated as snapshots
- Keep Redis optional. Local development without `REDIS_URL` must still work.

## Python code quality expectations

- Add or preserve type hints on public functions and non-trivial helpers.
- Prefer small pure helpers for normalization, validation, and derived values.
- Keep side effects explicit and close to the boundary layer that owns them.
- Prefer existing data shapes and naming. In Python, keep `snake_case`; only preserve camelCase where the browser contract already requires it inside JSON payloads.
- Do not introduce new frameworks, ORMs, or architectural layers.
- Avoid broad `except Exception` unless the code is at an integration boundary where failure is intentionally tolerated, such as health probes.
- When touching Flask app state, prefer the existing `current_app.extensions[...]` access pattern over adding globals.

## Cross-file coordination

If you change any of these, inspect the browser side before finishing:

- room payload fields
- socket event names or semantics
- shared view settings
- bootstrap response shape
- start/join/create room behavior

The matching client logic is usually in `static/multiplayer.js` and sometimes `static/game_shell.js` or `static/regatta.js`.

## Verification checklist

- Run the smallest relevant check, not a generic full sweep.
- Always verify `GET /healthz` after app/config/wiring changes.
- For room-flow changes, cover:
  - create room
  - join room
  - leave room
  - start room
- For library changes, cover:
  - list
  - load
  - save
  - delete custom records
- For realtime changes, also inspect the corresponding JS control or room-sync path.

## Finish line

Before concluding:

- confirm the changed backend module still owns the behavior cleanly
- confirm any frontend contract changes were mirrored or intentionally avoided
- mention the specific verification you ran and what you did not run
