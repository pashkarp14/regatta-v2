from __future__ import annotations

import json
from pathlib import Path

from tools.load.run import LoadRecorder, RequestSample, SocketSample, summarize_durations


def test_summarize_durations_reports_percentiles():
    summary = summarize_durations([10.0, 20.0, 40.0, 80.0, 160.0])

    assert summary["count"] == 5
    assert summary["p50"] == 40.0
    assert summary["p95"] == 160.0
    assert summary["p99"] == 160.0


def test_load_recorder_writes_expected_artifacts(tmp_path: Path):
    recorder = LoadRecorder("join_storm_1x20")
    recorder.record_request(
        RequestSample(
            scenario="join_storm_1x20",
            user_id="host",
            method="POST",
            path="/api/rooms",
            status=200,
            duration_ms=42.0,
            room_code="ROOM01",
        )
    )
    recorder.record_socket(
        SocketSample(
            scenario="join_storm_1x20",
            user_id="guest-1",
            event="room:join_socket",
            direction="out",
            status="ok",
            duration_ms=8.0,
            payload_bytes=128,
            room_code="ROOM01",
        )
    )

    recorder.write(
        tmp_path,
        {
            "scenario": "join_storm_1x20",
            "users": 10,
            "duration_seconds": 10,
        },
    )

    expected_files = {
        "summary.json",
        "requests.csv",
        "socket_events.csv",
        "latency_histograms.json",
        "errors.json",
        "scenario_config.json",
    }
    assert expected_files == {path.name for path in tmp_path.iterdir()}

    summary = json.loads((tmp_path / "summary.json").read_text(encoding="utf-8"))
    assert summary["requests"][0]["name"] == "POST /api/rooms"
