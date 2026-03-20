from __future__ import annotations

import pytest

from .helpers import (
    BOAT_CLEARANCE,
    MARK_CLEARANCE,
    WALL_CLEARANCE,
    boat_segment_distance,
    build_realtime_state,
    create_room,
    left_wall_segment_clearance,
    load_app,
    mark_segment_distance,
    start_room,
    wait_for_room,
)


pytestmark = [pytest.mark.e2e, pytest.mark.network, pytest.mark.slow]


@pytest.mark.parametrize(
    ("scenario", "assertion"),
    [
        ("mark", lambda room: mark_segment_distance(room["game_state"]) >= MARK_CLEARANCE - 0.02),
        ("boat", lambda room: boat_segment_distance(room["game_state"]) >= BOAT_CLEARANCE - 0.02),
        ("wall", lambda room: left_wall_segment_clearance(room["game_state"]) >= WALL_CLEARANCE - 0.02),
    ],
)
def test_network_realtime_unstick_rescues_authoritative_state(browser, base_url, scenario, assertion):
    host_page = browser.new_page()
    guest_page = browser.new_page()
    try:
        load_app(host_page, base_url)
        load_app(guest_page, base_url)
        state = build_realtime_state(host_page, scenario, countdown=True)
        room_code = create_room(host_page, state)
        guest_page.evaluate(
            """async (roomCode) => {
                document.getElementById("displayName").value = "Guest";
                document.getElementById("joinRoomCode").value = roomCode;
                await window.RegattaMultiplayer.joinRoom();
            }""",
            room_code,
        )
        start_room(host_page, state, room_code=room_code)
        room = wait_for_room(host_page, room_code, assertion, timeout_ms=8_000, interval_ms=200)
        assert room["status"] == "live"
    finally:
        guest_page.context.close()
        host_page.context.close()
