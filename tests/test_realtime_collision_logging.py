from __future__ import annotations

import logging
from pathlib import Path

import pytest

from regatta_app.factory import create_app
from regatta_app.realtime_engine import (
    resolve_realtime_overlaps,
    resolve_realtime_pressure_jams,
    simulate_realtime_tick,
)


def make_boat(
    x: float,
    y: float,
    *,
    heading: float = 0.0,
    has_heading: bool = False,
) -> dict:
    return {
        "x": x,
        "y": y,
        "distance": 0,
        "turns": 0,
        "penalties": 0,
        "collisions": 0,
        "nextMark": 0,
        "finished": False,
        "place": None,
        "hasHeading": has_heading,
        "heading": heading,
        "tack": 0,
        "color": "boat",
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


def make_realtime_state(boats: list[dict], *, marks: list[dict] | None = None) -> dict:
    return {
        "version": 2,
        "world": {"width": 30, "height": 30},
        "settings": {
            "playMode": "realtime",
            "finishSeparate": False,
            "realtimePrepSeconds": 10,
            "turnRateDegPerSec": 360,
            "interactionMode": "contact",
            "windAngleDeg": 0,
            "deadZoneDeg": 0,
        },
        "course": {
            "markCount": len(marks or []),
            "marks": list(marks or []),
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


def test_mark_unstick_logs_detection_and_resolution(app, caplog):
    boats = [make_boat(12.0, 12.0)]
    marks = [{"x": 12.0, "y": 12.55}]
    settings = {"interactionMode": "contact"}

    with app.app_context(), caplog.at_level(logging.INFO, logger=app.logger.name):
        changed = resolve_realtime_overlaps(
            boats,
            marks,
            1,
            settings,
            world_w=30.0,
            world_h=30.0,
            wind_angle_deg=0.0,
        )

    assert changed is True
    messages = "\n".join(record.getMessage() for record in caplog.records)
    assert "realtime.unstick.mark.detected" in messages
    assert "boat_index=0" in messages
    assert "realtime.unstick.mark.resolved" in messages


def test_boats_unstick_logs_detection_and_resolution(app, caplog):
    boats = [
        make_boat(14.0, 15.0),
        make_boat(14.35, 15.0),
    ]
    settings = {"interactionMode": "contact"}

    with app.app_context(), caplog.at_level(logging.INFO, logger=app.logger.name):
        changed = resolve_realtime_overlaps(
            boats,
            [],
            0,
            settings,
            world_w=30.0,
            world_h=30.0,
            wind_angle_deg=0.0,
        )

    assert changed is True
    messages = "\n".join(record.getMessage() for record in caplog.records)
    assert "realtime.unstick.boats.detected" in messages
    assert "left_index=0" in messages
    assert "right_index=1" in messages
    assert "realtime.unstick.boats.resolved" in messages


def test_pressure_unstick_logs_detection_and_resolution(app, caplog):
    boats = [
        make_boat(14.0, 15.0, has_heading=True),
        make_boat(14.35, 15.0, has_heading=True),
    ]
    proposals = [
        {
            "accepted": True,
            "distance": 0.42,
            "motionDirection": {"x": 1.0, "y": 0.0},
        },
        {
            "accepted": True,
            "distance": 0.42,
            "motionDirection": {"x": -1.0, "y": 0.0},
        },
    ]
    settings = {"interactionMode": "contact"}

    with app.app_context(), caplog.at_level(logging.INFO, logger=app.logger.name):
        changed = resolve_realtime_pressure_jams(
            boats,
            proposals,
            {(0, 1)},
            settings,
            world_w=30.0,
            world_h=30.0,
        )

    assert changed is True
    messages = "\n".join(record.getMessage() for record in caplog.records)
    assert "realtime.unstick.pressure.detected" in messages
    assert "left_index=0" in messages
    assert "right_index=1" in messages
    assert "realtime.unstick.pressure.resolved" in messages


def test_simulate_realtime_tick_logs_mark_collision_detection(app, caplog):
    game_state = make_realtime_state(
        [make_boat(10.0, 10.0, heading=0.0, has_heading=True)],
        marks=[{"x": 11.35, "y": 10.0}],
    )
    controls = {
        0: {
            "active": True,
            "target": {"x": 20.0, "y": 10.0},
        }
    }

    with app.app_context(), caplog.at_level(logging.INFO, logger=app.logger.name):
        simulate_realtime_tick(game_state, controls, 0.5, 10_000)

    messages = "\n".join(record.getMessage() for record in caplog.records)
    assert "realtime.collision.mark.detected" in messages
    assert "boat_index=0" in messages
    assert "mark_index=0" in messages


def test_simulate_realtime_tick_logs_boats_collision_detection_before_unstick(app, caplog):
    game_state = make_realtime_state(
        [
            make_boat(10.0, 10.0, heading=0.0, has_heading=True),
            make_boat(12.05, 10.0, heading=0.0, has_heading=True),
        ]
    )
    controls = {
        0: {
            "active": True,
            "target": {"x": 20.0, "y": 10.0},
        }
    }

    with app.app_context(), caplog.at_level(logging.INFO, logger=app.logger.name):
        simulate_realtime_tick(game_state, controls, 0.5, 10_000)

    messages = "\n".join(record.getMessage() for record in caplog.records)
    assert "realtime.collision.boats.detected" in messages
    assert "boat_index=0" in messages
    assert "other_index=1" in messages
    assert "other_moving=false" in messages
