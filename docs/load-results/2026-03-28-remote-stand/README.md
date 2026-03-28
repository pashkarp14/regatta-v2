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

Typical files inside each run folder:

- `summary.json`: aggregated machine-readable result
- `report.md`: human-readable report
- `scenario_config.json`: scenario parameters and high-level outcome
- `requests.jsonl`: HTTP request samples
- `socket_events.jsonl`: Socket.IO event samples
- `room_revisions.jsonl`: control-to-revision timings
- `metrics_initial.txt` and `metrics_final.txt`: Prometheus snapshots
- `blocking_issue.json`: present only for failed runs
