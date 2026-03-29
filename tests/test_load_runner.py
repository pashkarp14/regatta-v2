from __future__ import annotations

import json
from pathlib import Path
import asyncio
import time

import pytest

import tools.load.run as load_run
from tools.load.scenarios import SCENARIO_PRESETS as SCENARIO_EXPORTS
from tools.load.run import (
    LoadRecorder,
    RequestSample,
    RevisionSample,
    SocketSample,
    VirtualUser,
    build_metrics_inventory,
    control_loop,
    reshape_snapshot_for_players,
    run_live_race,
    summarize_durations,
)
from tools.load.report_load import _derive_join_socket_to_snapshot, generate_report


def test_summarize_durations_reports_percentiles():
    summary = summarize_durations([10.0, 20.0, 40.0, 80.0, 160.0])

    assert summary["count"] == 5
    assert summary["p50"] == 40.0
    assert summary["p95"] == 160.0
    assert summary["p99"] == 160.0


def test_reshape_snapshot_for_players_matches_requested_roster():
    snapshot = {
        "version": 2,
        "world": {"width": 54, "height": 72},
        "settings": {"playMode": "realtime", "interactionMode": "contact"},
        "course": {
            "markCount": 1,
            "marks": [{"x": 27, "y": 58}],
            "startA": {"x": 10, "y": 10},
            "startB": {"x": 44, "y": 10},
            "finishA": {"x": 10, "y": 10},
            "finishB": {"x": 44, "y": 10},
        },
        "race": {"phase": "countdown", "raceFinishedCount": 0},
        "boats": [
            {"x": 16.8, "y": 10, "color": "#ff595e"},
            {"x": 23.6, "y": 10, "color": "#ffca3a"},
            {"x": 30.4, "y": 10, "color": "#1982c4"},
            {"x": 37.2, "y": 10, "color": "#6a4c93"},
        ],
    }

    reshaped = reshape_snapshot_for_players(snapshot, 6)

    assert len(snapshot["boats"]) == 4
    assert len(reshaped["boats"]) == 6
    assert reshaped["settings"]["playMode"] == "realtime"
    assert reshaped["course"]["startA"] == snapshot["course"]["startA"]


def test_build_metrics_inventory_detects_missing_and_extra_metrics():
    metrics_text = "\n".join(
        [
            '# HELP regatta_http_requests_total HTTP requests handled by endpoint, method, and status.',
            '# TYPE regatta_http_requests_total counter',
            'regatta_http_requests_total{endpoint="/api/rooms",method="POST",status="200"} 5',
            '# HELP regatta_socket_events_total Socket.IO events handled by event name and result.',
            '# TYPE regatta_socket_events_total counter',
            'regatta_socket_events_total{event="room:join_socket",result="ok"} 5',
            '# HELP custom_metric Custom runtime-only metric.',
            '# TYPE custom_metric gauge',
            'custom_metric 1',
        ]
    )

    inventory = build_metrics_inventory(
        metrics_text,
        expected_metric_names={
            "regatta_http_requests_total",
            "regatta_socket_events_total",
            "regatta_realtime_tick_duration_seconds",
        },
    )

    assert inventory["found"] == [
        "custom_metric",
        "regatta_http_requests_total",
        "regatta_socket_events_total",
    ]
    assert inventory["expected_and_found"] == [
        "regatta_http_requests_total",
        "regatta_socket_events_total",
    ]
    assert inventory["expected_but_missing"] == ["regatta_realtime_tick_duration_seconds"]
    assert inventory["found_but_undocumented"] == ["custom_metric"]


def test_scenario_presets_include_100_user_targets():
    join_storm = load_run.SCENARIO_PRESETS["join_storm_1x100"]
    live_room = load_run.SCENARIO_PRESETS["live_race_20r_80o"]
    observer_burst = load_run.SCENARIO_PRESETS["observer_burst_1x100"]

    assert SCENARIO_EXPORTS is load_run.SCENARIO_PRESETS
    assert join_storm["users"] == 100
    assert join_storm["rooms"] == 1
    assert join_storm["users_per_room"] == 100
    assert live_room["users"] == 100
    assert live_room["users_per_room"] == 100
    assert live_room["racers_per_room"] == 20
    assert live_room["observers_per_room"] == 80
    assert observer_burst["users"] == 100
    assert observer_burst["observers_per_room"] == 80


def test_load_recorder_writes_required_jsonl_artifacts(tmp_path: Path):
    recorder = LoadRecorder("join_storm_1x20")
    recorder.record_request(
        RequestSample(
            ts="2026-03-28T09:00:00Z",
            scenario="join_storm_1x20",
            user_id="host",
            method="POST",
            path="/api/rooms",
            status=200,
            duration_ms=42.0,
            request_bytes=128,
            response_bytes=256,
            room_code="ROOM01",
        )
    )
    recorder.record_socket(
        SocketSample(
            ts="2026-03-28T09:00:01Z",
            scenario="join_storm_1x20",
            user_id="guest-1",
            event="room:join_socket",
            direction="out",
            ok=True,
            duration_ms=8.0,
            payload_bytes=128,
            room_code="ROOM01",
        )
    )
    recorder.record_revision(
        RevisionSample(
            ts="2026-03-28T09:00:02Z",
            scenario="join_storm_1x20",
            user_id="guest-1",
            room_code="ROOM01",
            event="room:state_updated",
            revision=3,
            latency_since_last_control_ms=125.0,
        )
    )

    recorder.write(
        tmp_path,
        {
            "scenario": "join_storm_1x20",
            "users": 10,
            "duration_seconds": 10,
        },
        environment={"base_url": "http://127.0.0.1:5001"},
    )

    expected_files = {
        "environment.json",
        "errors.json",
        "requests.jsonl",
        "room_revisions.jsonl",
        "scenario_config.json",
        "socket_events.jsonl",
    }
    assert expected_files == {path.name for path in tmp_path.iterdir()}

    request_lines = (tmp_path / "requests.jsonl").read_text(encoding="utf-8").strip().splitlines()
    socket_lines = (tmp_path / "socket_events.jsonl").read_text(encoding="utf-8").strip().splitlines()
    revision_lines = (tmp_path / "room_revisions.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(request_lines) == 1
    assert len(socket_lines) == 1
    assert len(revision_lines) == 1


def test_generate_report_builds_summary_and_markdown(tmp_path: Path):
    (tmp_path / "scenario_config.json").write_text(
        json.dumps(
            {
                "scenario": "smoke_1x2",
                "base_url": "http://127.0.0.1:5001",
                "rooms": 1,
                "users": 2,
                "duration_seconds": 30,
                "started_at": "2026-03-28T09:00:00Z",
                "finished_at": "2026-03-28T09:00:30Z",
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "environment.json").write_text(
        json.dumps(
            {
                "base_url": "http://127.0.0.1:5001",
                "healthz": {"session_backend": "redis", "redis": True},
                "bootstrap": {"version": "2.0.0"},
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "metrics_expected_and_found.json").write_text(
        json.dumps(["regatta_http_requests_total", "regatta_socket_events_total"]),
        encoding="utf-8",
    )
    (tmp_path / "metrics_found_but_undocumented.json").write_text(json.dumps(["custom_metric"]), encoding="utf-8")
    (tmp_path / "metrics_expected_but_missing.json").write_text(json.dumps(["regatta_realtime_loops_active"]), encoding="utf-8")
    (tmp_path / "requests.jsonl").write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "ts": "2026-03-28T09:00:01Z",
                        "scenario": "smoke_1x2",
                        "user_id": "host",
                        "method": "POST",
                        "path": "/api/rooms",
                        "status": 200,
                        "duration_ms": 45.0,
                        "request_bytes": 120,
                        "response_bytes": 250,
                        "room_code": "ROOM01",
                        "ok": True,
                        "error": "",
                    }
                ),
                json.dumps(
                    {
                        "ts": "2026-03-28T09:00:02Z",
                        "scenario": "smoke_1x2",
                        "user_id": "guest",
                        "method": "POST",
                        "path": "/api/rooms/join",
                        "status": 200,
                        "duration_ms": 55.0,
                        "request_bytes": 90,
                        "response_bytes": 240,
                        "room_code": "ROOM01",
                        "ok": True,
                        "error": "",
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (tmp_path / "socket_events.jsonl").write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "ts": "2026-03-28T09:00:02Z",
                        "scenario": "smoke_1x2",
                        "user_id": "guest",
                        "event": "connect",
                        "direction": "out",
                        "ok": True,
                        "duration_ms": 12.0,
                        "payload_bytes": 0,
                        "room_code": "ROOM01",
                        "revision": None,
                        "error": "",
                    }
                ),
                json.dumps(
                    {
                        "ts": "2026-03-28T09:00:03Z",
                        "scenario": "smoke_1x2",
                        "user_id": "guest",
                        "event": "room:join_socket",
                        "direction": "out",
                        "ok": True,
                        "duration_ms": 4.0,
                        "payload_bytes": 22,
                        "room_code": "ROOM01",
                        "revision": None,
                        "error": "",
                    }
                ),
                json.dumps(
                    {
                        "ts": "2026-03-28T09:00:03Z",
                        "scenario": "smoke_1x2",
                        "user_id": "guest",
                        "event": "room:snapshot",
                        "direction": "in",
                        "ok": True,
                        "duration_ms": 0.0,
                        "payload_bytes": 700,
                        "room_code": "ROOM01",
                        "revision": 2,
                        "error": "",
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (tmp_path / "room_revisions.jsonl").write_text(
        json.dumps(
            {
                "ts": "2026-03-28T09:00:04Z",
                "scenario": "smoke_1x2",
                "user_id": "guest",
                "room_code": "ROOM01",
                "event": "room:state_updated",
                "revision": 3,
                "latency_since_last_control_ms": 130.0,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (tmp_path / "errors.json").write_text("[]", encoding="utf-8")
    (tmp_path / "metrics_initial.txt").write_text(
        "\n".join(
            [
                'regatta_http_requests_total{endpoint="/api/rooms",method="POST",status="200"} 0',
                'regatta_socket_events_total{event="room:join_socket",result="ok"} 0',
                'regatta_socket_event_duration_seconds_bucket{event="room:join_socket",result="ok",le="0.005"} 0',
                'regatta_socket_event_duration_seconds_bucket{event="room:join_socket",result="ok",le="+Inf"} 0',
                'regatta_socket_event_duration_seconds_count{event="room:join_socket",result="ok"} 0',
                'regatta_socket_event_duration_seconds_sum{event="room:join_socket",result="ok"} 0',
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (tmp_path / "metrics_final.txt").write_text(
        "\n".join(
            [
                'regatta_http_requests_total{endpoint="/api/rooms",method="POST",status="200"} 1',
                'regatta_socket_events_total{event="room:join_socket",result="ok"} 1',
                'regatta_socket_event_duration_seconds_bucket{event="room:join_socket",result="ok",le="0.005"} 1',
                'regatta_socket_event_duration_seconds_bucket{event="room:join_socket",result="ok",le="+Inf"} 1',
                'regatta_socket_event_duration_seconds_count{event="room:join_socket",result="ok"} 1',
                'regatta_socket_event_duration_seconds_sum{event="room:join_socket",result="ok"} 0.004',
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    generate_report(tmp_path)

    summary = json.loads((tmp_path / "summary.json").read_text(encoding="utf-8"))
    report = (tmp_path / "report.md").read_text(encoding="utf-8")

    assert summary["scenario"] == "smoke_1x2"
    assert summary["runner"]["http"]["POST /api/rooms"]["count"] == 1
    assert summary["runner"]["socket"]["connect"]["count"] == 1
    assert summary["runner"]["control_to_revision"]["count"] == 1
    assert summary["metrics"]["used_metric_names"] == [
        "regatta_http_requests_total",
        "regatta_socket_events_total",
    ]
    assert "Findings from /metrics" in report
    assert "Findings from load runner" in report

def test_virtual_user_close_ignores_stuck_disconnect():
    recorder = LoadRecorder("smoke_1x2")
    user = VirtualUser("http://127.0.0.1:5001", "runner-user", recorder)

    class HangingSocket:
        connected = True

        async def disconnect(self) -> None:
            await asyncio.sleep(5)

    class DummyHttp:
        async def aclose(self) -> None:
            return None

    user.socket = HangingSocket()
    user.http = DummyHttp()

    started_at = time.perf_counter()
    asyncio.run(asyncio.wait_for(user.close(), timeout=2))

    assert time.perf_counter() - started_at < 2


def test_virtual_user_connect_socket_times_out():
    recorder = LoadRecorder("join_storm_1x20")
    user = VirtualUser("http://127.0.0.1:5001", "runner-user", recorder)

    class HangingSocket:
        connected = False

        async def connect(self, *args, **kwargs) -> None:
            await asyncio.sleep(5)

    user.socket = HangingSocket()

    original_timeout = load_run.SOCKET_CONNECT_TIMEOUT_SECONDS
    load_run.SOCKET_CONNECT_TIMEOUT_SECONDS = 0.2
    try:
        started_at = time.perf_counter()
        with pytest.raises(RuntimeError, match="Timed out connecting Socket.IO client"):
            asyncio.run(asyncio.wait_for(user.connect_socket("ROOM01"), timeout=1))
    finally:
        load_run.SOCKET_CONNECT_TIMEOUT_SECONDS = original_timeout

    assert time.perf_counter() - started_at < 1
    assert recorder.socket_events[-1].event == "connect"
    assert recorder.socket_events[-1].ok is False


def test_virtual_user_connect_socket_waits_for_snapshot_not_presence():
    recorder = LoadRecorder("join_storm_1x20")
    user = VirtualUser("http://127.0.0.1:5001", "runner-user", recorder)

    class FakeSocket:
        connected = False

        async def connect(self, *args, **kwargs) -> None:
            self.connected = True

    user.socket = FakeSocket()
    user.room_code = "ROOM01"

    async def fake_emit_event(event: str, payload: dict[str, object]) -> None:
        await user.socket_queue.put(("room:presence", {"room": {"code": "ROOM01", "revision": 1}}, time.perf_counter()))
        await user.socket_queue.put(
            ("room:snapshot", {"room": {"code": "ROOM01", "revision": 1, "game_state": {}}}, time.perf_counter())
        )

    user.emit_event = fake_emit_event  # type: ignore[method-assign]

    asyncio.run(user.connect_socket("ROOM01"))

    assert user.socket_queue.empty()
    assert recorder.socket_events[-1].event == "connect"
    assert recorder.socket_events[-1].ok is True


def test_virtual_user_connect_socket_accepts_keyframe_boundary():
    recorder = LoadRecorder("join_storm_1x100")
    user = VirtualUser("http://127.0.0.1:5001", "runner-user", recorder)

    class FakeSocket:
        connected = False

        async def connect(self, *args, **kwargs) -> None:
            self.connected = True

    user.socket = FakeSocket()
    user.room_code = "ROOM01"

    async def fake_emit_event(event: str, payload: dict[str, object]) -> None:
        await user.socket_queue.put(
            ("room:keyframe", {"room": {"code": "ROOM01", "revision": 1, "game_state": {}}}, time.perf_counter())
        )

    user.emit_event = fake_emit_event  # type: ignore[method-assign]

    asyncio.run(user.connect_socket("ROOM01"))

    assert user.socket_queue.empty()
    assert recorder.socket_events[-1].event == "connect"
    assert recorder.socket_events[-1].ok is True


def test_join_socket_latency_ignores_presence_events():
    stats = _derive_join_socket_to_snapshot(
        [
            {
                "ts": "2026-03-28T09:00:03Z",
                "scenario": "smoke_1x2",
                "user_id": "guest",
                "event": "room:join_socket",
                "direction": "out",
                "room_code": "ROOM01",
            },
            {
                "ts": "2026-03-28T09:00:03.010Z",
                "scenario": "smoke_1x2",
                "user_id": "guest",
                "event": "room:presence",
                "direction": "in",
                "room_code": "ROOM01",
            },
            {
                "ts": "2026-03-28T09:00:03.025Z",
                "scenario": "smoke_1x2",
                "user_id": "guest",
                "event": "room:snapshot",
                "direction": "in",
                "room_code": "ROOM01",
            },
        ]
    )

    assert stats["count"] == 1
    assert stats["p50"] == 25.0


def test_join_socket_latency_uses_room_keyframe_when_present():
    stats = _derive_join_socket_to_snapshot(
        [
            {
                "ts": "2026-03-28T09:00:03Z",
                "scenario": "join_storm_1x100",
                "user_id": "guest",
                "event": "room:join_socket",
                "direction": "out",
                "room_code": "ROOM01",
            },
            {
                "ts": "2026-03-28T09:00:03.012Z",
                "scenario": "join_storm_1x100",
                "user_id": "guest",
                "event": "room:keyframe",
                "direction": "in",
                "room_code": "ROOM01",
            },
        ]
    )

    assert stats["count"] == 1
    assert stats["p50"] == 12.0


def test_generate_report_surfaces_blocking_issue(tmp_path: Path):
    (tmp_path / "scenario_config.json").write_text(
        json.dumps(
            {
                "scenario": "join_storm_1x100",
                "base_url": "http://127.0.0.1:5001",
                "rooms": 1,
                "users": 100,
                "duration_seconds": 20,
                "started_at": "2026-03-29T09:00:00Z",
                "finished_at": "2026-03-29T09:00:10Z",
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "environment.json").write_text(
        json.dumps(
            {
                "base_url": "http://127.0.0.1:5001",
                "healthz": {"session_backend": "redis", "redis": True},
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "metrics_expected_and_found.json").write_text("[]", encoding="utf-8")
    (tmp_path / "metrics_found_but_undocumented.json").write_text("[]", encoding="utf-8")
    (tmp_path / "metrics_expected_but_missing.json").write_text("[]", encoding="utf-8")
    (tmp_path / "requests.jsonl").write_text("", encoding="utf-8")
    (tmp_path / "socket_events.jsonl").write_text("", encoding="utf-8")
    (tmp_path / "room_revisions.jsonl").write_text("", encoding="utf-8")
    (tmp_path / "errors.json").write_text("[]", encoding="utf-8")
    (tmp_path / "metrics_initial.txt").write_text("", encoding="utf-8")
    (tmp_path / "metrics_final.txt").write_text("", encoding="utf-8")
    (tmp_path / "blocking_issue.json").write_text(
        json.dumps(
            {
                "ts": "2026-03-29T09:00:10Z",
                "message": "Scenario execution failed.",
                "details": {"scenario": "join_storm_1x100", "error": "Timed out connecting Socket.IO client."},
            }
        ),
        encoding="utf-8",
    )

    generate_report(tmp_path)

    summary = json.loads((tmp_path / "summary.json").read_text(encoding="utf-8"))
    report = (tmp_path / "report.md").read_text(encoding="utf-8")

    assert summary["blocking_issue"]["details"]["error"] == "Timed out connecting Socket.IO client."
    assert "Blocking issue" in report
    assert "Timed out connecting Socket.IO client." in report


def test_virtual_user_close_disconnects_unconnected_socket():
    recorder = LoadRecorder("join_storm_1x20")
    user = VirtualUser("http://127.0.0.1:5001", "runner-user", recorder)

    class IdleSocket:
        connected = False

        def __init__(self) -> None:
            self.disconnect_calls = 0

        async def disconnect(self) -> None:
            self.disconnect_calls += 1

    class DummyHttp:
        async def aclose(self) -> None:
            return None

    socket = IdleSocket()
    user.socket = socket
    user.http = DummyHttp()

    asyncio.run(user.close())

    assert socket.disconnect_calls == 1


def test_control_loop_stops_after_disconnect():
    class FakeSocket:
        connected = False

    class FakeSession:
        def __init__(self) -> None:
            self.socket = FakeSocket()
            self.disconnect_count = 1
            self.calls = 0

        async def emit_control(self, room_code: str, direction_x: float, direction_y: float) -> None:
            self.calls += 1

    session = FakeSession()

    asyncio.run(control_loop(session, "ROOM01", 1, 1))

    assert session.calls == 0


def test_run_live_race_starts_controls_as_each_room_becomes_live(monkeypatch):
    recorder = LoadRecorder("live_race")
    events: list[str] = []

    class FakeSession:
        def __init__(self, user_id: str) -> None:
            self.user_id = user_id
            self.self_is_observer = False

        async def room_view(self, room_code: str) -> dict[str, object]:
            await asyncio.sleep(0)
            events.append(f"view:{room_code}")
            return {"game_state": {"boats": []}}

        async def start_room(self, room_code: str, game_state: dict[str, object]) -> dict[str, object]:
            await asyncio.sleep(0)
            events.append(f"start:{room_code}")
            return {"code": room_code}

        async def close(self) -> None:
            return None

    async def fake_create_room_stack(base_url: str, recorder: LoadRecorder, room_index: int, *args, **kwargs):
        await asyncio.sleep(0)
        room_code = f"ROOM{room_index:02d}"
        events.append(f"create:{room_code}")
        return FakeSession(f"host-{room_index}"), [FakeSession(f"guest-{room_index}")], room_code

    async def fake_connect_room_sockets(host, guests, room_code: str) -> None:
        await asyncio.sleep(0)
        events.append(f"connect:{room_code}")

    async def fake_control_loop(session, room_code: str, duration_seconds: int, seed: int) -> None:
        events.append(f"control:{room_code}:{session.user_id}")
        await asyncio.sleep(0)

    monkeypatch.setattr(load_run, "_create_room_stack", fake_create_room_stack)
    monkeypatch.setattr(load_run, "_connect_room_sockets", fake_connect_room_sockets)
    monkeypatch.setattr(load_run, "control_loop", fake_control_loop)
    monkeypatch.setattr(load_run, "_leave_room_group", lambda host, guests: asyncio.sleep(0))
    monkeypatch.setattr(load_run, "_close_sessions", lambda sessions: asyncio.sleep(0))

    result = asyncio.run(
        run_live_race(
            "http://127.0.0.1:5001",
            recorder,
            users=4,
            duration_seconds=1,
            rooms=2,
            users_per_room=2,
            baseline_snapshot={"boats": []},
        )
    )

    assert result["rooms"] == 2
    assert result["users"] == 4
    assert events.index("control:ROOM01:host-1") < events.index("create:ROOM02")
