# Load Results: 2026-03-28 Remote Stand

This directory contains a tracked copy of the load-test artifacts collected against:

- `http://158.160.217.19:5001/`

Each timestamped subdirectory mirrors a run from `output/load/<timestamp>/`.

Useful runs:

- `20260328T103659Z`: successful `smoke_1x2`
- `20260328T103507Z`: successful `join_storm_1x20 --users 8`
- `20260328T103416Z`: failed `join_storm_1x20 --users 10` with Socket.IO connect timeouts
- `20260328T103755Z`: successful `live_race --users 4 --duration-sec 20`
- `20260328T103538Z`: failed `live_race --users 8 --duration-sec 30` with room view timeout

Recommended benchmark matrix for the next pass after room-sync slimming:

- `1x16` as the shipped single-worker baseline
- `1x32` as the stretch single-worker experiment

100-user benchmark scenarios for the next architecture pass:

- `join_storm_1x100`
  - target: `0` socket connect timeouts
  - gate: socket connect `p95 < 750 ms`
  - gate: `join_socket -> keyframe p95 < 250 ms`
- `live_race_20r_80o`
  - target: `20` racers + `80` observers in one room
  - gate: `0` `GET /api/rooms/<code>` timeouts
  - gate: racer `control -> revision p95 < 150 ms`
  - gate: observer resync rate `< 0.1%`
- `observer_burst_1x100`
  - target: late observer joins must not break the live room
  - gate: observer joins do not push racer control latency above the live-race gate

Reporting notes for these scenarios:

- `room:keyframe` is the primary join-complete event for latency tracking
- failed socket connects should be treated as blockers and surfaced from `blocking_issue.json`
- keep the old `join_socket -> snapshot` field only as a compatibility alias in machine-readable summaries

Typical files inside each run folder:

- `summary.json`: aggregated machine-readable result
- `report.md`: human-readable report
- `scenario_config.json`: scenario parameters and high-level outcome
- `requests.jsonl`: HTTP request samples
- `socket_events.jsonl`: Socket.IO event samples
- `room_revisions.jsonl`: control-to-revision timings
- `metrics_initial.txt` and `metrics_final.txt`: Prometheus snapshots
- `blocking_issue.json`: present only for failed runs
