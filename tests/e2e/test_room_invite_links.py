from __future__ import annotations

import pytest

from .helpers import build_realtime_state, load_app, wait_for_room


pytestmark = [pytest.mark.e2e, pytest.mark.network]


def test_open_room_action_exposes_working_invite_link(browser, base_url):
    host_page = browser.new_page()
    guest_page = browser.new_page()
    try:
        load_app(host_page, base_url)

        state = build_realtime_state(host_page, "overlay", countdown=False)
        host_page.evaluate(
            """({ state }) => {
                document.getElementById("displayName").value = "Host";
                window.RegattaApp.importState(state);
                window.RegattaApp.setMode("play");
                window.RegattaMultiplayer.setPendingRoomDraft({
                    display_name: "Host",
                    max_players: state.boats.length,
                    host_role: "player",
                    source: "map",
                    mode: "edit",
                });
            }""",
            {"state": state},
        )

        host_page.evaluate("""() => document.getElementById("startRoom").click()""")
        host_page.wait_for_function(
            """() => {
                const room = window.RegattaMultiplayer.getRoomState().room;
                return !!room && typeof room.code === "string" && room.code.length === 6;
            }"""
        )

        invite_link = host_page.locator("#roomNotice").inner_text().strip()
        room_code = host_page.locator("#roomCodeValue").inner_text().strip()
        expected_link = f"{base_url}/?room={room_code}&join=1"

        assert expected_link in invite_link

        guest_page.goto(expected_link, wait_until="networkidle")
        guest_page.wait_for_function("() => !!window.RegattaApp && !!window.RegattaMultiplayer")
        guest_page.wait_for_function(
            """(expectedCode) => {
                const room = window.RegattaMultiplayer.getRoomState().room;
                return !!room
                    && room.code === expectedCode
                    && room.players.some((player) => player.is_self);
            }""",
            arg=room_code,
        )

        guest_room = guest_page.evaluate(
            """() => {
                const room = window.RegattaMultiplayer.getRoomState().room;
                const self = room.players.find((player) => player.is_self);
                return {
                    code: room.code,
                    selfName: self?.name || "",
                };
            }"""
        )
        assert guest_room == {"code": room_code, "selfName": "Skipper"}

        joined_room = wait_for_room(
            host_page,
            room_code,
            lambda room: bool(room and room.get("joined_count") == 2),
        )
        assert joined_room["code"] == room_code
    finally:
        guest_page.context.close()
        host_page.context.close()
