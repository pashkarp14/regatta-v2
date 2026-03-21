from __future__ import annotations

import re

import pytest

from .helpers import build_realtime_state, load_app, wait_for_room


pytestmark = [pytest.mark.e2e, pytest.mark.network]


def test_invite_link_opens_join_flow_and_guest_stays_in_lobby_on_start(browser, base_url):
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
                const overlay = document.getElementById("mainMenuOverlay");
                const room = window.RegattaMultiplayer.getRoomState().room;
                const inviteCode = document.getElementById("menuInviteRoomCode");
                return overlay?.dataset?.screen === "invite"
                    && !room
                    && inviteCode?.textContent?.includes(expectedCode);
            }""",
            arg=room_code,
        )

        assert guest_page.evaluate("() => window.RegattaMultiplayer.getRoomState().room") is None
        assert guest_page.locator("#menuInviteDisplayName").is_visible()
        assert guest_page.locator("#menuInviteContinue").is_visible()
        assert guest_page.locator("#menuJoinCode").is_hidden()

        guest_page.locator("#menuInviteDisplayName").fill("Crewmate")
        guest_page.locator("#menuInviteContinue").click()
        guest_page.wait_for_function(
            """({ expectedCode, expectedName }) => {
                const room = window.RegattaMultiplayer.getRoomState().room;
                const self = room?.players?.find((player) => player.is_self);
                return !!room
                    && room.code === expectedCode
                    && self?.name === expectedName;
            }""",
            arg={"expectedCode": room_code, "expectedName": "Crewmate"},
        )
        guest_page.wait_for_function(
            """() => {
                const url = new URL(window.location.href);
                return !url.searchParams.has("room") && !url.searchParams.has("join");
            }"""
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
        assert guest_room == {"code": room_code, "selfName": "Crewmate"}

        joined_room = wait_for_room(
            host_page,
            room_code,
            lambda room: bool(room and room.get("joined_count") == 2),
        )
        assert joined_room["code"] == room_code

        host_page.evaluate(
            """({ state }) => {
                window.RegattaApp.importState(state);
                window.RegattaApp.setMode("play");
            }""",
            {"state": state},
        )
        host_page.evaluate("""() => window.RegattaMultiplayer.startRoom({ armRealtime: true })""")

        guest_page.wait_for_function(
            """({ expectedCode, expectedName }) => {
                const room = window.RegattaMultiplayer.getRoomState().room;
                const self = room?.players?.find((player) => player.is_self);
                return !!room
                    && room.code === expectedCode
                    && room.status === "live"
                    && self?.name === expectedName;
            }""",
            arg={"expectedCode": room_code, "expectedName": "Crewmate"},
        )
    finally:
        guest_page.context.close()
        host_page.context.close()


def test_stale_page_refreshes_before_opening_room(page, base_url):
    load_app(page, base_url)

    state = build_realtime_state(page, "overlay", countdown=False)
    page.evaluate(
        """({ state }) => {
            document.documentElement.dataset.assetVersion = "stale-build";
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

    page.evaluate("""() => document.getElementById("startRoom").click()""")
    page.wait_for_url(re.compile(re.escape(base_url) + r"/\?_asset=.*"))
    page.wait_for_function("() => !!window.RegattaApp && !!window.RegattaMultiplayer")

    refreshed_state = build_realtime_state(page, "overlay", countdown=False)
    page.evaluate(
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
        {"state": refreshed_state},
    )

    page.evaluate("""() => document.getElementById("startRoom").click()""")
    page.wait_for_function(
        """() => {
            const room = window.RegattaMultiplayer.getRoomState().room;
            return !!room && typeof room.code === "string" && room.code.length === 6;
        }"""
    )

    room_code = page.locator("#roomCodeValue").inner_text().strip()
    notice = page.locator("#roomNotice").inner_text().strip()

    assert f"{base_url}/?room={room_code}&join=1" in notice
