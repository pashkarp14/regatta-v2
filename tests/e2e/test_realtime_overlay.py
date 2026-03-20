from __future__ import annotations

import pytest

from .helpers import (
    build_realtime_state,
    create_room,
    debug_world_to_client,
    import_state,
    load_app,
    move_pointer_to_world,
    segment_signature,
    signature_delta,
    start_room,
    wait_for_room,
)


pytestmark = [pytest.mark.e2e]


def test_local_realtime_overlay_draws_guide_line(app_page):
    state = build_realtime_state(app_page, "overlay", countdown=True)
    import_state(app_page, state)

    boat_point = {"x": state["boats"][0]["x"], "y": state["boats"][0]["y"]}
    target_point = {"x": 22, "y": 22}
    start_client = debug_world_to_client(app_page, boat_point)
    end_client = debug_world_to_client(app_page, target_point)

    before = segment_signature(app_page, start_client, end_client)
    move_pointer_to_world(app_page, target_point)
    after = segment_signature(app_page, start_client, end_client)

    assert signature_delta(before, after) > 260


@pytest.mark.network
def test_network_realtime_overlay_survives_live_room_updates(browser, base_url):
    host_page = browser.new_page()
    guest_page = browser.new_page()
    try:
        load_app(host_page, base_url)
        load_app(guest_page, base_url)
        state = build_realtime_state(host_page, "overlay", countdown=True)
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
        wait_for_room(host_page, room_code, lambda room: bool(room and room.get("status") == "live" and (room.get("game_state", {}).get("race") or {}).get("phase") == "countdown"))

        boat_point = {"x": state["boats"][0]["x"], "y": state["boats"][0]["y"]}
        target_point = {"x": 22, "y": 22}
        start_client = debug_world_to_client(host_page, boat_point)
        end_client = debug_world_to_client(host_page, target_point)
        before = segment_signature(host_page, start_client, end_client)

        move_pointer_to_world(host_page, target_point)
        host_page.wait_for_timeout(700)
        after = segment_signature(host_page, start_client, end_client)

        assert signature_delta(before, after) > 260
    finally:
        guest_page.context.close()
        host_page.context.close()
