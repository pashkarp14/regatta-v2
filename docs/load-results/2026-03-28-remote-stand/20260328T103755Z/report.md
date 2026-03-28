# Regatta Load Report

## Context
- Stand: http://158.160.217.19:5001
- Scenario: live_race
- Started: 2026-03-28T10:37:59.530Z
- Finished: 2026-03-28T10:38:26.513Z
- Baseline snapshot source: remote_library
- Session backend: redis
- Redis enabled: True

## Short Outcome
- Rooms: 1
- Users: 4
- Bottleneck: No single dominant bottleneck stood out in this run; the system remained mostly balanced at the measured level.

## HTTP
| Endpoint | Count | P50 ms | P95 ms | P99 ms | Max ms | Error rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GET /api/rooms/SLWY9V | 1 | 33.16 | 33.16 | 33.16 | 33.16 | 0.0 |
| POST /api/rooms | 1 | 63.89 | 63.89 | 63.89 | 63.89 | 0.0 |
| POST /api/rooms/SLWY9V/start | 1 | 37.94 | 37.94 | 37.94 | 37.94 | 0.0 |
| POST /api/rooms/join | 3 | 75.63 | 181.38 | 181.38 | 181.38 | 0.0 |
| POST /api/rooms/leave | 4 | 35.62 | 42.39 | 42.39 | 42.39 | 0.0 |

## Socket
| Metric | Count | P50 ms | P95 ms | P99 ms | Max ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| socket connect | 4 | 53.46 | 55.22 | 55.22 | 55.22 |
| join_socket -> snapshot | 4 | 23.0 | 24.0 | 24.0 | 24.0 |
| control -> revision | 320 | 45.25 | 78.54 | 187.41 | 191.42 |

## Findings from /metrics
- Used metric names: regatta_errors_total, regatta_http_request_bytes_total, regatta_http_requests_total, regatta_http_response_bytes_total, regatta_realtime_loops_active, regatta_realtime_tick_changed_total, regatta_realtime_tick_noop_total, regatta_realtime_ticks_total, regatta_room_store_operations_total, regatta_rooms_total, regatta_socket_connected_clients, regatta_socket_events_total, regatta_socket_payload_bytes_total
- Expected but missing: regatta_client_telemetry_duration_seconds, regatta_client_telemetry_events_total, regatta_game_state_payload_bytes, regatta_game_state_validation_duration_seconds, regatta_http_request_duration_seconds, regatta_public_room_view_duration_seconds, regatta_public_room_view_payload_bytes, regatta_realtime_tick_drift_seconds, regatta_realtime_tick_duration_seconds, regatta_room_players_histogram, regatta_room_store_duration_seconds, regatta_room_store_payload_bytes, regatta_socket_event_duration_seconds
- Found but undocumented: process_cpu_seconds_total, process_max_fds, process_open_fds, process_resident_memory_bytes, process_start_time_seconds, process_virtual_memory_bytes, python_gc_collections_total, python_gc_objects_collected_total, python_gc_objects_uncollectable_total, python_info, regatta_errors_created, regatta_game_state_payload_bytes_bucket, regatta_game_state_payload_bytes_count, regatta_game_state_payload_bytes_created, regatta_game_state_payload_bytes_sum, regatta_game_state_validation_duration_seconds_bucket, regatta_game_state_validation_duration_seconds_count, regatta_game_state_validation_duration_seconds_created, regatta_game_state_validation_duration_seconds_sum, regatta_http_request_bytes_created, regatta_http_request_duration_seconds_bucket, regatta_http_request_duration_seconds_count, regatta_http_request_duration_seconds_created, regatta_http_request_duration_seconds_sum, regatta_http_requests_created, regatta_http_response_bytes_created, regatta_public_room_view_duration_seconds_bucket, regatta_public_room_view_duration_seconds_count, regatta_public_room_view_duration_seconds_created, regatta_public_room_view_duration_seconds_sum, regatta_public_room_view_payload_bytes_bucket, regatta_public_room_view_payload_bytes_count, regatta_public_room_view_payload_bytes_created, regatta_public_room_view_payload_bytes_sum, regatta_realtime_tick_changed_created, regatta_realtime_tick_drift_seconds_bucket, regatta_realtime_tick_drift_seconds_count, regatta_realtime_tick_drift_seconds_created, regatta_realtime_tick_drift_seconds_sum, regatta_realtime_tick_duration_seconds_bucket, regatta_realtime_tick_duration_seconds_count, regatta_realtime_tick_duration_seconds_created, regatta_realtime_tick_duration_seconds_sum, regatta_realtime_tick_noop_created, regatta_realtime_ticks_created, regatta_room_players_histogram_bucket, regatta_room_players_histogram_count, regatta_room_players_histogram_created, regatta_room_players_histogram_sum, regatta_room_store_duration_seconds_bucket, regatta_room_store_duration_seconds_count, regatta_room_store_duration_seconds_created, regatta_room_store_duration_seconds_sum, regatta_room_store_operations_created, regatta_room_store_payload_bytes_bucket, regatta_room_store_payload_bytes_count, regatta_room_store_payload_bytes_created, regatta_room_store_payload_bytes_sum, regatta_socket_event_duration_seconds_bucket, regatta_socket_event_duration_seconds_count, regatta_socket_event_duration_seconds_created, regatta_socket_event_duration_seconds_sum, regatta_socket_events_created, regatta_socket_payload_bytes_created
- Histogram highlights:
  regatta_game_state_payload_bytes [default] count=26 p95=8192.0 p99=8192.0 avg=1816.5769
  regatta_game_state_validation_duration_seconds [default] count=26 p95=0.0005 p99=0.0005 avg=0.0001
  regatta_http_request_duration_seconds [endpoint=/api/library/maps,method=GET,status=200] count=1 p95=0.005 p99=0.005 avg=0.0014
  regatta_http_request_duration_seconds [endpoint=/api/library/maps/<record_id>,method=GET,status=200] count=1 p95=0.005 p99=0.005 avg=0.0013
  regatta_http_request_duration_seconds [endpoint=/api/rooms,method=POST,status=200] count=1 p95=0.005 p99=0.005 avg=0.0039
  regatta_http_request_duration_seconds [endpoint=/api/rooms/<room_code>,method=GET,status=200] count=1 p95=0.005 p99=0.005 avg=0.0012
  regatta_http_request_duration_seconds [endpoint=/api/rooms/<room_code>/start,method=POST,status=200] count=1 p95=0.01 p99=0.01 avg=0.0062
  regatta_http_request_duration_seconds [endpoint=/api/rooms/join,method=POST,status=200] count=3 p95=0.2 p99=0.2 avg=0.038
  regatta_http_request_duration_seconds [endpoint=/api/rooms/leave,method=POST,status=200] count=4 p95=0.01 p99=0.01 avg=0.0042
  regatta_http_request_duration_seconds [endpoint=/metrics,method=GET,status=200] count=1 p95=0.01 p99=0.01 avg=0.0075
  regatta_public_room_view_duration_seconds [default] count=256 p95=0.0005 p99=0.0005 avg=0.0001
  regatta_public_room_view_payload_bytes [default] count=256 p95=8192.0 p99=8192.0 avg=3360.9531
  regatta_realtime_tick_drift_seconds [default] count=239 p95=0.0 p99=0.0 avg=0.0
  regatta_realtime_tick_duration_seconds [default] count=239 p95=0.01 p99=0.01 avg=0.0045
  regatta_room_players_histogram [default] count=256 p95=4.0 p99=4.0 avg=3.9492
  regatta_room_store_duration_seconds [backend=redis,operation=delete_room,result=ok] count=1 p95=0.0005 p99=0.0005 avg=0.0001
  regatta_room_store_duration_seconds [backend=redis,operation=get_room,result=ok] count=581 p95=0.005 p99=0.005 avg=0.0012
  regatta_room_store_duration_seconds [backend=redis,operation=save_room,result=ok] count=246 p95=0.005 p99=0.005 avg=0.001
  regatta_room_store_payload_bytes [backend=redis,operation=get_room] count=575 p95=16384.0 p99=16384.0 avg=7971.5339
  regatta_room_store_payload_bytes [backend=redis,operation=save_room] count=246 p95=16384.0 p99=16384.0 avg=7939.378
  regatta_socket_event_duration_seconds [event=disconnect,result=ok] count=4 p95=0.005 p99=0.005 avg=0.0018
  regatta_socket_event_duration_seconds [event=room:control,result=ok] count=320 p95=0.005 p99=0.01 avg=0.0023
  regatta_socket_event_duration_seconds [event=room:join_socket,result=ok] count=4 p95=0.025 p99=0.025 avg=0.0119

## Findings from load runner
- Socket connect count: 4
- join_socket -> snapshot p95: 24.0 ms
- control -> revision p95: 78.54 ms
- Disconnect rate: 0.0
- Error rate: 0.0

## Observations
- Main bottleneck hypothesis: No single dominant bottleneck stood out in this run; the system remained mostly balanced at the measured level.

## Next Steps
- Compare `public_room_view` payload size against the measured socket latency and trim repeated room fields before increasing concurrency again.
- Profile `room_store.get_room` and `room_store.save_room` under the same scenario, because join/start flows depend on them directly.
- Re-run the same scenario after any change and compare the new `/metrics` histogram deltas against this baseline instead of relying on single-run intuition.
