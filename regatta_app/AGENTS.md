# Regatta Backend Guide

Use this file for work inside `regatta_app/`.

## Module map

- `factory.py`: app creation, config load, Redis/session/socket wiring, store registration
- `config.py`: env-driven config and local defaults
- `routes.py` and `api/*.py`: blueprints and HTTP routes
- `error_handlers.py`: JSON error mapping for room/library errors
- `session_state.py`: Flask session wrapper for `room_code`, `player_token`, `display_name`
- `room_service.py`: create/join/leave/start orchestration
- `room_store.py`: room persistence, validation, seat assignment, host transfer, public room view
- `room_events.py`: Socket.IO broadcast helpers
- `sockets.py`: socket handlers and background realtime loop
- `game_state.py`: room-level normalization and shared view settings
- `realtime_engine.py`: realtime movement, weather, collisions, penalties, rounding
- `library_store.py`: map/race persistence and standard map loading

## Request and room lifecycle

1. `POST /api/rooms`
   - `room_service.create_room_from_payload()`
   - `RoomStore.create_room()`
   - `bind_room_session()`
2. `POST /api/rooms/join`
   - `room_service.join_room_from_payload()`
   - `RoomStore.join_room()`
   - `bind_room_session()`
3. `POST /api/rooms/<code>/start`
   - `room_service.start_room_match()`
   - `game_state.normalize_room_start_state()`
   - status switches from `lobby` to `live`
4. Socket session
   - `room:join_socket` joins the Socket.IO room and emits `room:snapshot`
   - `room:push_state` is for turn snapshots or lobby preview edits
   - `room:control` is for realtime cursor-style control
   - `room:view_settings` syncs host-controlled shared hints
5. Broadcasts
   - `room:presence` for roster/lobby presence changes
   - `room:snapshot` for initial room state
   - `room:state_updated` for game-state changes

## Persistence and validation rules

- Redis room key prefix: `regatta:v2:room:`
- Without Redis, `RoomStore` uses in-memory storage for the current process only
- Flask sessions use `manage_session=False` on Socket.IO, so browser session data stays owned by Flask-Session
- Room size must stay within `2..20`
- `room_store.validate_game_state()` requires:
  - JSON object payload
  - UTF-8 payload <= `500_000` bytes
  - `boats` list length equal to room `max_players`
  - valid `race.currentPlayer`
- `library_store.validate_snapshot()` applies a similar payload cap and boat-count validation
- Standard maps in `regatta_app/standard_maps/` can be listed and loaded but not deleted

## Important behavior to preserve

- `public_room_view()` strips player tokens and only exposes viewer-safe room data
- Host observer mode changes total room capacity and seat allocation rules
- On host leave, host ownership is reassigned to the earliest suitable remaining player
- `hybrid` is normalized differently depending on phase:
  - lobby preview behaves like turn mode
  - live server start normalizes hybrid/realtime into the realtime loop path
- `room_requires_live_loop()` is true only for live realtime play or live auto-gust weather ticks

## Common edit hotspots

- Room creation/join/start policy: `room_service.py`, `room_store.py`
- Payload validation and shape changes: `room_store.py`, `library_store.py`
- Shared room rendering contract: `room_store.public_room_view()`
- Socket event changes: `sockets.py`, `room_events.py`, `static/multiplayer.js`
- Realtime behavior: `game_state.py`, `realtime_engine.py`, `sockets.py`

## Quick checks after backend changes

- `GET /healthz`
- create room -> join room -> start room flow
- load/save/delete custom maps or races when touching `library_store.py`
- verify that the frontend still matches the room payload shape if you changed response fields
