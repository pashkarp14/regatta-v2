from __future__ import annotations

import asyncio
from pathlib import Path
import socket
import threading
import time

import httpx
import pytest

from regatta_app.extensions import socketio
from regatta_app.factory import create_app
from tools.load.run import LoadRecorder, run_join_storm, run_smoke


def _free_port() -> int:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


@pytest.fixture
def live_server(tmp_path: Path):
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
    port = _free_port()
    thread = threading.Thread(
        target=lambda: socketio.run(
            app,
            host="127.0.0.1",
            port=port,
            debug=False,
            use_reloader=False,
            allow_unsafe_werkzeug=True,
        ),
        daemon=True,
    )
    thread.start()

    base_url = f"http://127.0.0.1:{port}"
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            response = httpx.get(f"{base_url}/healthz", timeout=1.0)
            if response.status_code == 200:
                break
        except Exception:
            time.sleep(0.2)
    else:
        raise RuntimeError("Server failed to start for load smoke test.")

    yield base_url


def test_join_storm_smoke_10_users(live_server):
    recorder = LoadRecorder("join_storm_1x20")

    result = asyncio.run(run_join_storm(live_server, recorder, 10, 1))

    assert result["users"] == 10
    assert not recorder.errors
    assert any(sample.path == "/api/rooms/join" for sample in recorder.requests)
    assert any(sample.event == "room:join_socket" for sample in recorder.socket_events)
    assert any(sample.event == "room:snapshot" for sample in recorder.socket_events)


def test_smoke_run_does_not_report_cleanup_as_failure(live_server):
    recorder = LoadRecorder("smoke_1x2")

    result = asyncio.run(run_smoke(live_server, recorder, 2, 1))

    assert result["users"] == 2
    assert not recorder.errors
    assert not any(sample.event == "room:kicked" for sample in recorder.socket_events)
