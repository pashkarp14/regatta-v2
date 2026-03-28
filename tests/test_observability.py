from __future__ import annotations

import logging
import time
from pathlib import Path

import pytest

from regatta_app import factory as factory_module
from regatta_app import sockets as realtime_sockets
from regatta_app.api import rooms as rooms_api
from regatta_app.factory import create_app
from regatta_app.extensions import socketio
from regatta_app import sockets as sockets_module


def make_realtime_state(boat_count: int = 2) -> dict:
    boats = []
    for index in range(boat_count):
        boats.append(
            {
                "x": 8 + index * 3,
                "y": 8 + index * 2,
                "distance": 0,
                "turns": 0,
                "penalties": 0,
                "collisions": 0,
                "nextMark": 0,
                "finished": False,
                "place": None,
                "hasHeading": False,
                "heading": 0,
                "tack": 0,
                "color": f"boat-{index}",
                "speedCoeff": 1.0,
                "currentSpeedUnitsPerSec": 0,
                "penaltySlowUntil": 0,
                "lastPenaltyAt": 0,
                "lastPenaltyKey": "",
                "lastPenaltyReason": "",
                "roundInZone": False,
                "roundSweep": 0,
                "startDeltaMs": None,
                "falseStartDeltaMs": None,
            }
        )

    return {
        "version": 2,
        "world": {"width": 30, "height": 30},
        "settings": {
            "playMode": "realtime",
            "finishSeparate": False,
            "realtimePrepSeconds": 10,
            "turnRateDegPerSec": 120,
            "interactionMode": "contact",
        },
        "course": {
            "markCount": 1,
            "marks": [{"x": 22, "y": 22}],
            "startA": {"x": 8, "y": 2},
            "startB": {"x": 22, "y": 2},
            "finishA": {"x": 8, "y": 2},
            "finishB": {"x": 22, "y": 2},
        },
        "race": {
            "phase": "race",
            "raceFinishedCount": 0,
            "realtimeCountdownEndsAt": 0,
            "realtimePaused": False,
            "realtimePauseStartedAt": 0,
            "gustExpiresAt": 0,
            "nextAutoGustAt": 0,
        },
        "boats": boats,
    }


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
            "STRUCTURED_LOGS": True,
            "CLIENT_TELEMETRY_ENABLED": True,
            "SLOW_TICK_WARN_MS": 1,
        }
    )
    yield app


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
        value = line.rsplit(" ", 1)[-1]
        return float(value)
    return None


def _create_room(client, *, display_name: str = "Host") -> str:
    response = client.post(
        "/api/rooms",
        json={
            "display_name": display_name,
            "host_role": "player",
            "max_players": 2,
            "game_state": make_realtime_state(),
        },
    )
    assert response.status_code == 200, response.get_json()
    return response.get_json()["room"]["code"]


def test_http_requests_get_request_id_and_metrics(app):
    client = app.test_client()

    response = client.get("/api/bootstrap")

    assert response.status_code == 200
    assert response.headers["X-Request-Id"]

    metrics_response = client.get("/metrics")
    assert metrics_response.status_code == 200
    metrics_text = metrics_response.get_data(as_text=True)

    assert (
        _metric_value(
            metrics_text,
            "regatta_http_requests_total",
            {"endpoint": "/api/bootstrap", "method": "GET", "status": "200"},
        )
        or 0
    ) >= 1


def test_structured_logs_attach_event_and_request_id(app, caplog):
    client = app.test_client()

    with caplog.at_level(logging.INFO, logger=app.logger.name):
        response = client.post(
            "/api/rooms",
            json={
                "display_name": "Host",
                "host_role": "player",
                "max_players": 2,
                "game_state": make_realtime_state(),
            },
        )

    assert response.status_code == 200, response.get_json()
    matching = [record for record in caplog.records if getattr(record, "event_name", "") == "room.create.request"]
    assert matching
    assert getattr(matching[0], "request_id", "")


def test_create_app_uses_socketio_message_queue_from_config(tmp_path: Path, monkeypatch):
    library_dir = tmp_path / "library"
    library_dir.mkdir()
    captured: dict[str, object] = {}

    monkeypatch.setattr(factory_module.session_ext, "init_app", lambda app: None)

    def fake_init_app(app, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(factory_module.socketio, "init_app", fake_init_app)

    create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SESSION_TYPE": "filesystem",
            "LIBRARY_DIR": str(library_dir),
            "ROOM_TTL_SECONDS": 3600,
            "REDIS_URL": "redis://redis:6380/0",
            "SOCKETIO_MESSAGE_QUEUE": "redis://redis:6380/1",
        }
    )

    assert captured.get("message_queue") == "redis://redis:6380/1"
    assert captured.get("async_mode") == "threading"


def test_socket_join_records_metrics(app):
    host = app.test_client()
    guest = app.test_client()
    room_code = _create_room(host)

    join_response = guest.post(
        "/api/rooms/join",
        json={
            "display_name": "Guest",
            "room_code": room_code,
        },
    )
    assert join_response.status_code == 200, join_response.get_json()

    socket_client = socketio.test_client(app, flask_test_client=guest)
    assert socket_client.is_connected()
    socket_client.emit("room:join_socket", {"room_code": room_code})
    socket_client.get_received()

    metrics_text = host.get("/metrics").get_data(as_text=True)
    assert (
        _metric_value(
            metrics_text,
            "regatta_socket_events_total",
            {"event": "room:join_socket", "result": "ok"},
        )
        or 0
    ) >= 1
    assert (_metric_value(metrics_text, "regatta_socket_connected_clients") or 0) >= 1


def test_socket_join_logs_snapshot_sent_flag(app, caplog):
    host = app.test_client()
    guest = app.test_client()
    room_code = _create_room(host)

    join_response = guest.post(
        "/api/rooms/join",
        json={
            "display_name": "Guest",
            "room_code": room_code,
        },
    )
    assert join_response.status_code == 200, join_response.get_json()
    room_revision = join_response.get_json()["room"]["revision"]

    socket_client = socketio.test_client(app, flask_test_client=guest)
    assert socket_client.is_connected()

    with caplog.at_level(logging.INFO, logger=app.logger.name):
        socket_client.emit(
            "room:join_socket",
            {"room_code": room_code, "known_revision": room_revision},
        )
        socket_client.get_received()

    matching = [
        record
        for record in caplog.records
        if getattr(record, "event_name", "") == "socket.event.handled"
        and getattr(record, "event_fields", {}).get("socket_event") == "room:join_socket"
    ]
    assert matching
    assert matching[-1].event_fields.get("snapshot_sent") is False


def test_room_join_logs_observer_capacity_fields(app, caplog):
    host = app.test_client()
    guest_one = app.test_client()
    guest_two = app.test_client()
    room_code = _create_room(host)

    first_join = guest_one.post(
        "/api/rooms/join",
        json={
            "display_name": "Guest One",
            "room_code": room_code,
        },
    )
    assert first_join.status_code == 200, first_join.get_json()

    with caplog.at_level(logging.INFO, logger=app.logger.name):
        second_join = guest_two.post(
            "/api/rooms/join",
            json={
                "display_name": "Guest Two",
                "room_code": room_code,
            },
        )

    assert second_join.status_code == 200, second_join.get_json()
    matching = [
        record
        for record in caplog.records
        if getattr(record, "event_name", "") == "room.join.response"
    ]
    assert matching
    assert matching[-1].event_fields.get("joined_racers_count") == 2
    assert matching[-1].event_fields.get("joined_observers_count") == 1
    assert matching[-1].event_fields.get("max_racers") == 2
    assert matching[-1].event_fields.get("max_observers") == 98


def test_live_room_loop_checkpoints_instead_of_saving_every_changed_tick(app, monkeypatch):
    host = app.test_client()
    room_code = _create_room(host)

    monkeypatch.setattr(rooms_api, "ensure_realtime_room_loop", lambda _room_code: None)
    room_snapshot = host.get(f"/api/rooms/{room_code}").get_json()["room"]
    start_response = host.post(
        f"/api/rooms/{room_code}/start",
        json={
            "arm_realtime": True,
            "game_state": room_snapshot["game_state"],
        },
    )
    assert start_response.status_code == 200, start_response.get_json()

    class CountingRoomStore:
        def __init__(self, inner) -> None:
            self.inner = inner
            self.save_calls = 0

        def __getattr__(self, name):
            return getattr(self.inner, name)

        def save_room(self, room):
            self.save_calls += 1
            return self.inner.save_room(room)

    class FakeClock:
        def __init__(self) -> None:
            self.current = 1_000.0

        def time(self) -> float:
            return self.current

        def advance(self, seconds: float) -> None:
            self.current += seconds

    original_store = app.extensions["room_store"]
    counting_store = CountingRoomStore(original_store)
    app.extensions["room_store"] = counting_store
    if "live_runtime" in app.extensions:
        app.extensions["live_runtime"].drop_room(room_code)

    fake_clock = FakeClock()
    changed_ticks = {"count": 0}
    sleep_calls = {"count": 0}

    def changed_tick(game_state, controls, dt_seconds, now_ms):
        changed_ticks["count"] += 1
        game_state["boats"][0]["x"] = float(game_state["boats"][0]["x"]) + 0.5
        return True

    def fake_sleep(seconds):
        fake_clock.advance(seconds)
        sleep_calls["count"] += 1
        if sleep_calls["count"] >= 4:
            raise RuntimeError("stop loop")

    monkeypatch.setattr(sockets_module, "simulate_realtime_tick", changed_tick)
    monkeypatch.setattr(sockets_module, "broadcast_room_state", lambda room: None)
    monkeypatch.setattr(sockets_module, "room_has_connected_socket", lambda _room_code: True)
    monkeypatch.setattr(sockets_module.socketio, "sleep", fake_sleep)
    monkeypatch.setattr(sockets_module.time, "time", fake_clock.time)

    with pytest.raises(RuntimeError, match="stop loop"):
        sockets_module.run_realtime_room_loop(app, room_code)

    assert changed_ticks["count"] >= 4
    assert counting_store.save_calls < changed_ticks["count"]


def test_slow_realtime_tick_logs_warning_and_metric(app, caplog, monkeypatch):
    host = app.test_client()
    room_code = _create_room(host)
    room_snapshot = host.get(f"/api/rooms/{room_code}").get_json()["room"]
    start_response = host.post(
        f"/api/rooms/{room_code}/start",
        json={
            "arm_realtime": True,
            "game_state": room_snapshot["game_state"],
        },
    )
    assert start_response.status_code == 200, start_response.get_json()

    def slow_tick(game_state, controls, dt_seconds, now_ms):
        time.sleep(0.01)
        return False

    def stop_after_first_sleep(_seconds):
        raise RuntimeError("stop loop")

    monkeypatch.setattr(sockets_module, "simulate_realtime_tick", slow_tick)
    monkeypatch.setattr(sockets_module, "broadcast_room_state", lambda room: None)
    monkeypatch.setattr(sockets_module, "room_has_connected_socket", lambda _room_code: True)
    monkeypatch.setattr(sockets_module.socketio, "sleep", stop_after_first_sleep)

    with caplog.at_level(logging.WARNING, logger=app.logger.name), pytest.raises(RuntimeError, match="stop loop"):
        sockets_module.run_realtime_room_loop(app, room_code)

    matching = [record for record in caplog.records if getattr(record, "event_name", "") == "realtime.loop.tick.slow"]
    assert matching

    metrics_text = host.get("/metrics").get_data(as_text=True)
    assert (_metric_value(metrics_text, "regatta_realtime_tick_duration_seconds_count") or 0) >= 1
