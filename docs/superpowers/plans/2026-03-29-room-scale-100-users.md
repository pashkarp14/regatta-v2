# 100-User Room Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one room handle 100 simultaneous connected users without Socket.IO connect timeouts, live-room HTTP stalls, or runaway fanout during burst joins.

**Architecture:** Keep Flask plus Socket.IO plus Redis, but stop treating the web process as the owner of live room state. Split the system into a stateless web and socket gateway, a Redis-backed room command bus, and a dedicated realtime room worker that owns authoritative live state, checkpoints to durable storage, and emits lightweight presence plus state delta events. Default scope assumes up to `20` active racers plus up to `80` observers in one room; a separate optional task at the end covers true `100`-boat races.

**Tech Stack:** Flask, Flask-SocketIO, Redis, Gunicorn, pytest, existing `tools/load` runner, Docker Compose.

---

### Task 1: Freeze the 100-user target and acceptance gates

**Files:**
- Modify: `tools/load/scenarios.py`
- Modify: `tools/load/run.py`
- Modify: `tools/load/report_load.py`
- Modify: `tests/test_load_runner.py`
- Modify: `tests/test_load_smoke.py`
- Modify: `docs/load-results/2026-03-28-remote-stand/README.md`

- [x] **Step 1: Add explicit 100-user load scenarios**
  Add:
  - `join_storm_1x100`
  - `live_race_20r_80o`
  - `observer_burst_1x100`

- [ ] **Step 2: Make the load runner record the right join and live latency checkpoints**
  Record:
  - socket connect latency
  - `join_socket -> room:keyframe` latency
  - racer `control -> revision` latency
  - observer `revision gap -> resync` count

- [x] **Step 3: Add failing tests for the new scenario definitions and report thresholds**
  Cover:
  - scenario names and parameters exist
  - reporting computes `room:keyframe`-based join latency
  - failed socket connects are surfaced as blockers, not buried in averages

- [x] **Step 4: Define the acceptance gates in the docs**
  Target gates:
  - `join_storm_1x100`: `0` socket connect timeouts, socket connect `p95 < 750 ms`, join `p95 < 250 ms`
  - `live_race_20r_80o`: `0` `GET /api/rooms/<code>` timeouts, racer `control -> revision p95 < 150 ms`, observer resync rate `< 0.1%`
  - `observer_burst_1x100`: joining observers do not push racer control latency above the live-race gate

- [x] **Step 5: Run the focused load-tool tests**
  Run: `.venv\Scripts\python.exe -m pytest tests/test_load_runner.py tests/test_load_smoke.py -q`

### Task 2: Split room capacity into racers and observers

**Files:**
- Modify: `regatta_app/room_store.py`
- Modify: `regatta_app/room_service.py`
- Modify: `regatta_app/api/rooms.py`
- Modify: `static/multiplayer.js`
- Modify: `tests/test_room_realtime_contract.py`
- Modify: `tests/test_observability.py`

- [x] **Step 1: Write failing tests for a 20-racer plus observer room contract**
  Cover:
  - room payload exposes `max_racers`, `max_observers`, `joined_observers_count`
  - `max_players` remains as a compatibility alias for racer seats during migration
  - an observer can still join after all racer seats are full

- [x] **Step 2: Add the split-capacity fields to the room model**
  Keep current boat-count validation tied to racers, not total connections.

- [x] **Step 3: Preserve public payload compatibility while extending it**
  Keep old fields readable by the browser, but add the new capacity fields immediately so the frontend and load tools can move first.

- [x] **Step 4: Update the frontend room shell to display racer and observer counts separately**
  Do not rewrite the room UI; extend the current roster and capacity text with the new fields.

- [x] **Step 5: Re-run the room contract tests**
  Run: `.venv\Scripts\python.exe -m pytest tests/test_room_realtime_contract.py tests/test_observability.py -q`

### Task 3: Make Socket.IO deployment multi-worker safe

**Files:**
- Modify: `regatta_app/factory.py`
- Modify: `regatta_app/extensions.py`
- Modify: `regatta_app/config.py`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `requirements.txt`
- Modify: `tests/test_observability.py`

- [x] **Step 1: Add Socket.IO Redis message-queue support**
  Configure the Socket.IO server to use Redis for cross-worker emits when `REDIS_URL` is present.

- [ ] **Step 2: Remove the assumption that one web process owns all sockets**
  Keep local in-memory fallback for no-Redis development, but treat it as a non-scaled mode only.

- [ ] **Step 3: Move production defaults off the current single-worker `gthread` assumption**
  Add explicit env support for:
  - `GUNICORN_WORKERS`
  - `GUNICORN_THREADS`
  - `GUNICORN_WORKER_CLASS`
  Recommended target for the scaled web tier:
  - `GUNICORN_WORKER_CLASS=geventwebsocket.gunicorn.workers.GeventWebSocketWorker`
  - `GUNICORN_WORKERS=2`
  - `GUNICORN_THREADS=1`

- [ ] **Step 4: Add a failing integration-style test for clustered emits**
  The test should prove that emitting from a non-owning process still reaches room subscribers when Redis-backed Socket.IO is enabled.

- [ ] **Step 5: Verify the config surface**
  Run:
  - `.venv\Scripts\python.exe -m pytest tests/test_observability.py -q`
  - `docker compose config`

### Task 4: Introduce an explicit room command bus

**Files:**
- Create: `regatta_app/realtime_protocol.py`
- Create: `regatta_app/realtime_bus.py`
- Modify: `regatta_app/factory.py`
- Modify: `regatta_app/sockets.py`
- Modify: `regatta_app/api/rooms.py`
- Modify: `regatta_app/room_service.py`
- Modify: `tests/test_room_realtime_contract.py`
- Modify: `tests/test_observability.py`

- [ ] **Step 1: Write failing tests for publish and consume of room commands**
  Commands must cover at least:
  - `attach_socket`
  - `detach_socket`
  - `start_room`
  - `control`
  - `pause`
  - `view_settings`
  - `kick`
  - `reset_lobby`

- [ ] **Step 2: Define the command schema in one place**
  `realtime_protocol.py` should own command names, required fields, and versioned payload shapes.

- [ ] **Step 3: Implement a Redis-backed bus with an in-process fallback**
  Use Redis Streams or Lists for commands.
  The no-Redis fallback can remain in-process for local development and tests.

- [ ] **Step 4: Change web handlers to publish commands instead of mutating live state directly**
  `sockets.py` and `api/rooms.py` should stop being the authoritative owner of live mutation once a room is live.

- [ ] **Step 5: Re-run the command-contract tests**
  Run: `.venv\Scripts\python.exe -m pytest tests/test_room_realtime_contract.py tests/test_observability.py -q`

### Task 5: Move authoritative live-room ownership into a dedicated worker

**Files:**
- Create: `regatta_app/realtime_room_worker.py`
- Create: `regatta_worker.py`
- Modify: `regatta_app/live_runtime.py`
- Modify: `regatta_app/sockets.py`
- Modify: `regatta_app/api/rooms.py`
- Modify: `regatta_app/room_service.py`
- Modify: `docker-compose.yml`
- Modify: `tests/test_room_realtime_contract.py`
- Modify: `tests/test_observability.py`

- [ ] **Step 1: Write failing tests for one-owner-per-room semantics**
  Cover:
  - only the worker mutates live room state
  - web processes do not run room loops for live rooms
  - worker restart can hydrate from the last checkpointed snapshot

- [ ] **Step 2: Implement a room worker entrypoint**
  The worker should:
  - consume room commands
  - hydrate room state from `room_store`
  - own the live loop at `REALTIME_TICK_HZ = 12`
  - checkpoint on `250 ms` cadence and boundary events

- [ ] **Step 3: Keep the durable store authoritative for lobby and recovery**
  Lobby create and join still write through the durable room store.
  Live mutation is authoritative in the worker and durable in checkpoints.

- [ ] **Step 4: Add Docker Compose support for the worker service**
  The app stack should run:
  - web
  - redis
  - realtime worker

- [ ] **Step 5: Re-run the live-loop ownership tests**
  Run: `.venv\Scripts\python.exe -m pytest tests/test_room_realtime_contract.py tests/test_observability.py -q`

### Task 6: Replace full-state fanout with keyframes and deltas

**Files:**
- Create: `regatta_app/realtime_delta.py`
- Modify: `regatta_app/realtime_protocol.py`
- Modify: `regatta_app/room_events.py`
- Modify: `regatta_app/room_store.py`
- Modify: `static/multiplayer.js`
- Modify: `tools/load/run.py`
- Modify: `tools/load/report_load.py`
- Modify: `tests/test_room_realtime_contract.py`
- Modify: `tests/test_load_runner.py`

- [ ] **Step 1: Add failing contract tests for the new event split**
  Introduce:
  - `room:keyframe` for full room sync on join and periodic resync
  - `room:delta` for live game-state deltas
  - `room:presence_delta` for roster changes

- [ ] **Step 2: Keep one migration window with backward-compatible event handling**
  The browser can temporarily accept both `room:snapshot` and `room:keyframe` until the load runner and tests are fully moved.

- [ ] **Step 3: Build compact live deltas**
  Deltas should include only changed fields:
  - revision
  - changed boats
  - race timers
  - weather and gust changes
  - penalties and finish markers
  Do not resend static room metadata or full roster on every tick.

- [ ] **Step 4: Add periodic keyframes and explicit resync**
  Send a full keyframe:
  - on join
  - every `1-2 s`
  - on revision-gap recovery
  - on boundary events like start, pause, finish, reset

- [ ] **Step 5: Teach the browser to apply deltas and request resync on revision gaps**
  The client should stop calling `timedImportState()` for every presence or unchanged branch of state.

- [ ] **Step 6: Re-run protocol and load-runner tests**
  Run: `.venv\Scripts\python.exe -m pytest tests/test_room_realtime_contract.py tests/test_load_runner.py tests/test_load_smoke.py -q`

### Task 7: Batch presence and add backpressure

**Files:**
- Create: `regatta_app/realtime_fanout.py`
- Modify: `regatta_app/realtime_room_worker.py`
- Modify: `regatta_app/room_events.py`
- Modify: `static/multiplayer.js`
- Modify: `tests/test_observability.py`
- Modify: `tests/test_room_realtime_contract.py`

- [ ] **Step 1: Write failing tests for join-burst coalescing**
  A burst of joins should not cause one full roster broadcast per join to every existing client.

- [ ] **Step 2: Coalesce presence changes into short flush windows**
  Batch join and leave events into one presence-delta flush every `50-100 ms` during bursts.

- [ ] **Step 3: Add latest-only delta backpressure for lagging sockets**
  If a client is behind, skip intermediate live deltas and keep only the newest revision plus periodic keyframes.

- [ ] **Step 4: Add observability for dropped and coalesced events**
  Track:
  - `room_presence_batches_total`
  - `room_presence_coalesced_events_total`
  - `room_delta_dropped_total`
  - `room_delta_keyframes_total`

- [ ] **Step 5: Re-run the observability and contract tests**
  Run: `.venv\Scripts\python.exe -m pytest tests/test_observability.py tests/test_room_realtime_contract.py -q`

### Task 8: Add fast snapshot cache and cheap room-view reads

**Files:**
- Create: `regatta_app/room_snapshot_cache.py`
- Modify: `regatta_app/api/rooms.py`
- Modify: `regatta_app/realtime_room_worker.py`
- Modify: `regatta_app/room_store.py`
- Modify: `tests/test_room_realtime_contract.py`
- Modify: `tests/test_observability.py`

- [ ] **Step 1: Write failing tests for cache-backed live room reads**
  `GET /api/rooms/<code>` during a live race should read a fresh snapshot without blocking on the live loop.

- [ ] **Step 2: Store the latest room keyframe in Redis**
  Update the cache:
  - on each periodic keyframe
  - on boundary events
  - on worker shutdown

- [ ] **Step 3: Serve reconnects and room-view HTTP from the cached keyframe**
  Reconnecting users should not need a synchronous RPC to the room worker.

- [ ] **Step 4: Surface cache age in observability**
  Add:
  - `room_snapshot_cache_age_ms`
  - `room_snapshot_cache_hits_total`
  - `room_snapshot_cache_misses_total`

- [ ] **Step 5: Re-run the read-path tests**
  Run: `.venv\Scripts\python.exe -m pytest tests/test_room_realtime_contract.py tests/test_observability.py -q`

### Task 9: Verify deployment and benchmark phase by phase

**Files:**
- Modify: `docs/load-results/2026-03-29-room-scale-100-users/README.md`
- No code changes required otherwise

- [ ] **Step 1: Run the focused regression suite**
  Run: `.venv\Scripts\python.exe -m pytest tests/test_room_realtime_contract.py tests/test_room_store_concurrency.py tests/test_observability.py tests/test_load_runner.py tests/test_load_smoke.py -q`

- [ ] **Step 2: Rebuild the local stack with web plus worker plus Redis**
  Run: `docker compose up --build`

- [ ] **Step 3: Run the stand join benchmark ladder**
  Run:
  - `py tools/load/run_load.py --base-url <stand-url> --scenario join_storm_1x20 --users 20 --rooms 1`
  - `py tools/load/run_load.py --base-url <stand-url> --scenario join_storm_1x100 --users 50 --rooms 1`
  - `py tools/load/run_load.py --base-url <stand-url> --scenario join_storm_1x100 --users 100 --rooms 1`

- [ ] **Step 4: Run the stand live benchmark ladder**
  Run:
  - `py tools/load/run_load.py --base-url <stand-url> --scenario live_race --rooms 1 --users 8 --users-per-room 8 --duration-sec 120`
  - `py tools/load/run_load.py --base-url <stand-url> --scenario live_race_20r_80o --rooms 1 --users 100 --users-per-room 100 --duration-sec 180`
  - `py tools/load/run_load.py --base-url <stand-url> --scenario observer_burst_1x100 --rooms 1 --users 100 --duration-sec 180`

- [ ] **Step 5: Record the benchmark matrix and stop only on the real target**
  Acceptance gate:
  - `100` concurrent users in one room pass without socket connect timeout
  - no `20 s` room-view timeout
  - no worker ownership split-brain
  - no uncontrolled event backlog growth

### Task 10: Optional follow-up for true 100-racer races

**Files:**
- Modify: `regatta_app/room_store.py`
- Modify: `regatta_app/game_state.py`
- Modify: `regatta_app/realtime_engine.py`
- Modify: `static/multiplayer.js`
- Modify: `static/regatta_src/sections/*.js`
- Modify: `tests/test_room_realtime_contract.py`
- Modify: `tests/test_load_smoke.py`

- [ ] **Step 1: Decide explicitly whether the requirement is 100 users or 100 controllable boats**
  Do not start this task unless the product requirement is true `100` racers.

- [ ] **Step 2: Raise the hard-coded boat and room limits**
  Update:
  - backend validation
  - boat-color handling
  - frontend seat and roster UI
  - load fixtures

- [ ] **Step 3: Re-profile simulation cost and payload growth**
  The delta protocol and worker architecture from Tasks 1 through 9 are prerequisites before attempting this.

- [ ] **Step 4: Add separate 100-racer benchmark scenarios**
  Do not mix them into the 20-racer plus observers baseline.

---

## Architecture Decision Summary

- The previous incremental plan was enough to move the ceiling, but not enough to make `100` concurrent clients safe because live-room ownership, outbound fanout, and socket delivery still depend on process-local memory in the web tier.
- The web tier must become stateless for live-room authority so it can scale horizontally.
- Live rooms need one authoritative owner, not “whichever Gunicorn worker has the socket”.
- For `100` connected users, the protocol must stop sending full room payloads on every roster and tick event.
- The first production target should be `20` racers plus `80` observers because the current boat-count and UI model are hard-coded to `20`.

## Risks To Watch

- Redis is now on the critical path for both Socket.IO fanout and room command delivery.
- Revision-gap handling must be correct before enabling delta dropping or latest-only backpressure.
- Multi-worker plus room-worker architecture needs explicit crash-recovery tests to avoid split-brain room ownership.
- If the product actually needs `100` active boats, simulation and UI costs become a separate scaling project even after this plan lands.

## Acceptance Definition

- `join_storm_1x100`: `100/100` users connect and attach without timeout.
- `live_race_20r_80o`: the race stays live for `180 s` with no room-view timeout and acceptable racer control latency.
- Room worker failover recovers from the last checkpointed keyframe without corrupting the room.
- The system remains correct under `2+` web workers because room ownership no longer lives in process-local globals.
