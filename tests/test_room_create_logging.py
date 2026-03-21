from __future__ import annotations

import logging
from pathlib import Path

import pytest

from regatta_app.factory import create_app


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
        }
    )
    yield app


def test_create_room_logs_request_and_success(app, caplog):
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
    messages = "\n".join(record.getMessage() for record in caplog.records)
    room_code = response.get_json()["room"]["code"]

    assert "room.create.request" in messages
    assert "room.create.begin" in messages
    assert f"room.create.success room_code={room_code}" in messages
    assert f"room.create.response room_code={room_code}" in messages


def test_create_room_logs_rejection_reason(app, caplog):
    client = app.test_client()

    with caplog.at_level(logging.INFO, logger=app.logger.name):
        response = client.post(
            "/api/rooms",
            json={
                "display_name": "Host",
                "host_role": "player",
                "max_players": 25,
                "game_state": make_realtime_state(),
            },
        )

    assert response.status_code == 422, response.get_json()
    messages = "\n".join(record.getMessage() for record in caplog.records)

    assert "room.create.request" in messages
    assert "room.create.begin" in messages
    assert "room.create.rejected" in messages
    assert "Room size cannot exceed 20 boats." in messages


def test_create_room_proceeds_when_previous_room_cleanup_crashes(app, caplog, monkeypatch):
    client = app.test_client()
    first_response = client.post(
        "/api/rooms",
        json={
            "display_name": "Host",
            "host_role": "player",
            "max_players": 2,
            "game_state": make_realtime_state(),
        },
    )
    assert first_response.status_code == 200, first_response.get_json()
    first_room_code = first_response.get_json()["room"]["code"]

    def run_immediately(task, *args, **kwargs):
        return task(*args, **kwargs)

    def fail_cleanup(room_code, player_token):
        raise RuntimeError(f"cleanup failure for {room_code}")

    monkeypatch.setattr(app.extensions["socketio"], "start_background_task", run_immediately)
    monkeypatch.setattr(app.extensions["room_store"], "remove_player", fail_cleanup)

    with caplog.at_level(logging.INFO, logger=app.logger.name):
        second_response = client.post(
            "/api/rooms",
            json={
                "display_name": "Host",
                "host_role": "player",
                "max_players": 2,
                "game_state": make_realtime_state(),
            },
        )

    assert second_response.status_code == 200, second_response.get_json()
    second_room_code = second_response.get_json()["room"]["code"]
    assert second_room_code != first_room_code

    messages = "\n".join(record.getMessage() for record in caplog.records)
    assert f"room.create.session_reset previous_room_code={first_room_code}" in messages
    assert f"room.create.cleanup_previous_room.scheduled previous_room_code={first_room_code}" in messages
    assert f"room.create.cleanup_previous_room.begin previous_room_code={first_room_code}" in messages
    assert f"room.create.cleanup_previous_room.crashed previous_room_code={first_room_code}" in messages
    assert f"room.create.success room_code={second_room_code}" in messages
