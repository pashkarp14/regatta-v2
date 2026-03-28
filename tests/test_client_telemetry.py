from __future__ import annotations

from pathlib import Path

import pytest

from regatta_app.factory import create_app


def _metric_value(metrics_text: str, metric_name: str, labels: dict[str, str] | None = None) -> float | None:
    for line in metrics_text.splitlines():
        if not line or line.startswith("#") or not line.startswith(metric_name):
            continue
        if labels:
            if "{" not in line:
                continue
            label_blob = line[line.index("{") + 1 : line.index("}")]
            parsed: dict[str, str] = {}
            for item in label_blob.split(","):
                key, value = item.split("=", 1)
                parsed[key] = value.strip().strip('"')
            if any(parsed.get(key) != value for key, value in labels.items()):
                continue
        return float(line.rsplit(" ", 1)[-1])
    return None


@pytest.fixture
def app(tmp_path: Path):
    library_dir = tmp_path / "library"
    library_dir.mkdir()
    app = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SESSION_TYPE": "filesystem",
            "LIBRARY_DIR": str(library_dir),
            "ROOM_TTL_SECONDS": 3600,
            "METRICS_ENABLED": True,
            "CLIENT_TELEMETRY_ENABLED": True,
            "STRUCTURED_LOGS": True,
        }
    )
    yield app


def test_client_telemetry_ingest_updates_metrics(app):
    client = app.test_client()

    response = client.post(
        "/api/telemetry",
        json={
            "events": [
                {"event": "client.state.import", "duration_ms": 12.5},
                {"event": "client.long_frame", "duration_ms": 145.0},
            ]
        },
    )

    assert response.status_code == 202, response.get_json()
    assert response.get_json()["accepted"] == 2

    metrics_text = client.get("/metrics").get_data(as_text=True)
    assert (
        _metric_value(
            metrics_text,
            "regatta_client_telemetry_events_total",
            {"event": "client.state.import"},
        )
        or 0
    ) >= 1
    assert (
        _metric_value(
            metrics_text,
            "regatta_client_telemetry_events_total",
            {"event": "client.long_frame"},
        )
        or 0
    ) >= 1
