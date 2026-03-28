# Regatta Room Sync and Runtime Ceiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the stand's join and live-room ceiling without a full rewrite by trimming duplicate room sync, making presence lightweight, and moving hot live mutations off per-tick Redis writes.

**Architecture:** Keep the current Flask plus Socket.IO shape, but deliver the work in phases. First tighten test and load-runner contracts, then slim the join and presence sync paths, then introduce a checkpointed in-memory live runtime while keeping `REALTIME_TICK_HZ = 12`. Do not ship multi-worker live defaults during this plan: `regatta_app/sockets.py` still keeps loop ownership, connected sockets, and control buffers in process-local memory.

**Tech Stack:** Flask, Flask-SocketIO, Redis, Gunicorn `gthread`, pytest, existing `tools/load` runner.

---

### Task 1: Lock the sync contract before changing payloads

**Files:**
- Modify: `tests/test_room_realtime_contract.py`
- Modify: `tests/test_observability.py`
- Modify: `tests/test_load_runner.py`
- Modify: `tests/test_load_smoke.py`

- [ ] **Step 1: Add a failing socket contract test for duplicate join sync**
  Target: joining over HTTP and then sending `room:join_socket` with the same revision should not force two full-state applications.

- [ ] **Step 2: Add a failing socket contract test for lightweight presence**
  Target: `room:presence` keeps roster, capacity, host, and revision fields, but does not include `game_state`.

- [ ] **Step 3: Add a failing load-runner test for the new join boundary**
  Target: `tools/load/run.py` must wait for `room:snapshot`, not treat `room:presence` as the full-state handshake.

- [ ] **Step 4: Add a failing regression test for live persistence cadence**
  Target: a changed live loop no longer calls `save_room()` on every changed tick; it checkpoints on interval or boundary events instead.

- [ ] **Step 5: Run the focused tests and capture the initial failures**
  Run: `py -m pytest tests/test_room_realtime_contract.py tests/test_observability.py tests/test_load_runner.py tests/test_load_smoke.py -q`

### Task 2: Make deployment concurrency tunable without unsafe live defaults

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Optionally modify: `docs/load-results/2026-03-28-remote-stand/README.md`

- [ ] **Step 1: Add explicit Gunicorn worker and thread env support**
  Change the container command so both `GUNICORN_WORKERS` and `GUNICORN_THREADS` can be tuned from compose or the stand environment.

- [ ] **Step 2: Raise the default thread ceiling, but keep one worker by default**
  Recommended default for this plan: `GUNICORN_WORKERS=1`, `GUNICORN_THREADS=16`.
  Stretch experiment: `1x32`.
  Do not make `2x16` or `4x16` the live default yet because `_realtime_loops`, `_realtime_controls`, and `_socket_memberships` in [sockets.py](/C:/Users/pavel/OneDrive/Рабочий стол/Codex/Regatta/regatta_app/sockets.py#L44) are process-local.

- [ ] **Step 3: Verify the rendered container config**
  Run: `docker compose config`
  Expected: app service includes both `GUNICORN_WORKERS` and `GUNICORN_THREADS`.

- [ ] **Step 4: Run the local smoke and join-storm gates on the new single-worker defaults**
  Run: `py -m pytest tests/test_load_smoke.py -q`

- [ ] **Step 5: Record the benchmark matrix to use later on the stand**
  Required matrix: `1x16`, `1x32`.
  Optional lobby-only experiment: `2x16` after Tasks 3 and 4, but not as the shipped live configuration.

### Task 3: Remove duplicate full-state sync on create and join

**Files:**
- Modify: `static/multiplayer.js`
- Modify: `regatta_app/sockets.py`
- Modify: `regatta_app/room_events.py`
- Modify: `tests/test_room_realtime_contract.py`
- Modify: `tests/test_observability.py`

- [ ] **Step 1: Keep the HTTP create and join response shape stable**
  Do not switch REST to metadata-only in this phase. That would widen the blast radius across bootstrap, tests, and UI flow.

- [ ] **Step 2: Extend `room:join_socket` to carry client knowledge**
  Send `known_revision` from `static/multiplayer.js` when the browser already has room data from the HTTP create/join response.

- [ ] **Step 3: Gate the socket snapshot on staleness**
  In `regatta_app/sockets.py`, emit `room:snapshot` only when the client is missing room state or has an older revision than the server room.

- [ ] **Step 4: Preserve join correctness and add observability**
  The server should still join the Socket.IO room, register the player socket, and start the live loop when needed.
  Add log or metric context for `snapshot_sent=true|false` so the optimization is visible in load results.

- [ ] **Step 5: Re-run the focused socket and observability tests**
  Run: `py -m pytest tests/test_room_realtime_contract.py tests/test_observability.py -q`

### Task 4: Make `room:presence` a roster-only event

**Files:**
- Modify: `regatta_app/room_store.py`
- Modify: `regatta_app/room_events.py`
- Modify: `static/multiplayer.js`
- Modify: `tools/load/run.py`
- Modify: `tools/load/report_load.py`
- Modify: `tests/test_room_realtime_contract.py`
- Modify: `tests/test_load_runner.py`

- [ ] **Step 1: Add a lightweight public room serializer**
  Introduce a helper next to `public_room_view()` that reuses the safe player and self view but omits `game_state`.

- [ ] **Step 2: Switch `room:presence` to the lightweight serializer**
  `room:snapshot` and `room:state_updated` stay full room payloads in this plan.

- [ ] **Step 3: Teach the browser to merge presence without importing state**
  Add a dedicated presence handler in `static/multiplayer.js` that updates roster, counts, status, host flags, and revision without calling `timedImportState()`.

- [ ] **Step 4: Update the load tools for the new event meaning**
  `tools/load/run.py` must wait for `room:snapshot` after `room:join_socket`.
  `tools/load/report_load.py` should stop treating `room:presence` as the join-complete full-state event.

- [ ] **Step 5: Run the focused contract and reporting tests**
  Run: `py -m pytest tests/test_room_realtime_contract.py tests/test_load_runner.py tests/test_load_smoke.py -q`

### Task 5: Split durable room storage from hot live runtime

**Files:**
- Create: `regatta_app/live_runtime.py`
- Modify: `regatta_app/factory.py`
- Modify: `regatta_app/sockets.py`
- Modify: `regatta_app/room_service.py`
- Modify: `regatta_app/api/rooms.py`
- Modify: `tests/test_room_realtime_contract.py`
- Modify: `tests/test_observability.py`

- [ ] **Step 1: Introduce an explicit live-runtime registry**
  Create a small module that owns in-memory authoritative state for live rooms:
  room snapshot, dirty flag, last checkpoint timestamp, and helper methods for hydrate, read, mutate, and flush.

- [ ] **Step 2: Hydrate runtime state only for live rooms**
  On room start or first live loop entry, load the durable room from `room_store()`, register it in the runtime registry, and keep `REALTIME_TICK_HZ = 12`.

- [ ] **Step 3: Change the live loop to mutate runtime first and checkpoint on cadence**
  In `run_realtime_room_loop()`:
  mutate the runtime copy each tick,
  increment revision on change,
  broadcast from the runtime copy,
  call `save_room()` only when either:
  elapsed time since last checkpoint is at least `250-500 ms`, or
  a boundary event requires durability now.

- [ ] **Step 4: Persist immediately on boundary events**
  Boundary events include at least:
  room start,
  pause or resume,
  finish,
  reset to lobby,
  kick or leave that changes the live roster,
  explicit room edits that replace the live snapshot.

- [ ] **Step 5: Keep reconnect semantics safe**
  A reconnecting client may receive the latest checkpointed snapshot if the runtime copy is not directly reachable; keep the checkpoint interval tight enough that reconnect drift stays acceptable.

- [ ] **Step 6: Re-run the focused live-loop tests**
  Run: `py -m pytest tests/test_room_realtime_contract.py tests/test_observability.py -q`

### Task 6: Verify phase-by-phase and stop if the measured ceiling moved enough

**Files:**
- No code changes expected

- [ ] **Step 1: Run the focused regression suite**
  Run: `py -m pytest tests/test_room_realtime_contract.py tests/test_room_store_concurrency.py tests/test_observability.py tests/test_load_runner.py tests/test_load_smoke.py -q`

- [ ] **Step 2: Rebuild and run the local stack**
  Run: `docker compose up --build`

- [ ] **Step 3: Re-run the join-storm stand scenario after Tasks 2 through 4**
  Run: `py tools/load/run_load.py --base-url <stand-url> --scenario join_storm_1x20 --users 10 --rooms 1`
  Acceptance gate: no Socket.IO connect timeout at 10 users, and lower `join_socket -> snapshot` p95 than the March 28 baseline.

- [ ] **Step 4: Re-run the live-race stand scenario after Task 5**
  Run: `py tools/load/run_load.py --base-url <stand-url> --scenario live_race --rooms 1 --users 8 --users-per-room 8 --duration-sec 120`
  Acceptance gate: no 20 second timeout on `GET /api/rooms/<code>`, and `save_room` pressure is visibly lower than `room:state_updated` count.

- [ ] **Step 5: Only then decide whether the architecture phase is enough**
  If `1x16` or `1x32` plus the sync slimming removes the failures, stop and do not continue into multi-process live ownership.
  If the stand still falls over, open a follow-up plan for distributed live ownership or a dedicated realtime worker instead of sneaking that scope into this change.
