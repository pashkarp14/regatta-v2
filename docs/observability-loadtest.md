# Regatta Observability and Load Testing

## Runtime Baseline

- Primary load-test runtime: `docker compose --env-file .env.loadtest.example up --build`
- Redis-backed path is the reference environment.
- Prometheus and Grafana now come up with the regular `docker compose up`.

## Feature Flags

- `METRICS_ENABLED=1`
- `STRUCTURED_LOGS=1`
- `CLIENT_TELEMETRY_ENABLED=1`
- `REALTIME_TRACE_COLLISIONS=0`
- `SLOW_TICK_WARN_MS=40`

## Endpoints

- Health: `GET /healthz`
- Metrics: `GET /metrics`
- Client telemetry ingest: `POST /api/telemetry`

## Dashboards

- Prometheus scrape config: [observability/prometheus.yml](/Users/pavel/OneDrive/Рабочий стол/Codex/Regatta/observability/prometheus.yml)
- Grafana dashboard: [observability/grafana/dashboards/regatta-overview.json](/Users/pavel/OneDrive/Рабочий стол/Codex/Regatta/observability/grafana/dashboards/regatta-overview.json)

The dashboard covers:

- HTTP rate and p95 latency by endpoint
- Socket event rate
- Realtime tick p95/p99
- Connected clients and active realtime loops
- Observed room counts
- Snapshot payload p95
- Client telemetry p95

## Load Runner

Runner entrypoint: [tools/load/run.py](/Users/pavel/OneDrive/Рабочий стол/Codex/Regatta/tools/load/run.py)

Example runs:

```powershell
.venv\Scripts\python tools\load\run.py --scenario join_storm_1x20
.venv\Scripts\python tools\load\run.py --scenario lobby_edit_1x20 --duration-seconds 20
.venv\Scripts\python tools\load\run.py --scenario live_race_5x20 --users 100 --duration-seconds 30
.venv\Scripts\python tools\load\run.py --scenario mixed_chaos_100 --users 100 --duration-seconds 30
```

Artifacts are written to `output/load/<timestamp>-<scenario>/`:

- `summary.json`
- `requests.csv`
- `socket_events.csv`
- `latency_histograms.json`
- `errors.json`
- `scenario_config.json`

## Initial Targets

- `GET /api/bootstrap` p95 <= 200 ms
- `POST /api/rooms` p95 <= 300 ms
- `POST /api/rooms/join` p95 <= 300 ms
- `POST /api/rooms/<code>/start` p95 <= 400 ms
- `room:join_socket -> room:snapshot` p95 <= 400 ms
- `room:control -> room:state_updated` p95 <= 250 ms
- `realtime_tick_duration` p95 <= 40 ms, p99 <= 70 ms

## Notes

- `MAX_ROOM_PLAYERS` is still 20, so `100 concurrent users` means multiple rooms, not one supersized room.
- The current repo has no `locked_room_store.py`; instrumentation is attached to the actual `room_store.py` seams in this codebase.
- If multi-worker Gunicorn metrics are needed later, enable Prometheus multiprocess mode before comparing workers directly.
