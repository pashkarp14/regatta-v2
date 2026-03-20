from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

from playwright.sync_api import Browser, BrowserContext, Page, TimeoutError, sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_ROOT = Path(__file__).resolve().parent
SCREENSHOT_ROOT = ARTIFACT_ROOT / "screenshots"
RUNTIME_ROOT = ARTIFACT_ROOT / "runtime"
REPORT_JSON = ARTIFACT_ROOT / "results.json"
AUDIT_PREFIX = "AUDIT-2026-03-20"
DISPLAY_PREFIX = "AUDIT 2026-03-20"
PYTHON_BIN = REPO_ROOT / ".venv" / "Scripts" / "python.exe"

MENU_FLOW_CASES = [
    ("open_menu", "base", "#openMainMenu"),
    ("close_menu", "menu_open", "#closeMainMenu"),
    ("home_to_mode", "menu_open", "#menuNewGame"),
    ("mode_to_local_scenario", "menu_mode", "#menuChooseLocal"),
    ("mode_to_network", "menu_mode", "#menuChooseNetwork"),
    ("scenario_to_maps", "menu_local_scenario", "#menuScenarioLoadMap"),
    ("scenario_to_races", "menu_local_scenario", "#menuScenarioResume"),
    ("scenario_to_local_setup", "menu_local_scenario", "#menuScenarioCreate"),
    ("network_create_branch", "menu_network", "#menuCreateRoom"),
]

CONTROL_TESTS = [
    ("playerCount", "select", "4"),
    ("markCount", "select", "4"),
    ("roundingSide", "select", "starboard"),
    ("finishSeparate", "select", "yes"),
    ("gridCols", "number", "60"),
    ("gridRows", "number", "80"),
    ("playMode", "select", "realtime"),
    ("interactionMode", "select", "rules"),
    ("prestartRounds", "number", "2"),
    ("realtimePrepSeconds", "number", "25"),
    ("deadZone", "number", "35"),
    ("snapThreshold", "number", "0.65"),
    ("movesPerTurn", "number", "2"),
    ("tackPenalty", "number", "0.90"),
    ("turnRateDegPerSec", "number", "150"),
    ("luffingSpeedPercent", "number", "30"),
    ("botDifficulty", "select", "hard"),
    ("autoGusts", "select", "on"),
    ("autoGustInterval", "number", "12"),
    ("autoGustDuration", "number", "7"),
    ("autoFullscreenMode", "select", "race"),
    ("randomCourse", "button", None),
    ("applyGrid", "button", None),
    ("resetGame", "button", None),
    ("windLeft", "button", None),
    ("windRight", "button", None),
    ("toggleWindArrow", "button", None),
    ("randomGust", "button", None),
    ("clearGust", "button", None),
    ("toggleOptimal", "button", None),
    ("bestStart", "button", None),
    ("toggleLaylines", "button", None),
    ("toggleTrails", "button", None),
    ("modePlay", "button", None),
    ("modeMarks", "button", None),
    ("modeStart", "button", None),
    ("modeFinish", "button", None),
    ("modeBoats", "button", None),
    ("modeModel", "button", None),
    ("toggleFullscreen", "button", None),
]

PHASE_CONTROL_IDS = [
    "roomHostRole",
    "startRoom",
    "leaveRoom",
    "copyRoomCode",
    "playerCount",
    "markCount",
    "roundingSide",
    "finishSeparate",
    "gridCols",
    "gridRows",
    "playMode",
    "randomCourse",
    "applyGrid",
    "resetGame",
    "interactionMode",
    "prestartRounds",
    "realtimePrepSeconds",
    "modePlay",
    "modeMarks",
    "modeStart",
    "modeFinish",
    "modeBoats",
    "modeModel",
    "resumeFromModel",
    "deadZone",
    "snapThreshold",
    "movesPerTurn",
    "tackPenalty",
    "turnRateDegPerSec",
    "luffingSpeedPercent",
    "botDifficulty",
    "autoGusts",
    "autoGustInterval",
    "autoGustDuration",
    "windLeft",
    "windRight",
    "toggleWindArrow",
    "randomGust",
    "clearGust",
    "toggleOptimal",
    "bestStart",
    "toggleLaylines",
    "toggleTrails",
    "optimalBoatTarget",
    "bestStartBoatTarget",
    "autoFullscreenMode",
    "toggleFullscreen",
    "boardStartAction",
]


def normalize_text(value: str | None) -> str:
    return " ".join((value or "").split())


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def wait_for_health(base_url: str, timeout_s: float = 20.0) -> dict[str, Any]:
    deadline = time.time() + timeout_s
    health_url = f"{base_url}/healthz"
    last_error = "healthz did not respond"
    while time.time() < deadline:
        try:
            with urlopen(health_url, timeout=1.5) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if response.status == 200:
                    return payload
                last_error = f"unexpected status {response.status}"
        except URLError as exc:
            last_error = str(exc)
        time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for {health_url}: {last_error}")


def http_json(url: str) -> dict[str, Any]:
    with urlopen(url, timeout=4) as response:
        return json.loads(response.read().decode("utf-8"))


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def parse_template_ids() -> set[str]:
    return set(re.findall(r'id="([^"]+)"', read_text(REPO_ROOT / "templates" / "index.html")))


def parse_js_getelement_ids(relative_path: str) -> list[str]:
    text = read_text(REPO_ROOT / relative_path)
    return re.findall(r'document\.getElementById\("([^"]+)"\)', text)


def deep_diff(before: Any, after: Any, prefix: str = "", limit: int = 40) -> list[str]:
    changes: list[str] = []

    def walk(left: Any, right: Any, path: str) -> None:
        nonlocal changes
        if len(changes) >= limit:
            return
        if type(left) != type(right):
            changes.append(path or "<root>")
            return
        if isinstance(left, dict):
            keys = sorted(set(left) | set(right))
            for key in keys:
                walk(left.get(key), right.get(key), f"{path}.{key}" if path else key)
            return
        if isinstance(left, list):
            if len(left) != len(right):
                changes.append(path or "<root>")
                return
            for index, (item_left, item_right) in enumerate(zip(left, right)):
                walk(item_left, item_right, f"{path}[{index}]")
            return
        if left != right:
            changes.append(path or "<root>")

    walk(before, after, prefix)
    return changes[:limit]


@dataclass
class TargetResult:
    name: str
    base_url: str
    health: dict[str, Any] | None = None
    bootstrap: dict[str, Any] | None = None
    initial: dict[str, Any] = field(default_factory=dict)
    menu_flows: list[dict[str, Any]] = field(default_factory=list)
    control_effects: list[dict[str, Any]] = field(default_factory=list)
    launch_flows: list[dict[str, Any]] = field(default_factory=list)
    library_flows: list[dict[str, Any]] = field(default_factory=list)
    phase_matrices: dict[str, Any] = field(default_factory=dict)
    multiplayer: dict[str, Any] = field(default_factory=dict)
    console_errors: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


@dataclass
class LocalServer:
    process: subprocess.Popen[str] | None
    base_url: str
    library_dir: Path
    stdout_path: Path
    stderr_path: Path

    def stop(self) -> None:
        if not self.process:
            return
        self.process.terminate()
        try:
            self.process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)


@contextmanager
def local_server() -> Any:
    port = free_port()
    runtime_dir = RUNTIME_ROOT / f"local-{port}"
    if runtime_dir.exists():
        shutil.rmtree(runtime_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    library_dir = runtime_dir / "library"
    library_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = runtime_dir / "server.out.log"
    stderr_path = runtime_dir / "server.err.log"
    stdout_handle = stdout_path.open("w", encoding="utf-8")
    stderr_handle = stderr_path.open("w", encoding="utf-8")
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "testing",
            "PORT": str(port),
            "LIBRARY_DIR": str(library_dir),
            "FLASK_USE_RELOADER": "0",
            "FLASK_DEBUG": "0",
            "PYTHONUNBUFFERED": "1",
        }
    )
    process = subprocess.Popen(
        [str(PYTHON_BIN), "app.py"],
        cwd=REPO_ROOT,
        env=env,
        stdout=stdout_handle,
        stderr=stderr_handle,
    )
    server = LocalServer(
        process=process,
        base_url=f"http://127.0.0.1:{port}",
        library_dir=library_dir,
        stdout_path=stdout_path,
        stderr_path=stderr_path,
    )
    try:
        wait_for_health(server.base_url)
        yield server
    finally:
        server.stop()
        stdout_handle.close()
        stderr_handle.close()


def add_console_tracking(page: Page, collector: list[str]) -> None:
    page.on(
        "console",
        lambda msg: collector.append(f"{msg.type}: {normalize_text(msg.text)}") if msg.type == "error" else None,
    )
    page.on(
        "pageerror",
        lambda exc: collector.append(f"pageerror: {normalize_text(str(exc))}"),
    )


def wait_app_ready(page: Page, base_url: str) -> None:
    page.goto(base_url, wait_until="networkidle")
    page.wait_for_function("() => !!window.RegattaApp && !!window.RegattaMultiplayer")


def save_screenshot(page: Page, target: str, name: str) -> str:
    filename = f"{target}-{slug(name)}.png"
    path = SCREENSHOT_ROOT / filename
    page.screenshot(path=str(path), full_page=True)
    return str(path)


def current_snapshot(page: Page) -> dict[str, Any]:
    return page.evaluate(
        """(controlIds) => {
          const app = window.RegattaApp;
          const multiplayer = window.RegattaMultiplayer;
          const state = app.exportState?.() || null;
          const meta = app.getMeta?.() || null;
          const roomState = multiplayer.getRoomState?.() || {};
          const draft = multiplayer.getPendingRoomDraft?.() || null;
          const hidden = (node) => {
            if (!node) return true;
            let current = node;
            while (current) {
              if (current.hidden) return true;
              const style = window.getComputedStyle(current);
              if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return true;
              current = current.parentElement;
            }
            return false;
          };
          const visibleScreen = Array.from(document.querySelectorAll("[data-menu-screen]"))
            .find((node) => !hidden(node))?.dataset.menuScreen || null;
          const controls = Object.fromEntries(controlIds.map((id) => {
            const node = document.getElementById(id);
            if (!node) return [id, null];
            return [id, {
              tag: node.tagName.toLowerCase(),
              text: (node.textContent || "").trim(),
              value: "value" in node ? String(node.value) : null,
              disabled: !!node.disabled,
              hidden: hidden(node),
              ariaHidden: node.getAttribute("aria-hidden"),
            }];
          }));
          return {
            meta,
            state,
            room: roomState.room || null,
            draft,
            ui: {
              menuOpen: !hidden(document.getElementById("mainMenuOverlay")),
              visibleMenuScreen: visibleScreen,
              deckOpen: !document.getElementById("commandDeck")?.classList.contains("is-collapsed"),
              syncIndicator: (document.getElementById("syncIndicator")?.textContent || "").trim(),
              roomPhaseLabel: (document.getElementById("roomPhaseLabel")?.textContent || "").trim(),
              status: (document.getElementById("status")?.innerText || "").trim(),
              stats: (document.getElementById("stats")?.innerText || "").trim(),
              roomStatus: (document.getElementById("roomStatus")?.textContent || "").trim(),
              roomCode: (document.getElementById("roomCodeValue")?.textContent || "").trim(),
              roomNotice: (document.getElementById("roomNotice")?.textContent || "").trim(),
              roomHint: (document.getElementById("roomHint")?.textContent || "").trim(),
              roomPanelNote: (document.getElementById("roomPanelNote")?.textContent || "").trim(),
              windInfo: (document.getElementById("windInfo")?.textContent || "").trim(),
              interactionLockVisible: !hidden(document.getElementById("interactionLock")),
              interactionLockText: (document.getElementById("interactionLock")?.textContent || "").trim(),
              boardStartActionText: (document.getElementById("boardStartAction")?.textContent || "").trim(),
              boardStartActionDisabled: !!document.getElementById("boardStartAction")?.disabled,
              boardStartActionHidden: hidden(document.getElementById("boardStartAction")),
              toast: (document.getElementById("appToast")?.textContent || "").trim(),
              deckModeHint: (document.getElementById("deckModeHint")?.textContent || "").trim(),
              deckRulesModeHint: (document.getElementById("deckRulesModeHint")?.textContent || "").trim(),
              interactionModeInfo: (document.getElementById("interactionModeInfo")?.textContent || "").trim(),
            },
            controls,
          };
        }""",
        PHASE_CONTROL_IDS,
    )


def ensure_menu(page: Page, open_menu: bool) -> None:
    menu_open = current_snapshot(page)["ui"]["menuOpen"]
    if open_menu and not menu_open:
        page.locator("#openMainMenu").click()
    elif not open_menu and menu_open:
        page.locator("#closeMainMenu").click()
    page.wait_for_timeout(150)


def ensure_deck(page: Page, open_deck: bool) -> None:
    deck_open = current_snapshot(page)["ui"]["deckOpen"]
    if open_deck and not deck_open:
        page.locator("#toggleCommandDeck").click()
    elif not open_deck and deck_open:
        page.locator("#collapseCommandDeck").click()
    page.wait_for_timeout(150)


def click(page: Page, selector: str) -> None:
    locator = page.locator(selector)
    try:
        locator.click()
    except TimeoutError:
        locator.click(force=True)
    page.wait_for_timeout(250)


def set_value(page: Page, control_id: str, kind: str, value: str | None) -> None:
    locator = page.locator(f"#{control_id}")
    if kind == "select":
        locator.select_option(value or "")
    elif kind == "number":
        locator.fill(value or "")
        locator.dispatch_event("change")
    elif kind == "button":
        locator.click()
    else:
        raise ValueError(f"Unsupported control kind: {kind}")
    page.wait_for_timeout(300)


def inventory_controls(page: Page) -> list[dict[str, Any]]:
    return page.evaluate(
        """() => {
          const hidden = (node) => {
            if (!node) return true;
            let current = node;
            while (current) {
              if (current.hidden) return true;
              const style = window.getComputedStyle(current);
              if (style.display === "none" || style.visibility === "hidden") return true;
              current = current.parentElement;
            }
            return false;
          };
          return Array.from(document.querySelectorAll("button, input, select")).map((node) => ({
            id: node.id || null,
            tag: node.tagName.toLowerCase(),
            type: node.getAttribute("type"),
            text: (node.textContent || "").trim(),
            value: "value" in node ? String(node.value) : null,
            disabled: !!node.disabled,
            hidden: hidden(node),
            menuScreen: node.closest("[data-menu-screen]")?.dataset.menuScreen || null,
            section: node.closest("section[id]")?.id || null,
            roomLock: node.getAttribute("data-room-lock"),
            ariaLabel: node.getAttribute("aria-label"),
          }));
        }"""
    )


def collect_initial_state(page: Page, target: str) -> dict[str, Any]:
    ensure_menu(page, True)
    screenshot = save_screenshot(page, target, "menu-home")
    snapshot = current_snapshot(page)
    inventory = inventory_controls(page)
    ensure_menu(page, False)
    return {"screenshot": screenshot, "snapshot": snapshot, "inventory": inventory}


def prepare_menu_state(page: Page, state_name: str, base_url: str) -> None:
    wait_app_ready(page, base_url)
    ensure_menu(page, True)
    if state_name == "base":
        return
    if state_name == "menu_open":
        return
    click(page, "#menuNewGame")
    if state_name == "menu_mode":
        return
    if state_name == "menu_local_scenario":
        click(page, "#menuChooseLocal")
        return
    if state_name == "menu_network":
        click(page, "#menuChooseNetwork")
        return
    raise ValueError(f"Unknown menu state {state_name}")


def audit_menu_flows(page: Page, base_url: str, target: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for name, state_name, selector in MENU_FLOW_CASES:
        prepare_menu_state(page, state_name, base_url)
        before = current_snapshot(page)
        record: dict[str, Any] = {
            "name": name,
            "selector": selector,
            "before_screen": before["ui"]["visibleMenuScreen"],
            "before_menu_open": before["ui"]["menuOpen"],
        }
        try:
            click(page, selector)
            after = current_snapshot(page)
            record.update(
                {
                    "after_screen": after["ui"]["visibleMenuScreen"],
                    "after_menu_open": after["ui"]["menuOpen"],
                    "after_deck_open": after["ui"]["deckOpen"],
                    "status": "ok",
                    "screenshot": save_screenshot(page, target, f"menu-{name}"),
                }
            )
        except Exception as exc:  # noqa: BLE001
            record["status"] = "error"
            record["error"] = str(exc)
        records.append(record)
    return records


def control_effect_record(page: Page, base_url: str, target: str, control_id: str, kind: str, value: str | None) -> dict[str, Any]:
    wait_app_ready(page, base_url)
    ensure_menu(page, False)
    ensure_deck(page, True)
    before = current_snapshot(page)
    control = before["controls"].get(control_id)
    record: dict[str, Any] = {
        "control_id": control_id,
        "kind": kind,
        "requested_value": value,
        "available": control is not None,
        "hidden_before": None if control is None else control["hidden"],
        "disabled_before": None if control is None else control["disabled"],
    }
    if control is None:
        record["status"] = "missing"
        return record
    if control["hidden"]:
        record["status"] = "hidden"
        return record
    if control["disabled"]:
        record["status"] = "disabled"
        return record
    try:
        set_value(page, control_id, kind, value)
        after = current_snapshot(page)
        record.update(
            {
                "status": "ok",
                "final_value": after["controls"].get(control_id, {}).get("value"),
                "state_changes": deep_diff(before["state"], after["state"], limit=25),
                "meta_changes": deep_diff(before["meta"], after["meta"], limit=10),
                "ui_changes": [key for key in after["ui"] if after["ui"].get(key) != before["ui"].get(key)],
                "screenshot": save_screenshot(page, target, f"control-{control_id}"),
            }
        )
        if control_id == "toggleFullscreen":
            record["fullscreen_after"] = page.evaluate("() => !!document.fullscreenElement")
        if control_id.startswith("mode"):
            record["active_mode_after"] = after["meta"].get("mode") if after["meta"] else None
    except Exception as exc:  # noqa: BLE001
        record["status"] = "error"
        record["error"] = str(exc)
    return record


def fetch_library(page: Page, kind: str) -> list[dict[str, Any]]:
    payload = page.evaluate(
        """async (kind) => {
            const response = await fetch(`/api/library/${kind}`);
            return await response.json();
        }""",
        kind,
    )
    return payload.get(kind, [])


def post_library(page: Page, kind: str, body: dict[str, Any]) -> dict[str, Any]:
    return page.evaluate(
        """async ({ kind, body }) => {
            const response = await fetch(`/api/library/${kind}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            return await response.json();
        }""",
        {"kind": kind, "body": body},
    )


def delete_library(page: Page, kind: str, record_id: str) -> None:
    page.evaluate(
        """async ({ kind, recordId }) => {
            await fetch(`/api/library/${kind}/${recordId}`, { method: "DELETE" });
        }""",
        {"kind": kind, "recordId": record_id},
    )
    page.wait_for_timeout(200)


def create_seed_records(page: Page, target: str) -> dict[str, str]:
    snapshot = page.evaluate("() => window.RegattaApp.exportState()")
    map_snapshot = page.evaluate("() => window.RegattaApp.exportMapState?.() || window.RegattaApp.exportState()")
    map_name = f"{AUDIT_PREFIX}-{target}-seed-map"
    race_name = f"{AUDIT_PREFIX}-{target}-seed-race"
    map_payload = post_library(page, "maps", {"name": map_name, "snapshot": map_snapshot, "author": DISPLAY_PREFIX, "meta": {"record_mode": "map", "local_pilot_mode": "hotseat"}})
    race_payload = post_library(page, "races", {"name": race_name, "snapshot": snapshot, "author": DISPLAY_PREFIX, "meta": {"record_mode": "race", "local_pilot_mode": "hotseat"}})
    return {"map_id": map_payload.get("map", {}).get("id"), "race_id": race_payload.get("race", {}).get("id")}


def find_record_action(page: Page, kind: str, record_id: str, action: str):
    return page.locator(f'[data-library-kind="{kind}"][data-record-id="{record_id}"][data-action="{action}"]')


def audit_library_flows(page: Page, base_url: str, target: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    wait_app_ready(page, base_url)
    ensure_menu(page, False)
    before_maps = fetch_library(page, "maps")
    before_races = fetch_library(page, "races")
    click(page, "#dockSaveMap")
    click(page, "#dockSaveRace")
    after_maps = fetch_library(page, "maps")
    after_races = fetch_library(page, "races")
    records.append({"name": "dock_save_map", "count_before": len(before_maps), "count_after": len(after_maps), "screenshot": save_screenshot(page, target, "dock-save-map")})
    records.append({"name": "dock_save_race", "count_before": len(before_races), "count_after": len(after_races), "screenshot": save_screenshot(page, target, "dock-save-race")})
    seeds = create_seed_records(page, target)

    def open_kind(kind: str) -> None:
        wait_app_ready(page, base_url)
        ensure_menu(page, True)
        page.evaluate(
            """(kind) => {
                const node = document.querySelector(`[data-menu-nav="${kind}"]`);
                if (!node) throw new Error(`Missing menu nav ${kind}`);
                node.click();
            }""",
            kind,
        )
        page.wait_for_timeout(250)

    flow_defs = [
        ("map_local", "maps", seeds["map_id"], "local"),
        ("map_bots", "maps", seeds["map_id"], "bots"),
        ("map_edit", "maps", seeds["map_id"], "edit"),
        ("map_network", "maps", seeds["map_id"], "network"),
        ("race_local", "races", seeds["race_id"], "local"),
        ("race_network", "races", seeds["race_id"], "network"),
    ]
    for flow_name, kind, record_id, action in flow_defs:
        open_kind(kind)
        outcome: dict[str, Any] = {"name": flow_name, "kind": kind, "action": action}
        try:
            find_record_action(page, kind, record_id, action).click()
            page.wait_for_timeout(500)
            outcome["status"] = "ok"
            outcome["snapshot"] = current_snapshot(page)
            outcome["screenshot"] = save_screenshot(page, target, f"library-{flow_name}")
        except Exception as exc:  # noqa: BLE001
            outcome["status"] = "error"
            outcome["error"] = str(exc)
        records.append(outcome)
    open_kind("maps")
    find_record_action(page, "maps", seeds["map_id"], "delete").click()
    page.wait_for_timeout(400)
    records.append({"name": "map_delete_via_ui", "status": "ok"})
    open_kind("races")
    find_record_action(page, "races", seeds["race_id"], "delete").click()
    page.wait_for_timeout(400)
    records.append({"name": "race_delete_via_ui", "status": "ok"})
    return records


def launch_flow_record(page: Page, base_url: str, target: str, name: str, steps: list[str]) -> dict[str, Any]:
    wait_app_ready(page, base_url)
    ensure_menu(page, True)
    for selector in steps:
        click(page, selector)
    return {"name": name, "steps": steps, "snapshot": current_snapshot(page), "screenshot": save_screenshot(page, target, f"launch-{name}")}


def audit_launch_flows(page: Page, base_url: str, target: str) -> list[dict[str, Any]]:
    return [
        launch_flow_record(page, base_url, target, "new-local-create-hotseat-turns", ["#menuNewGame", "#menuChooseLocal", "#menuScenarioCreate", "#menuLocalPartyHotseat", "#menuLocalPlayModeTurns", "#menuLaunchLocalGame"]),
        launch_flow_record(page, base_url, target, "new-local-create-hotseat-realtime", ["#menuNewGame", "#menuChooseLocal", "#menuScenarioCreate", "#menuLocalPartyHotseat", "#menuLocalPlayModeRealtime", "#menuLaunchLocalGame"]),
        launch_flow_record(page, base_url, target, "new-local-create-bots-turns", ["#menuNewGame", "#menuChooseLocal", "#menuScenarioCreate", "#menuLocalPartyBots", "#menuLocalPlayModeTurns", "#menuLaunchLocalGame"]),
        launch_flow_record(page, base_url, target, "new-local-create-bots-realtime", ["#menuNewGame", "#menuChooseLocal", "#menuScenarioCreate", "#menuLocalPartyBots", "#menuLocalPlayModeRealtime", "#menuLaunchLocalGame"]),
    ]


def set_finished_state(page: Page) -> None:
    page.evaluate("""() => { const state = window.RegattaApp.exportState(); state.race.phase = 'finished'; window.RegattaApp.importState(state); }""")
    page.wait_for_timeout(1000)


def create_room(page: Page, display_name: str, host_role: str = "player") -> str:
    room_code = page.evaluate(
        """async ({ displayName, hostRole }) => {
            document.getElementById("displayName").value = displayName;
            const state = window.RegattaApp.exportState();
            await window.RegattaMultiplayer.createRoom({
              display_name: displayName,
              host_role: hostRole,
              max_players: state.boats.length,
              game_state: state,
            });
            return document.getElementById("roomCodeValue").textContent.trim();
        }""",
        {"displayName": display_name, "hostRole": host_role},
    )
    page.wait_for_timeout(500)
    return room_code


def join_room(page: Page, room_code: str, display_name: str) -> None:
    page.evaluate(
        """async ({ roomCode, displayName }) => {
            document.getElementById("displayName").value = displayName;
            document.getElementById("joinRoomCode").value = roomCode;
            await window.RegattaMultiplayer.joinRoom();
        }""",
        {"roomCode": room_code, "displayName": display_name},
    )
    page.wait_for_timeout(600)


def start_room(page: Page) -> None:
    page.evaluate("() => window.RegattaMultiplayer.startRoom({ armRealtime: true })")
    page.wait_for_timeout(900)


def capture_phase_matrix(page: Page, label: str) -> dict[str, Any]:
    ensure_menu(page, False)
    ensure_deck(page, True)
    snap = current_snapshot(page)
    return {"label": label, "meta": snap["meta"], "ui": snap["ui"], "controls": snap["controls"]}


def new_context(browser: Browser) -> BrowserContext:
    return browser.new_context(viewport={"width": 1440, "height": 1100}, permissions=["clipboard-read", "clipboard-write"])


def audit_multiplayer(browser: Browser, base_url: str, target: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    host_context = new_context(browser)
    guest_context = new_context(browser)
    observer_context = new_context(browser)
    try:
        host_page = host_context.new_page()
        guest_page = guest_context.new_page()
        observer_page = observer_context.new_page()
        wait_app_ready(host_page, base_url)
        wait_app_ready(guest_page, base_url)
        wait_app_ready(observer_page, base_url)
        result["solo_idle"] = capture_phase_matrix(host_page, "solo_idle")
        host_page.evaluate("() => window.RegattaApp.setMode('marks')")
        host_page.wait_for_timeout(200)
        result["local_editor"] = capture_phase_matrix(host_page, "local_editor")
        host_page.evaluate("() => window.RegattaApp.setMode('play')")
        host_page.wait_for_timeout(200)
        result["local_active_race"] = capture_phase_matrix(host_page, "local_active_race")
        host_page.evaluate("""() => window.RegattaMultiplayer.setPendingRoomDraft({ display_name: 'AUDIT Host Draft', max_players: 2, source: 'map', mode: 'edit', host_role: 'player' })""")
        host_page.wait_for_timeout(300)
        result["pending_network_draft"] = capture_phase_matrix(host_page, "pending_network_draft")
        host_page.evaluate("() => window.RegattaMultiplayer.clearPendingRoomDraft()")
        host_page.wait_for_timeout(200)
        room_code = create_room(host_page, f"{DISPLAY_PREFIX} Host")
        result["network_lobby_host"] = capture_phase_matrix(host_page, "network_lobby_host")
        result["network_lobby_host"]["room_code"] = room_code
        join_room(guest_page, room_code, f"{DISPLAY_PREFIX} Guest")
        result["network_lobby_guest"] = capture_phase_matrix(guest_page, "network_lobby_guest")
        start_room(host_page)
        result["live_network_active_player"] = capture_phase_matrix(host_page, "live_network_active_player")
        result["live_network_non_active_player"] = capture_phase_matrix(guest_page, "live_network_non_active_player")
        set_finished_state(host_page)
        result["finished_editable_host"] = capture_phase_matrix(host_page, "finished_editable_host")
        host_page.evaluate("() => window.RegattaMultiplayer.leaveRoom()")
        guest_page.evaluate("() => window.RegattaMultiplayer.leaveRoom()")
        host_page.wait_for_timeout(600)
        guest_page.wait_for_timeout(600)
        observer_code = create_room(observer_page, f"{DISPLAY_PREFIX} Observer", host_role="observer")
        result["network_lobby_observer"] = capture_phase_matrix(observer_page, "network_lobby_observer")
        result["network_lobby_observer"]["room_code"] = observer_code
        result["screenshots"] = {
            "host_lobby": save_screenshot(host_page, target, "network-host-lobby"),
            "guest_lobby": save_screenshot(guest_page, target, "network-guest-lobby"),
            "host_live": save_screenshot(host_page, target, "network-host-live"),
            "guest_live": save_screenshot(guest_page, target, "network-guest-live"),
            "observer_lobby": save_screenshot(observer_page, target, "network-observer-lobby"),
        }
    finally:
        host_context.close()
        guest_context.close()
        observer_context.close()
    return result


def cleanup_prefixed_records(page: Page) -> None:
    for kind in ("maps", "races"):
        for record in fetch_library(page, kind):
            if str(record.get("name", "")).startswith(AUDIT_PREFIX):
                delete_library(page, kind, record["id"])


def audit_target(browser: Browser, name: str, base_url: str) -> TargetResult:
    result = TargetResult(name=name, base_url=base_url)
    result.health = http_json(f"{base_url}/healthz")
    result.bootstrap = http_json(f"{base_url}/api/bootstrap")
    context = new_context(browser)
    page = context.new_page()
    add_console_tracking(page, result.console_errors)
    wait_app_ready(page, base_url)
    result.initial = collect_initial_state(page, name)
    result.menu_flows = audit_menu_flows(page, base_url, name)
    result.control_effects = [control_effect_record(page, base_url, name, control_id, kind, value) for control_id, kind, value in CONTROL_TESTS]
    result.launch_flows = audit_launch_flows(page, base_url, name)
    result.library_flows = audit_library_flows(page, base_url, name)
    cleanup_prefixed_records(page)
    context.close()
    result.multiplayer = audit_multiplayer(browser, base_url, name)
    result.phase_matrices = {key: result.multiplayer.get(key) for key in [
        "solo_idle",
        "local_editor",
        "local_active_race",
        "pending_network_draft",
        "network_lobby_host",
        "network_lobby_guest",
        "network_lobby_observer",
        "live_network_active_player",
        "live_network_non_active_player",
        "finished_editable_host",
    ]}
    return result


def main() -> int:
    SCREENSHOT_ROOT.mkdir(parents=True, exist_ok=True)
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
    template_ids = parse_template_ids()
    game_shell_ids = parse_js_getelement_ids("static/game_shell.js")
    multiplayer_ids = parse_js_getelement_ids("static/multiplayer.js")
    static_analysis = {
        "template_ids": sorted(template_ids),
        "missing_in_template": {
            "game_shell": sorted({value for value in game_shell_ids if value not in template_ids}),
            "multiplayer": sorted({value for value in multiplayer_ids if value not in template_ids}),
        },
    }
    with local_server() as server, sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            results = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "static_analysis": static_analysis, "targets": {}}
            for target_name, base_url in [("local", server.base_url), ("remote", "http://158.160.217.19:5001")]:
                results["targets"][target_name] = audit_target(browser, target_name, base_url).__dict__
            REPORT_JSON.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        finally:
            browser.close()
    print(f"Wrote {REPORT_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
