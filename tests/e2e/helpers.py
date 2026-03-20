from __future__ import annotations

import math
import time
from typing import Any

from playwright.sync_api import Browser, Page, expect


BOARD_SELECTOR = "#board"
WORLD_SIZE = 30
COUNTDOWN_MS = 8_000
BOAT_HALF_SEGMENT = max(0.0, (1.55 - 0.78) / 2)
MARK_CLEARANCE = 0.28 + 0.39 + 0.16
WALL_CLEARANCE = 0.39 + 0.16
BOAT_CLEARANCE = 0.39 + 0.39 + 0.16


def load_app(page: Page, base_url: str) -> None:
    page.goto(base_url, wait_until="networkidle")
    page.wait_for_function("() => !!window.RegattaApp && !!window.RegattaMultiplayer")
    expect(page.locator(BOARD_SELECTOR)).to_be_visible()


def build_realtime_state(page: Page, scenario: str, *, countdown: bool = True) -> dict[str, Any]:
    return page.evaluate(
        """({ scenario, countdown, countdownMs, worldSize }) => {
            const app = window.RegattaApp;
            const state = app.exportState();
            const now = Date.now();
            state.world.width = worldSize;
            state.world.height = worldSize;
            state.settings.playMode = "realtime";
            state.settings.interactionMode = "contact";
            state.settings.realtimePrepSeconds = countdown ? countdownMs / 1000 : 0;
            state.settings.finishSeparate = false;
            state.settings.deadZoneDeg = 40;
            state.course.markCount = 1;
            state.course.marks = [{ x: 24, y: 24 }];
            state.course.startA = { x: 8, y: 2 };
            state.course.startB = { x: 22, y: 2 };
            state.course.finishA = { ...state.course.startA };
            state.course.finishB = { ...state.course.startB };

            const boats = state.boats.slice(0, 2).map((boat, index) => ({
              ...boat,
              x: 8 + index * 6,
              y: 8 + index * 3,
              distance: 0,
              turns: 0,
              penalties: 0,
              collisions: 0,
              nextMark: 0,
              finished: false,
              place: null,
              hasHeading: false,
              heading: 0,
              tack: 0,
              currentSpeedUnitsPerSec: 0,
              penaltySlowUntil: 0,
              lastPenaltyAt: 0,
              lastPenaltyKey: "",
              lastPenaltyReason: "",
              roundInZone: false,
              roundSweep: 0,
              startDeltaMs: null,
              falseStartDeltaMs: null,
            }));

            switch (scenario) {
              case "overlay":
                boats[0].x = 8;
                boats[0].y = 8;
                boats[1].x = 25;
                boats[1].y = 25;
                state.course.marks = [{ x: 27, y: 27 }];
                break;
              case "mark":
                boats[0].x = 12.0;
                boats[0].y = 12.0;
                boats[1].x = 24;
                boats[1].y = 24;
                state.course.marks = [{ x: 12.0, y: 12.55 }];
                break;
              case "boat":
                boats[0].x = 14.0;
                boats[0].y = 15.0;
                boats[1].x = 14.35;
                boats[1].y = 15.0;
                state.course.marks = [{ x: 26, y: 26 }];
                break;
              case "wall":
                boats[0].x = 0.05;
                boats[0].y = 10.0;
                boats[1].x = 24.0;
                boats[1].y = 24.0;
                state.course.marks = [{ x: 26, y: 26 }];
                break;
              case "wall_plus_mark":
                boats[0].x = 0.12;
                boats[0].y = 10.5;
                boats[1].x = 24.0;
                boats[1].y = 24.0;
                state.course.marks = [{ x: 0.12, y: 11.1 }];
                break;
              default:
                throw new Error(`Unknown scenario: ${scenario}`);
            }

            state.boats = boats;
            state.race.phase = countdown ? "countdown" : "race";
            state.race.currentPlayer = 0;
            state.race.raceFinishedCount = 0;
            state.race.subMovesLeft = 0;
            state.race.prestartRoundsLeft = 0;
            state.race.realtimePaused = false;
            state.race.realtimePauseStartedAt = 0;
            state.race.realtimeCountdownEndsAt = countdown ? (now + countdownMs) : 0;
            return state;
        }""",
        {"scenario": scenario, "countdown": countdown, "countdownMs": COUNTDOWN_MS, "worldSize": WORLD_SIZE},
    )


def build_wall_plus_mark_pressure_state(page: Page) -> tuple[dict[str, Any], dict[str, float]]:
    state = build_realtime_state(page, "wall_plus_mark", countdown=False)
    state["boats"][0]["x"] = 0.3125907724703513
    state["boats"][0]["y"] = 11.22011130805209
    state["course"]["marks"][0] = {
        "x": 0.7133090949862662,
        "y": 11.431344668183305,
    }
    target = {"x": -5.0, "y": state["course"]["marks"][0]["y"]}
    return state, target


def import_state(page: Page, state: dict[str, Any]) -> None:
    page.evaluate(
        """(state) => {
            window.RegattaApp.importState(state);
            window.RegattaApp.setMode("play");
        }""",
        state,
    )


def export_state(page: Page) -> dict[str, Any]:
    return page.evaluate("() => window.RegattaApp.exportState()")


def advance_time(page: Page, ms: int) -> dict[str, Any]:
    return page.evaluate(
        """(ms) => {
            window.RegattaApp.advanceTime(ms);
            return window.RegattaApp.exportState();
        }""",
        ms,
    )


def debug_world_to_client(page: Page, point: dict[str, float]) -> dict[str, float]:
    return page.evaluate("(point) => window.RegattaApp.debugWorldToClient(point)", point)


def move_pointer_to_world(page: Page, point: dict[str, float]) -> dict[str, float]:
    client_point = debug_world_to_client(page, point)
    page.evaluate(
        """(clientPoint) => {
            const canvas = document.getElementById("board");
            const eventInit = {
              bubbles: true,
              cancelable: true,
              composed: true,
              clientX: clientPoint.x,
              clientY: clientPoint.y,
              pointerType: "mouse",
            };
            canvas.dispatchEvent(new PointerEvent("pointermove", eventInit));
            canvas.dispatchEvent(new MouseEvent("mousemove", eventInit));
        }""",
        client_point,
    )
    page.wait_for_timeout(50)
    return client_point


def segment_signature(page: Page, start_client: dict[str, float], end_client: dict[str, float], *, samples: int = 14) -> list[float]:
    return page.evaluate(
        """({ startClient, endClient, samples }) => {
            const canvas = document.getElementById("board");
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            const rect = canvas.getBoundingClientRect();
            const toCanvas = (point) => ({
              x: (point.x - rect.left) * (canvas.width / rect.width),
              y: (point.y - rect.top) * (canvas.height / rect.height),
            });
            const start = toCanvas(startClient);
            const end = toCanvas(endClient);
            const values = [];
            for (let index = 1; index <= samples; index++) {
              const t = index / (samples + 1);
              const x = Math.round(start.x + (end.x - start.x) * t);
              const y = Math.round(start.y + (end.y - start.y) * t);
              const sampleX = Math.max(0, Math.min(canvas.width - 3, x - 1));
              const sampleY = Math.max(0, Math.min(canvas.height - 3, y - 1));
              const data = ctx.getImageData(sampleX, sampleY, 3, 3).data;
              let red = 0;
              let green = 0;
              let blue = 0;
              let count = 0;
              for (let offset = 0; offset < data.length; offset += 4) {
                red += data[offset];
                green += data[offset + 1];
                blue += data[offset + 2];
                count += 1;
              }
              values.push(red / count, green / count, blue / count);
            }
            return values;
        }""",
        {"startClient": start_client, "endClient": end_client, "samples": samples},
    )


def signature_delta(before: list[float], after: list[float]) -> float:
    return sum(abs(left - right) for left, right in zip(before, after))


def _boat_axis(boat: dict[str, Any]) -> tuple[float, float]:
    heading = float(boat.get("heading") or 0.0)
    if boat.get("hasHeading"):
        return math.cos(heading), math.sin(heading)
    return 0.0, 1.0


def _boat_segment(boat: dict[str, Any]) -> tuple[tuple[float, float], tuple[float, float]]:
    axis_x, axis_y = _boat_axis(boat)
    return (
        (float(boat["x"]) - axis_x * BOAT_HALF_SEGMENT, float(boat["y"]) - axis_y * BOAT_HALF_SEGMENT),
        (float(boat["x"]) + axis_x * BOAT_HALF_SEGMENT, float(boat["y"]) + axis_y * BOAT_HALF_SEGMENT),
    )


def _point_to_segment_distance(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    ab_x = end[0] - start[0]
    ab_y = end[1] - start[1]
    ap_x = point[0] - start[0]
    ap_y = point[1] - start[1]
    ab2 = ab_x * ab_x + ab_y * ab_y
    if ab2 <= 1e-12:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    t = max(0.0, min(1.0, (ap_x * ab_x + ap_y * ab_y) / ab2))
    proj_x = start[0] + t * ab_x
    proj_y = start[1] + t * ab_y
    return math.hypot(point[0] - proj_x, point[1] - proj_y)


def _segment_distance(
    left_start: tuple[float, float],
    left_end: tuple[float, float],
    right_start: tuple[float, float],
    right_end: tuple[float, float],
) -> float:
    def dot2(ax: float, ay: float, bx: float, by: float) -> float:
        return ax * bx + ay * by

    eps = 1e-9
    ux, uy = left_end[0] - left_start[0], left_end[1] - left_start[1]
    vx, vy = right_end[0] - right_start[0], right_end[1] - right_start[1]
    wx, wy = left_start[0] - right_start[0], left_start[1] - right_start[1]

    a = dot2(ux, uy, ux, uy)
    b = dot2(ux, uy, vx, vy)
    c = dot2(vx, vy, vx, vy)
    d = dot2(ux, uy, wx, wy)
    e = dot2(vx, vy, wx, wy)
    det = a * c - b * b

    s_n = det
    s_d = det
    t_n = det
    t_d = det

    if det < eps:
        s_n = 0.0
        s_d = 1.0
        t_n = e
        t_d = c
    else:
        s_n = b * e - c * d
        t_n = a * e - b * d
        if s_n < 0.0:
            s_n = 0.0
            t_n = e
            t_d = c
        elif s_n > s_d:
            s_n = s_d
            t_n = e + b
            t_d = c

    if t_n < 0.0:
        t_n = 0.0
        if -d < 0.0:
            s_n = 0.0
        elif -d > a:
            s_n = s_d
        else:
            s_n = -d
            s_d = a
    elif t_n > t_d:
        t_n = t_d
        if (-d + b) < 0.0:
            s_n = 0.0
        elif (-d + b) > a:
            s_n = s_d
        else:
            s_n = -d + b
            s_d = a

    sc = 0.0 if abs(s_n) < eps else s_n / s_d
    tc = 0.0 if abs(t_n) < eps else t_n / t_d
    dx = wx + sc * ux - tc * vx
    dy = wy + sc * uy - tc * vy
    return math.hypot(dx, dy)


def mark_segment_distance(state: dict[str, Any], boat_index: int = 0, mark_index: int = 0) -> float:
    segment = _boat_segment(state["boats"][boat_index])
    mark = state["course"]["marks"][mark_index]
    return _point_to_segment_distance((float(mark["x"]), float(mark["y"])), *segment)


def boat_segment_distance(state: dict[str, Any], left_index: int = 0, right_index: int = 1) -> float:
    left_segment = _boat_segment(state["boats"][left_index])
    right_segment = _boat_segment(state["boats"][right_index])
    return _segment_distance(*left_segment, *right_segment)


def left_wall_segment_clearance(state: dict[str, Any], boat_index: int = 0) -> float:
    start, end = _boat_segment(state["boats"][boat_index])
    return min(start[0], end[0])


def create_room(page: Page, state: dict[str, Any], *, display_name: str = "Host") -> str:
    page.evaluate(
        """async ({ state, displayName }) => {
            document.getElementById("displayName").value = displayName;
            window.RegattaApp.importState(state);
            window.RegattaApp.setMode("play");
            await window.RegattaMultiplayer.createRoom({
              display_name: displayName,
              max_players: state.boats.length,
              host_role: "player",
              game_state: state,
            });
        }""",
        {"state": state, "displayName": display_name},
    )
    page.wait_for_function("""() => {
        const node = document.getElementById("roomCodeValue");
        return !!node && !!node.textContent && node.textContent.trim().length === 6;
    }""")
    return page.locator("#roomCodeValue").inner_text().strip()


def join_room(page: Page, room_code: str, *, display_name: str = "Guest") -> None:
    page.evaluate(
        """async ({ roomCode, displayName }) => {
            document.getElementById("displayName").value = displayName;
            document.getElementById("joinRoomCode").value = roomCode;
            await window.RegattaMultiplayer.joinRoom();
        }""",
        {"roomCode": room_code, "displayName": display_name},
    )


def fetch_room(page: Page, room_code: str) -> dict[str, Any]:
    return page.evaluate(
        """async (roomCode) => {
            const response = await fetch(`/api/rooms/${roomCode}`);
            return await response.json();
        }""",
        room_code,
    )


def wait_for_room(page: Page, room_code: str, predicate, *, timeout_ms: int = 8_000, interval_ms: int = 150) -> dict[str, Any]:
    deadline = time.time() + timeout_ms / 1000
    last_payload: dict[str, Any] | None = None
    while time.time() < deadline:
        last_payload = fetch_room(page, room_code)
        room = last_payload.get("room")
        if predicate(room):
            return room
        page.wait_for_timeout(interval_ms)
    raise AssertionError(f"Timed out waiting for room predicate on {room_code}: {last_payload}")


def start_room(page: Page, state: dict[str, Any], *, room_code: str) -> dict[str, Any]:
    window_room = wait_for_room(page, room_code, lambda room: bool(room and room.get("start_ready")))
    assert window_room["code"] == room_code
    page.evaluate(
        """async (state) => {
            window.RegattaApp.importState(state);
            window.RegattaApp.setMode("play");
            await window.RegattaMultiplayer.startRoom({ armRealtime: true });
        }""",
        state,
    )
    return wait_for_room(page, room_code, lambda room: bool(room and room.get("status") == "live"))


def open_network_room(browser: Browser, base_url: str, state: dict[str, Any]) -> tuple[Page, Page, str]:
    host_context = browser.new_context()
    guest_context = browser.new_context()
    host_page = host_context.new_page()
    guest_page = guest_context.new_page()
    load_app(host_page, base_url)
    load_app(guest_page, base_url)
    room_code = create_room(host_page, state)
    join_room(guest_page, room_code)
    wait_for_room(host_page, room_code, lambda room: bool(room and room.get("joined_racers_count") == state["boats"].__len__()))
    return host_page, guest_page, room_code


def close_pages(*pages: Page) -> None:
    for page in pages:
        page.context.close()
