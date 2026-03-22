from __future__ import annotations

import math

import pytest

from .helpers import (
    build_realtime_state,
    create_room,
    fetch_room,
    load_app,
    start_room,
    wait_for_room,
)


pytestmark = [pytest.mark.e2e, pytest.mark.network, pytest.mark.slow]


def _join_guest(page, room_code: str) -> None:
    page.evaluate(
        """async (roomCode) => {
            document.getElementById("displayName").value = "Guest";
            document.getElementById("joinRoomCode").value = roomCode;
            await window.RegattaMultiplayer.joinRoom();
        }""",
        room_code,
    )


def _edit_room(page) -> dict:
    return page.evaluate(
        """async () => {
            try {
                await window.RegattaMultiplayer.editRoom();
                return { ok: true, room: window.RegattaMultiplayer.getRoomState().room };
            } catch (error) {
                return { ok: false, message: error?.message || String(error) };
            }
        }"""
    )


def _start_room(page) -> dict:
    return page.evaluate(
        """async () => {
            try {
                await window.RegattaMultiplayer.startRoom({ armRealtime: true });
                return { ok: true, room: window.RegattaMultiplayer.getRoomState().room };
            } catch (error) {
                return { ok: false, message: error?.message || String(error) };
            }
        }"""
    )


def _restore_initial_lobby(page, room_code: str) -> dict:
    return page.evaluate(
        """async (code) => {
            const response = await fetch(`/api/rooms/${code}/reset-lobby`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            });
            let payload = null;
            try {
                payload = await response.json();
            } catch (error) {
                payload = null;
            }
            return {
                ok: response.ok,
                status: response.status,
                payload,
            };
        }""",
        room_code,
    )


def _set_first_mark(page, point: dict[str, float]) -> None:
    page.evaluate(
        """(mark) => {
            const state = window.RegattaApp.exportState();
            state.course.marks[0] = { x: mark.x, y: mark.y };
            window.RegattaApp.importState(state);
            window.dispatchEvent(new CustomEvent("regatta:state-changed"));
        }""",
        point,
    )


def test_host_can_stop_edit_and_restart_room_without_dropping_players(browser, base_url):
    host_page = browser.new_page()
    guest_page = browser.new_page()
    try:
        load_app(host_page, base_url)
        load_app(guest_page, base_url)
        state = build_realtime_state(host_page, "overlay", countdown=False)
        room_code = create_room(host_page, state)
        _join_guest(guest_page, room_code)
        wait_for_room(host_page, room_code, lambda room: bool(room and room.get("start_ready")))
        start_room(host_page, state, room_code=room_code)

        edit_result = _edit_room(host_page)
        assert edit_result["ok"], edit_result

        lobby_room = wait_for_room(
            host_page,
            room_code,
            lambda room: bool(room and room.get("status") == "lobby" and room.get("joined_count") == 2),
        )
        guest_page.wait_for_function(
            """(expectedCode) => {
                const room = window.RegattaMultiplayer.getRoomState().room;
                return !!room
                    && room.code === expectedCode
                    && room.status === "lobby"
                    && room.players.some((player) => player.is_self);
            }""",
            arg=room_code,
        )

        edited_mark = {"x": 9.5, "y": 17.25}
        _set_first_mark(host_page, edited_mark)
        lobby_room = wait_for_room(
            host_page,
            room_code,
            lambda room: (
                room is not None
                and room.get("status") == "lobby"
                and math.isclose(room["game_state"]["course"]["marks"][0]["x"], edited_mark["x"], abs_tol=1e-6)
                and math.isclose(room["game_state"]["course"]["marks"][0]["y"], edited_mark["y"], abs_tol=1e-6)
            ),
        )
        assert lobby_room["code"] == room_code

        restart_result = _start_room(host_page)
        assert restart_result["ok"], restart_result
        live_room = wait_for_room(
            host_page,
            room_code,
            lambda room: (
                room is not None
                and room.get("status") == "live"
                and math.isclose(room["game_state"]["course"]["marks"][0]["x"], edited_mark["x"], abs_tol=1e-6)
                and math.isclose(room["game_state"]["course"]["marks"][0]["y"], edited_mark["y"], abs_tol=1e-6)
            ),
        )
        assert live_room["joined_count"] == 2
        guest_page.wait_for_function(
            """(expectedCode) => {
                const room = window.RegattaMultiplayer.getRoomState().room;
                return !!room
                    && room.code === expectedCode
                    && room.status === "live"
                    && room.players.some((player) => player.is_self);
            }""",
            arg=room_code,
        )
    finally:
        guest_page.context.close()
        host_page.context.close()


def test_host_can_restore_initial_lobby_snapshot_without_dropping_players(browser, base_url):
    host_page = browser.new_page()
    guest_page = browser.new_page()
    try:
        load_app(host_page, base_url)
        load_app(guest_page, base_url)
        state = build_realtime_state(host_page, "overlay", countdown=False)
        initial_mark = dict(state["course"]["marks"][0])
        room_code = create_room(host_page, state)
        _join_guest(guest_page, room_code)
        wait_for_room(host_page, room_code, lambda room: bool(room and room.get("start_ready")))

        edited_mark = {"x": 7.25, "y": 18.0}
        _set_first_mark(host_page, edited_mark)
        wait_for_room(
            host_page,
            room_code,
            lambda room: (
                room is not None
                and room.get("status") == "lobby"
                and math.isclose(room["game_state"]["course"]["marks"][0]["x"], edited_mark["x"], abs_tol=1e-6)
                and math.isclose(room["game_state"]["course"]["marks"][0]["y"], edited_mark["y"], abs_tol=1e-6)
            ),
        )

        start_room(host_page, fetch_room(host_page, room_code)["room"]["game_state"], room_code=room_code)
        reset_result = _restore_initial_lobby(host_page, room_code)
        assert reset_result["ok"], reset_result

        lobby_room = wait_for_room(
            host_page,
            room_code,
            lambda room: (
                room is not None
                and room.get("status") == "lobby"
                and room.get("joined_count") == 2
                and math.isclose(room["game_state"]["course"]["marks"][0]["x"], initial_mark["x"], abs_tol=1e-6)
                and math.isclose(room["game_state"]["course"]["marks"][0]["y"], initial_mark["y"], abs_tol=1e-6)
            ),
        )
        assert lobby_room["code"] == room_code
        guest_page.wait_for_function(
            """(expectedCode) => {
                const room = window.RegattaMultiplayer.getRoomState().room;
                return !!room
                    && room.code === expectedCode
                    && room.status === "lobby"
                    && room.players.some((player) => player.is_self);
            }""",
            arg=room_code,
        )
    finally:
        guest_page.context.close()
        host_page.context.close()


def test_host_reset_in_lobby_preview_keeps_countdown_phase(browser, base_url):
    host_page = browser.new_page()
    guest_page = browser.new_page()
    try:
        load_app(host_page, base_url)
        load_app(guest_page, base_url)
        state = build_realtime_state(host_page, "overlay", countdown=False)
        room_code = create_room(host_page, state)
        _join_guest(guest_page, room_code)
        wait_for_room(host_page, room_code, lambda room: bool(room and room.get("start_ready")))
        start_room(host_page, state, room_code=room_code)

        edit_result = _edit_room(host_page)
        assert edit_result["ok"], edit_result

        lobby_room = wait_for_room(
            host_page,
            room_code,
            lambda room: bool(room and room.get("status") == "lobby"),
        )
        assert lobby_room["game_state"]["race"]["phase"] == "countdown"
        assert lobby_room["game_state"]["race"]["isLobbyPreview"] is True

        host_page.evaluate("""() => window.RegattaApp.resetRaceToReadyState()""")

        host_page.wait_for_function(
            """() => {
                const state = window.RegattaApp.exportState();
                return state?.race?.phase === "countdown" && state?.race?.isLobbyPreview === true;
            }"""
        )
        lobby_room = wait_for_room(
            host_page,
            room_code,
            lambda room: bool(
                room
                and room.get("status") == "lobby"
                and (room.get("game_state", {}).get("race") or {}).get("phase") == "countdown"
                and (room.get("game_state", {}).get("race") or {}).get("isLobbyPreview") is True
            ),
        )
        assert lobby_room["code"] == room_code
    finally:
        guest_page.context.close()
        host_page.context.close()
