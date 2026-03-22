from __future__ import annotations

import logging
from pathlib import Path

import pytest

from regatta_app.factory import create_app
from regatta_app.realtime_engine import (
    boat_capsule_at,
    point_to_segment,
    resolve_realtime_overlaps,
    resolve_realtime_pressure_jams,
    segment_segment_distance,
    simulate_realtime_tick,
    BOAT_CLEARANCE_MARGIN,
    BOAT_COLLISION_RADIUS,
    MARK_CLEARANCE_MARGIN,
    MARK_RADIUS,
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


def boat_mark_clearance(state: dict, boat_index: int = 0, mark_index: int = 0) -> float:
    boat = state["boats"][boat_index]
    capsule = boat_capsule_at(
        {"x": float(boat["x"]), "y": float(boat["y"])},
        float(boat.get("heading") or 0.0),
        bool(boat.get("hasHeading")),
    )
    return point_to_segment(state["course"]["marks"][mark_index], capsule["a"], capsule["b"])[0]


def boat_boat_clearance(state: dict, left_index: int = 0, right_index: int = 1) -> float:
    left = state["boats"][left_index]
    right = state["boats"][right_index]
    left_capsule = boat_capsule_at(
        {"x": float(left["x"]), "y": float(left["y"])},
        float(left.get("heading") or 0.0),
        bool(left.get("hasHeading")),
    )
    right_capsule = boat_capsule_at(
        {"x": float(right["x"]), "y": float(right["y"])},
        float(right.get("heading") or 0.0),
        bool(right.get("hasHeading")),
    )
    return segment_segment_distance(left_capsule["a"], left_capsule["b"], right_capsule["a"], right_capsule["b"])


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


def test_pressure_unstick_resolves_one_sided_pressure_jam(app, caplog):
    boats = [
        make_boat(36.698, 9.006, has_heading=False),
        make_boat(35.465, 7.737, has_heading=False),
    ]
    proposals = [
        {
            "accepted": True,
            "distance": 0.2,
            "motionDirection": {"x": 0.985, "y": 0.174},
        },
        {
            "accepted": True,
            "distance": 0.2,
            "motionDirection": {"x": 0.73, "y": 0.684},
        },
    ]
    settings = {"interactionMode": "contact"}
    before_clearance = boat_boat_clearance(make_realtime_state(boats))

    with app.app_context(), caplog.at_level(logging.INFO, logger=app.logger.name):
        changed = resolve_realtime_pressure_jams(
            boats,
            proposals,
            {(0, 1)},
            settings,
            world_w=60.0,
            world_h=60.0,
        )

    after_clearance = boat_boat_clearance(make_realtime_state(boats))
    messages = "\n".join(record.getMessage() for record in caplog.records)
    assert changed is True
    assert after_clearance > before_clearance + 0.02
    assert "realtime.unstick.pressure.one_sided.detected" in messages
    assert "pushing_index=1" in messages
    assert "blocked_index=0" in messages
    assert "realtime.unstick.pressure.one_sided.resolved" in messages


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


def test_simulate_realtime_tick_unsticks_active_mark_deadlock(app, caplog):
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
    before_clearance = boat_mark_clearance(game_state)
    required_clearance = BOAT_COLLISION_RADIUS + MARK_RADIUS + MARK_CLEARANCE_MARGIN

    with app.app_context(), caplog.at_level(logging.INFO, logger=app.logger.name):
        changed = simulate_realtime_tick(game_state, controls, 0.5, 10_000)

    after_clearance = boat_mark_clearance(game_state)
    messages = "\n".join(record.getMessage() for record in caplog.records)
    assert changed is True
    assert after_clearance > before_clearance + 0.02
    assert after_clearance >= required_clearance - 0.02
    assert "realtime.stuck.mark.detected" in messages
    assert "realtime.stuck.mark.resolved" in messages


def test_simulate_realtime_tick_unsticks_active_boats_deadlock(app, caplog):
    game_state = make_realtime_state(
        [
            make_boat(10.0, 10.0, heading=0.0, has_heading=True),
            make_boat(11.75, 10.0, heading=0.0, has_heading=True),
        ]
    )
    controls = {
        0: {
            "active": True,
            "target": {"x": 20.0, "y": 10.0},
        }
    }
    before_clearance = boat_boat_clearance(game_state)
    required_clearance = BOAT_COLLISION_RADIUS * 2 + BOAT_CLEARANCE_MARGIN

    with app.app_context(), caplog.at_level(logging.INFO, logger=app.logger.name):
        changed = simulate_realtime_tick(game_state, controls, 0.5, 10_000)

    after_clearance = boat_boat_clearance(game_state)
    messages = "\n".join(record.getMessage() for record in caplog.records)
    assert changed is True
    assert after_clearance > before_clearance + 0.02
    assert after_clearance >= required_clearance - 0.02
    assert "realtime.stuck.boats.detected" in messages
    assert "realtime.stuck.boats.resolved" in messages


def test_simulate_realtime_tick_unsticks_one_sided_proposal_pair_deadlock(app, caplog):
    game_state = make_realtime_state(
        [
            make_boat(36.698, 9.006, heading=0.177, has_heading=True),
            make_boat(35.465, 7.737, heading=0.754, has_heading=True),
        ]
    )
    game_state["world"]["width"] = 60
    game_state["world"]["height"] = 60
    controls = {
        0: {
            "active": True,
            "direction": {"x": 0.985, "y": 0.174},
        },
        1: {
            "active": True,
            "direction": {"x": 0.730, "y": 0.684},
        },
    }
    before_clearance = boat_boat_clearance(game_state)

    with app.app_context(), caplog.at_level(logging.INFO, logger=app.logger.name):
        changed = simulate_realtime_tick(game_state, controls, 0.0833333, 10_000)

    after_clearance = boat_boat_clearance(game_state)
    messages = "\n".join(record.getMessage() for record in caplog.records)
    assert changed is True
    assert after_clearance > before_clearance + 0.02
    assert "realtime.unstick.pressure.one_sided.detected" in messages
    assert "realtime.unstick.pressure.one_sided.resolved" in messages
