from __future__ import annotations

import math

import pytest

from .helpers import (
    BOAT_CLEARANCE,
    MARK_CLEARANCE,
    WALL_CLEARANCE,
    advance_time,
    boat_segment_distance,
    build_realtime_state,
    import_state,
    left_wall_segment_clearance,
    mark_segment_distance,
)


pytestmark = [pytest.mark.e2e]


@pytest.mark.parametrize(
    ("scenario", "assertion"),
    [
        ("mark", lambda state: mark_segment_distance(state) >= MARK_CLEARANCE - 0.02),
        ("boat", lambda state: boat_segment_distance(state) >= BOAT_CLEARANCE - 0.02),
        ("wall", lambda state: left_wall_segment_clearance(state) >= WALL_CLEARANCE - 0.02),
        (
            "wall_plus_mark",
            lambda state: left_wall_segment_clearance(state) >= WALL_CLEARANCE - 0.02
            and mark_segment_distance(state) >= MARK_CLEARANCE - 0.02,
        ),
    ],
)
def test_local_realtime_unstick_rescues_stuck_boats(app_page, scenario, assertion):
    state = build_realtime_state(app_page, scenario, countdown=True)
    import_state(app_page, state)
    result = advance_time(app_page, 150)

    assert assertion(result)
    assert math.isclose(result["boats"][0]["currentSpeedUnitsPerSec"], 0.0, abs_tol=1e-6)
