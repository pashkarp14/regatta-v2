from __future__ import annotations

import asyncio
from collections import Counter, defaultdict, deque
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import random
import statistics
import time
from typing import Any

import httpx
import socketio


REPO_ROOT = Path(__file__).resolve().parents[2]
LOCAL_TRAINING_BAY_PATH = REPO_ROOT / "regatta_app" / "standard_maps" / "training-bay.json"
DEFAULT_FIXTURE_PATH = REPO_ROOT / "tools" / "load" / "fixtures" / "baseline_snapshot.json"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "output" / "load"
DEFAULT_BASE_URL = "http://127.0.0.1:5001"
REALTIME_CONTROL_INTERVAL_SECONDS = 0.25
SOCKET_CONNECT_TIMEOUT_SECONDS = 5.0
SESSION_CLOSE_TIMEOUT_SECONDS = 1.0
MAX_ROOM_PLAYERS = 20
BOAT_COLORS = [
    "#e53935",
    "#1e88e5",
    "#43a047",
    "#fdd835",
    "#8e24aa",
    "#ff8f00",
    "#00acc1",
    "#6d4c41",
    "#d81b60",
    "#3949ab",
    "#00897b",
    "#7cb342",
    "#fb8c00",
    "#8d6e63",
    "#5e35b1",
    "#039be5",
    "#c0ca33",
    "#f4511e",
    "#546e7a",
    "#ef5350",
]
DEFAULT_EXPECTED_METRIC_NAMES = {
    "regatta_http_requests_total",
    "regatta_http_request_duration_seconds",
    "regatta_http_request_bytes_total",
    "regatta_http_response_bytes_total",
    "regatta_socket_events_total",
    "regatta_socket_event_duration_seconds",
    "regatta_socket_payload_bytes_total",
    "regatta_socket_connected_clients",
    "regatta_rooms_total",
    "regatta_room_players_histogram",
    "regatta_realtime_loops_active",
    "regatta_realtime_ticks_total",
    "regatta_realtime_tick_duration_seconds",
    "regatta_realtime_tick_drift_seconds",
    "regatta_realtime_tick_changed_total",
    "regatta_realtime_tick_noop_total",
    "regatta_room_store_operations_total",
    "regatta_room_store_duration_seconds",
    "regatta_room_store_payload_bytes",
    "regatta_public_room_view_duration_seconds",
    "regatta_public_room_view_payload_bytes",
    "regatta_game_state_validation_duration_seconds",
    "regatta_game_state_payload_bytes",
    "regatta_errors_total",
    "regatta_client_telemetry_events_total",
    "regatta_client_telemetry_duration_seconds",
}


class BlockingIssue(RuntimeError):
    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.details = details or {}


@dataclass(slots=True)
class RequestSample:
    scenario: str
    user_id: str
    method: str
    path: str
    status: int
    duration_ms: float
    request_bytes: int = 0
    response_bytes: int = 0
    room_code: str | None = None
    ok: bool = True
    error: str = ""
    ts: str = field(default_factory=lambda: utc_now_iso())


@dataclass(slots=True)
class SocketSample:
    scenario: str
    user_id: str
    event: str
    direction: str
    ok: bool
    duration_ms: float
    payload_bytes: int
    room_code: str | None = None
    revision: int | None = None
    error: str = ""
    ts: str = field(default_factory=lambda: utc_now_iso())


@dataclass(slots=True)
class RevisionSample:
    scenario: str
    user_id: str
    room_code: str
    event: str
    revision: int
    latency_since_last_control_ms: float
    ts: str = field(default_factory=lambda: utc_now_iso())


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def normalize_base_url(raw_base_url: str) -> str:
    cleaned = (raw_base_url or "").strip()
    if not cleaned:
        raise ValueError("Base URL must not be empty.")
    if not cleaned.startswith(("http://", "https://")):
        cleaned = f"http://{cleaned}"
    return cleaned.rstrip("/")


def ensure_output_dir(root: Path | str) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = Path(root) / timestamp
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


def payload_bytes(payload: Any) -> int:
    if payload is None:
        return 0
    if isinstance(payload, (bytes, bytearray)):
        return len(payload)
    if isinstance(payload, str):
        return len(payload.encode("utf-8"))
    return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def percentile(values: list[float], ratio: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * ratio)))
    return round(ordered[index], 2)


def summarize_durations(values: list[float]) -> dict[str, float]:
    if not values:
        return {"count": 0, "avg": 0.0, "p50": 0.0, "p95": 0.0, "p99": 0.0, "max": 0.0}
    return {
        "count": len(values),
        "avg": round(statistics.fmean(values), 2),
        "p50": percentile(values, 0.50),
        "p95": percentile(values, 0.95),
        "p99": percentile(values, 0.99),
        "max": round(max(values), 2),
    }


def extract_metric_names(metrics_text: str) -> list[str]:
    names: set[str] = set()
    for raw_line in metrics_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        metric_name = line.split("{", 1)[0].split(" ", 1)[0]
        if metric_name:
            names.add(metric_name)
    return sorted(names)


def build_metrics_inventory(metrics_text: str, expected_metric_names: set[str] | None = None) -> dict[str, list[str]]:
    expected_metric_names = expected_metric_names or DEFAULT_EXPECTED_METRIC_NAMES
    found = extract_metric_names(metrics_text)
    found_set = set(found)
    return {
        "found": found,
        "expected_and_found": sorted(found_set & expected_metric_names),
        "expected_but_missing": sorted(expected_metric_names - found_set),
        "found_but_undocumented": sorted(found_set - expected_metric_names),
    }


def load_local_baseline_snapshot() -> dict[str, Any]:
    payload = json.loads(LOCAL_TRAINING_BAY_PATH.read_text(encoding="utf-8-sig"))
    return deepcopy(payload["snapshot"])


def _start_line_points(snapshot: dict[str, Any]) -> tuple[dict[str, float], dict[str, float], dict[str, float]]:
    course = snapshot.get("course") if isinstance(snapshot.get("course"), dict) else {}
    start_a = course.get("startA") if isinstance(course.get("startA"), dict) else {"x": 8.0, "y": 2.0}
    start_b = course.get("startB") if isinstance(course.get("startB"), dict) else {"x": 22.0, "y": 2.0}
    marks = course.get("marks") if isinstance(course.get("marks"), list) else []
    first_mark = marks[0] if marks and isinstance(marks[0], dict) else {"x": 15.0, "y": 8.0}
    return start_a, start_b, first_mark


def _course_normal(snapshot: dict[str, Any]) -> tuple[float, float]:
    start_a, start_b, first_mark = _start_line_points(snapshot)
    dx = float(start_b.get("x", 0.0)) - float(start_a.get("x", 0.0))
    dy = float(start_b.get("y", 0.0)) - float(start_a.get("y", 0.0))
    length = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / length, dx / length
    mid_x = (float(start_a.get("x", 0.0)) + float(start_b.get("x", 0.0))) / 2.0
    mid_y = (float(start_a.get("y", 0.0)) + float(start_b.get("y", 0.0))) / 2.0
    to_mark_x = float(first_mark.get("x", mid_x)) - mid_x
    to_mark_y = float(first_mark.get("y", mid_y)) - mid_y
    if (to_mark_x * nx) + (to_mark_y * ny) < 0:
        nx *= -1
        ny *= -1
    return nx, ny


def _default_boat(snapshot: dict[str, Any], index: int, total: int) -> dict[str, Any]:
    start_a, start_b, _ = _start_line_points(snapshot)
    normal_x, normal_y = _course_normal(snapshot)
    blend = (index + 1) / (max(total, 1) + 1)
    x = float(start_a.get("x", 8.0)) + (float(start_b.get("x", 22.0)) - float(start_a.get("x", 8.0))) * blend
    y = float(start_a.get("y", 2.0)) + (float(start_b.get("y", 2.0)) - float(start_a.get("y", 2.0))) * blend
    return {
        "x": round(x + normal_x * 0.65, 3),
        "y": round(y + normal_y * 0.65, 3),
        "distance": 0,
        "turns": 0,
        "penalties": 0,
        "collisions": 0,
        "nextMark": 0,
        "finished": False,
        "place": None,
        "hasHeading": False,
        "heading": 0,
        "tack": 0,
        "color": BOAT_COLORS[index % len(BOAT_COLORS)],
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


def _normalized_boat(snapshot: dict[str, Any], raw_boat: dict[str, Any] | None, index: int, total: int) -> dict[str, Any]:
    fallback = _default_boat(snapshot, index, total)
    if not isinstance(raw_boat, dict):
        return fallback
    return {
        "x": float(raw_boat.get("x", fallback["x"])),
        "y": float(raw_boat.get("y", fallback["y"])),
        "distance": raw_boat.get("distance", 0),
        "turns": raw_boat.get("turns", 0),
        "penalties": raw_boat.get("penalties", 0),
        "collisions": raw_boat.get("collisions", 0),
        "nextMark": raw_boat.get("nextMark", 0),
        "finished": bool(raw_boat.get("finished", False)),
        "place": raw_boat.get("place"),
        "hasHeading": bool(raw_boat.get("hasHeading", False)),
        "heading": raw_boat.get("heading", 0),
        "tack": raw_boat.get("tack", 0),
        "color": raw_boat.get("color") if isinstance(raw_boat.get("color"), str) else fallback["color"],
        "speedCoeff": float(raw_boat.get("speedCoeff", 1.0) or 1.0),
        "currentSpeedUnitsPerSec": raw_boat.get("currentSpeedUnitsPerSec", 0),
        "penaltySlowUntil": raw_boat.get("penaltySlowUntil", 0),
        "lastPenaltyAt": raw_boat.get("lastPenaltyAt", 0),
        "lastPenaltyKey": raw_boat.get("lastPenaltyKey", ""),
        "lastPenaltyReason": raw_boat.get("lastPenaltyReason", ""),
        "roundInZone": bool(raw_boat.get("roundInZone", False)),
        "roundSweep": raw_boat.get("roundSweep", 0),
        "startDeltaMs": raw_boat.get("startDeltaMs"),
        "falseStartDeltaMs": raw_boat.get("falseStartDeltaMs"),
    }


def reshape_snapshot_for_players(snapshot: dict[str, Any], player_count: int) -> dict[str, Any]:
    if player_count < 1 or player_count > MAX_ROOM_PLAYERS:
        raise ValueError(f"Player count must be within 1..{MAX_ROOM_PLAYERS}.")
    state = deepcopy(snapshot)
    boats = state.get("boats") if isinstance(state.get("boats"), list) else []
    state["boats"] = [
        _normalized_boat(state, boats[index] if index < len(boats) else None, index, player_count)
        for index in range(player_count)
    ]
    settings = state.setdefault("settings", {})
    settings["playMode"] = "realtime"
    settings.setdefault("interactionMode", "contact")
    settings.setdefault("realtimePrepSeconds", 18)
    race = state.setdefault("race", {})
    race["phase"] = "countdown"
    race["raceFinishedCount"] = 0
    race["realtimeCountdownEndsAt"] = 0
    race["realtimePaused"] = False
    race["realtimePauseStartedAt"] = 0
    race["gustExpiresAt"] = 0
    race["nextAutoGustAt"] = 0
    return state


def _timed_sync_request(
    client: httpx.Client,
    method: str,
    path: str,
    *,
    expect_json: bool,
) -> dict[str, Any]:
    started_at = time.perf_counter()
    response = client.request(method, path)
    duration_ms = round((time.perf_counter() - started_at) * 1000.0, 2)
    if expect_json:
        try:
            body: Any = response.json()
        except ValueError:
            body = response.text
    else:
        body = response.text
    return {
        "url": f"{client.base_url}{path.lstrip('/')}",
        "path": path,
        "method": method,
        "status": response.status_code,
        "duration_ms": duration_ms,
        "response_bytes": len(response.content),
        "body": body,
    }


def write_blocking_issue(output_dir: Path, message: str, details: dict[str, Any] | None = None) -> None:
    write_json(
        output_dir / "blocking_issue.json",
        {"ts": utc_now_iso(), "message": message, "details": details or {}},
    )


def collect_environment(
    base_url: str,
    output_dir: Path,
    *,
    expected_metric_names: set[str] | None = None,
) -> tuple[dict[str, Any], str, dict[str, list[str]]]:
    expected_metric_names = expected_metric_names or DEFAULT_EXPECTED_METRIC_NAMES
    normalized_base_url = normalize_base_url(base_url)
    try:
        with httpx.Client(base_url=normalized_base_url, timeout=15.0, follow_redirects=True) as client:
            healthz = _timed_sync_request(client, "GET", "/healthz", expect_json=True)
            bootstrap = _timed_sync_request(client, "GET", "/api/bootstrap", expect_json=True)
            metrics = _timed_sync_request(client, "GET", "/metrics", expect_json=False)
    except Exception as exc:
        details = {"base_url": normalized_base_url, "error": str(exc)}
        write_blocking_issue(output_dir, "Smoke checks failed before the load run started.", details)
        raise BlockingIssue("Smoke checks failed before the load run started.", details=details) from exc

    for name, payload in (("healthz", healthz), ("bootstrap", bootstrap), ("metrics", metrics)):
        if payload["status"] != 200:
            details = {
                "base_url": normalized_base_url,
                "path": payload["path"],
                "status": payload["status"],
                "response_bytes": payload["response_bytes"],
            }
            write_blocking_issue(output_dir, f"{name} endpoint is unavailable.", details)
            raise BlockingIssue(f"{name} endpoint is unavailable.", details=details)

    metrics_text = str(metrics["body"])
    inventory = build_metrics_inventory(metrics_text, expected_metric_names=expected_metric_names)
    write_json(output_dir / "healthz.json", healthz)
    write_json(output_dir / "bootstrap.json", bootstrap)
    (output_dir / "metrics_initial.txt").write_text(metrics_text, encoding="utf-8")
    write_json(output_dir / "metrics_expected_and_found.json", inventory["expected_and_found"])
    write_json(output_dir / "metrics_found_but_undocumented.json", inventory["found_but_undocumented"])
    write_json(output_dir / "metrics_expected_but_missing.json", inventory["expected_but_missing"])

    healthz_body = healthz["body"] if isinstance(healthz["body"], dict) else {}
    environment = {
        "base_url": normalized_base_url,
        "collected_at": utc_now_iso(),
        "healthz": healthz,
        "bootstrap": bootstrap,
        "metrics": {
            "status": metrics["status"],
            "duration_ms": metrics["duration_ms"],
            "response_bytes": metrics["response_bytes"],
            "metric_names": inventory["found"],
        },
        "redis": bool(healthz_body.get("redis")) if isinstance(healthz_body, dict) else None,
        "session_backend": healthz_body.get("session_backend") if isinstance(healthz_body, dict) else None,
        "redis_backend": healthz_body.get("redis_backend") if isinstance(healthz_body, dict) else None,
    }
    write_json(output_dir / "environment.json", environment)
    return environment, metrics_text, inventory


def capture_metrics_snapshot(base_url: str, output_path: Path) -> str:
    normalized_base_url = normalize_base_url(base_url)
    with httpx.Client(base_url=normalized_base_url, timeout=15.0, follow_redirects=True) as client:
        metrics = _timed_sync_request(client, "GET", "/metrics", expect_json=False)
    if metrics["status"] != 200:
        raise BlockingIssue("Final metrics snapshot failed.", details={"base_url": normalized_base_url, "status": metrics["status"]})
    metrics_text = str(metrics["body"])
    output_path.write_text(metrics_text, encoding="utf-8")
    return metrics_text


def fetch_baseline_snapshot(
    base_url: str,
    output_dir: Path,
    *,
    fixture_path: Path = DEFAULT_FIXTURE_PATH,
) -> tuple[dict[str, Any], dict[str, Any]]:
    normalized_base_url = normalize_base_url(base_url)
    snapshot: dict[str, Any] | None = None
    source: dict[str, Any]
    try:
        with httpx.Client(base_url=normalized_base_url, timeout=15.0, follow_redirects=True) as client:
            maps_payload = _timed_sync_request(client, "GET", "/api/library/maps", expect_json=True)
            maps_body = maps_payload["body"] if isinstance(maps_payload["body"], dict) else {}
            maps = maps_body.get("maps") if isinstance(maps_body.get("maps"), list) else []
            chosen = next((item for item in maps if item.get("id") == "std-training-bay"), None)
            if chosen is None and maps:
                chosen = maps[0]
            if chosen is not None and chosen.get("id"):
                detail = _timed_sync_request(client, "GET", f"/api/library/maps/{chosen['id']}", expect_json=True)
                map_body = detail["body"] if isinstance(detail["body"], dict) else {}
                raw_map = map_body.get("map") if isinstance(map_body.get("map"), dict) else {}
                if isinstance(raw_map.get("snapshot"), dict):
                    snapshot = deepcopy(raw_map["snapshot"])
                    source = {
                        "strategy": "remote_library",
                        "record_id": raw_map.get("id"),
                        "record_name": raw_map.get("name"),
                        "record_scope": raw_map.get("scope"),
                    }
                else:
                    source = {"strategy": "remote_library_missing_snapshot", "record_id": chosen.get("id")}
            else:
                source = {"strategy": "remote_library_missing_record"}
    except Exception as exc:
        source = {"strategy": "remote_library_failed", "error": str(exc)}

    if snapshot is None:
        snapshot = load_local_baseline_snapshot()
        source = {"strategy": "local_fallback", "path": str(LOCAL_TRAINING_BAY_PATH)}

    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    fixture_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    write_json(output_dir / "baseline_snapshot_source.json", source)
    return snapshot, source


def _event_room_and_revision(payload: dict[str, Any] | None, default_room_code: str | None) -> tuple[str | None, int | None]:
    if not isinstance(payload, dict):
        return default_room_code, None
    if isinstance(payload.get("room"), dict):
        room = payload["room"]
        revision = room.get("revision")
        return room.get("code", default_room_code), revision if isinstance(revision, int) else None
    revision = payload.get("revision")
    room_code = payload.get("room_code", default_room_code)
    return room_code, revision if isinstance(revision, int) else None


class LoadRecorder:
    def __init__(self, scenario: str) -> None:
        self.scenario = scenario
        self.requests: list[RequestSample] = []
        self.socket_events: list[SocketSample] = []
        self.room_revisions: list[RevisionSample] = []
        self.errors: list[dict[str, Any]] = []

    def record_request(self, sample: RequestSample) -> None:
        self.requests.append(sample)
        if not sample.ok:
            self.errors.append(
                {
                    "source": "http",
                    "path": sample.path,
                    "status": sample.status,
                    "error": sample.error,
                    "user_id": sample.user_id,
                    "room_code": sample.room_code,
                    "ts": sample.ts,
                }
            )

    def record_socket(self, sample: SocketSample) -> None:
        self.socket_events.append(sample)
        if not sample.ok:
            self.errors.append(
                {
                    "source": "socket",
                    "event": sample.event,
                    "error": sample.error,
                    "user_id": sample.user_id,
                    "room_code": sample.room_code,
                    "ts": sample.ts,
                }
            )

    def record_revision(self, sample: RevisionSample) -> None:
        self.room_revisions.append(sample)

    def write(
        self,
        output_dir: Path,
        scenario_config: dict[str, Any],
        *,
        environment: dict[str, Any] | None = None,
    ) -> None:
        write_jsonl(output_dir / "requests.jsonl", [asdict(item) for item in self.requests])
        write_jsonl(output_dir / "socket_events.jsonl", [asdict(item) for item in self.socket_events])
        write_jsonl(output_dir / "room_revisions.jsonl", [asdict(item) for item in self.room_revisions])
        write_json(output_dir / "errors.json", self.errors)
        write_json(output_dir / "scenario_config.json", scenario_config)
        if environment is not None:
            write_json(output_dir / "environment.json", environment)


class VirtualUser:
    def __init__(self, base_url: str, user_id: str, recorder: LoadRecorder) -> None:
        self.base_url = normalize_base_url(base_url)
        self.user_id = user_id
        self.recorder = recorder
        self.http = httpx.AsyncClient(base_url=self.base_url, timeout=20.0, follow_redirects=True)
        self.socket = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
        self.socket_queue: asyncio.Queue[tuple[str, dict[str, Any] | None, float]] = asyncio.Queue()
        self.room_code: str | None = None
        self.socket_connected_at: str | None = None
        self.last_revision: int | None = None
        self.pending_control_timestamps: deque[float] = deque()
        self.disconnect_count = 0
        self.room_error_count = 0
        self._planned_disconnect = False
        self._install_socket_handlers()

    def _install_socket_handlers(self) -> None:
        @self.socket.on("room:snapshot")
        async def on_snapshot(payload: dict[str, Any]) -> None:
            await self._record_inbound("room:snapshot", payload, ok=True)

        @self.socket.on("room:presence")
        async def on_presence(payload: dict[str, Any]) -> None:
            await self._record_inbound("room:presence", payload, ok=True)

        @self.socket.on("room:state_updated")
        async def on_state_updated(payload: dict[str, Any]) -> None:
            await self._record_inbound("room:state_updated", payload, ok=True)

        @self.socket.on("room:error")
        async def on_room_error(payload: dict[str, Any]) -> None:
            self.room_error_count += 1
            await self._record_inbound(
                "room:error",
                payload,
                ok=False,
                error=str(payload.get("error") if isinstance(payload, dict) else payload),
            )

        @self.socket.on("room:kicked")
        async def on_room_kicked(payload: dict[str, Any]) -> None:
            await self._record_inbound("room:kicked", payload, ok=False, error="kicked")

        @self.socket.event
        async def disconnect() -> None:
            if self._planned_disconnect:
                return
            self.disconnect_count += 1
            self.recorder.record_socket(
                SocketSample(
                    scenario=self.recorder.scenario,
                    user_id=self.user_id,
                    event="disconnect",
                    direction="in",
                    ok=True,
                    duration_ms=0.0,
                    payload_bytes=0,
                    room_code=self.room_code,
                )
            )
            await self.socket_queue.put(("disconnect", None, time.perf_counter()))

    async def _record_inbound(
        self,
        event: str,
        payload: dict[str, Any] | None,
        *,
        ok: bool,
        error: str = "",
    ) -> None:
        room_code, revision = _event_room_and_revision(payload, self.room_code)
        self.recorder.record_socket(
            SocketSample(
                scenario=self.recorder.scenario,
                user_id=self.user_id,
                event=event,
                direction="in",
                ok=ok,
                duration_ms=0.0,
                payload_bytes=payload_bytes(payload),
                room_code=room_code,
                revision=revision,
                error=error,
            )
        )
        if revision is not None and (self.last_revision is None or revision > self.last_revision):
            self.last_revision = revision
            if self.pending_control_timestamps:
                emitted_at = self.pending_control_timestamps.popleft()
                self.recorder.record_revision(
                    RevisionSample(
                        scenario=self.recorder.scenario,
                        user_id=self.user_id,
                        room_code=room_code or self.room_code or "-",
                        event=event,
                        revision=revision,
                        latency_since_last_control_ms=round((time.perf_counter() - emitted_at) * 1000.0, 2),
                    )
                )
        await self.socket_queue.put((event, payload, time.perf_counter()))

    async def request(self, method: str, path: str, *, json_body: dict[str, Any] | None = None) -> dict[str, Any]:
        started_at = time.perf_counter()
        request_size = payload_bytes(json_body)
        status = 0
        response_bytes = 0
        try:
            response = await self.http.request(method, path, json=json_body)
            status = response.status_code
            response_bytes = len(response.content)
            try:
                payload = response.json()
            except ValueError:
                payload = {"raw_text": response.text}
            self.recorder.record_request(
                RequestSample(
                    scenario=self.recorder.scenario,
                    user_id=self.user_id,
                    method=method,
                    path=path,
                    status=status,
                    duration_ms=round((time.perf_counter() - started_at) * 1000.0, 2),
                    request_bytes=request_size,
                    response_bytes=response_bytes,
                    room_code=self.room_code,
                    ok=response.is_success,
                    error="" if response.is_success else str(payload.get("error", response.text)),
                )
            )
            if not response.is_success:
                raise RuntimeError(str(payload.get("error", response.text)))
            return payload
        except Exception as exc:
            if status == 0:
                self.recorder.record_request(
                    RequestSample(
                        scenario=self.recorder.scenario,
                        user_id=self.user_id,
                        method=method,
                        path=path,
                        status=0,
                        duration_ms=round((time.perf_counter() - started_at) * 1000.0, 2),
                        request_bytes=request_size,
                        response_bytes=response_bytes,
                        room_code=self.room_code,
                        ok=False,
                        error=str(exc),
                    )
                )
            raise

    def cookie_header(self) -> str:
        return "; ".join(f"{key}={value}" for key, value in self.http.cookies.items())

    async def create_room(self, display_name: str, game_state: dict[str, Any], *, host_role: str = "player") -> dict[str, Any]:
        payload = await self.request(
            "POST",
            "/api/rooms",
            json_body={
                "display_name": display_name,
                "host_role": host_role,
                "max_players": len(game_state.get("boats") or []),
                "game_state": game_state,
            },
        )
        self.room_code = payload["room"]["code"]
        return payload["room"]

    async def join_room(self, room_code: str, display_name: str) -> dict[str, Any]:
        self.room_code = room_code
        payload = await self.request(
            "POST",
            "/api/rooms/join",
            json_body={"display_name": display_name, "room_code": room_code},
        )
        return payload["room"]

    async def room_view(self, room_code: str) -> dict[str, Any]:
        payload = await self.request("GET", f"/api/rooms/{room_code}")
        return payload["room"]

    async def start_room(self, room_code: str, game_state: dict[str, Any]) -> dict[str, Any]:
        payload = await self.request(
            "POST",
            f"/api/rooms/{room_code}/start",
            json_body={"arm_realtime": True, "game_state": game_state},
        )
        return payload["room"]

    async def reset_lobby(self, room_code: str) -> dict[str, Any]:
        payload = await self.request("POST", f"/api/rooms/{room_code}/reset-lobby")
        return payload["room"]

    async def leave_room(self) -> None:
        await self.request("POST", "/api/rooms/leave")

    async def connect_socket(self, room_code: str) -> None:
        self.room_code = room_code
        headers = {"Cookie": self.cookie_header()} if self.cookie_header() else {}
        started_at = time.perf_counter()
        try:
            await asyncio.wait_for(
                self.socket.connect(self.base_url, transports=["websocket", "polling"], headers=headers, wait_timeout=10),
                timeout=SOCKET_CONNECT_TIMEOUT_SECONDS,
            )
            self.socket_connected_at = utc_now_iso()
            self.recorder.record_socket(
                SocketSample(
                    scenario=self.recorder.scenario,
                    user_id=self.user_id,
                    event="connect",
                    direction="out",
                    ok=True,
                    duration_ms=round((time.perf_counter() - started_at) * 1000.0, 2),
                    payload_bytes=0,
                    room_code=self.room_code,
                )
            )
        except asyncio.TimeoutError as exc:
            self.recorder.record_socket(
                SocketSample(
                    scenario=self.recorder.scenario,
                    user_id=self.user_id,
                    event="connect",
                    direction="out",
                    ok=False,
                    duration_ms=round((time.perf_counter() - started_at) * 1000.0, 2),
                    payload_bytes=0,
                    room_code=self.room_code,
                    error="Timed out connecting Socket.IO client.",
                )
            )
            raise RuntimeError("Timed out connecting Socket.IO client.") from exc
        except Exception as exc:
            self.recorder.record_socket(
                SocketSample(
                    scenario=self.recorder.scenario,
                    user_id=self.user_id,
                    event="connect",
                    direction="out",
                    ok=False,
                    duration_ms=round((time.perf_counter() - started_at) * 1000.0, 2),
                    payload_bytes=0,
                    room_code=self.room_code,
                    error=str(exc),
                )
            )
            raise

        await self.emit_event("room:join_socket", {"room_code": room_code})
        deadline = time.perf_counter() + 10.0
        while time.perf_counter() < deadline:
            event, payload, _ = await asyncio.wait_for(self.socket_queue.get(), timeout=10.0)
            if event == "room:snapshot":
                return
            if event == "room:error":
                raise RuntimeError(str(payload.get("error") if isinstance(payload, dict) else payload))
        raise RuntimeError("Timed out waiting for room:snapshot after room:join_socket.")

    async def emit_event(self, event: str, payload: dict[str, Any]) -> None:
        started_at = time.perf_counter()
        try:
            await self.socket.emit(event, payload)
            self.recorder.record_socket(
                SocketSample(
                    scenario=self.recorder.scenario,
                    user_id=self.user_id,
                    event=event,
                    direction="out",
                    ok=True,
                    duration_ms=round((time.perf_counter() - started_at) * 1000.0, 2),
                    payload_bytes=payload_bytes(payload),
                    room_code=self.room_code,
                )
            )
        except Exception as exc:
            self.recorder.record_socket(
                SocketSample(
                    scenario=self.recorder.scenario,
                    user_id=self.user_id,
                    event=event,
                    direction="out",
                    ok=False,
                    duration_ms=round((time.perf_counter() - started_at) * 1000.0, 2),
                    payload_bytes=payload_bytes(payload),
                    room_code=self.room_code,
                    error=str(exc),
                )
            )
            raise

    async def emit_control(self, room_code: str, direction_x: float, direction_y: float) -> None:
        if len(self.pending_control_timestamps) >= 32:
            self.pending_control_timestamps.popleft()
        self.pending_control_timestamps.append(time.perf_counter())
        await self.emit_event(
            "room:control",
            {
                "room_code": room_code,
                "active": True,
                "direction": {"x": direction_x, "y": direction_y},
                "target": {"x": 20 + direction_x, "y": 20 + direction_y},
            },
        )

    async def emit_pause(self, room_code: str, paused: bool) -> None:
        await self.emit_event("room:pause", {"room_code": room_code, "paused": paused})

    async def emit_view_settings(self, room_code: str, settings: dict[str, Any]) -> None:
        await self.emit_event("room:view_settings", {"room_code": room_code, "settings": settings})

    async def close(self) -> None:
        disconnect = getattr(self.socket, "disconnect", None)
        if callable(disconnect):
            try:
                self._planned_disconnect = True
                await asyncio.wait_for(disconnect(), timeout=SESSION_CLOSE_TIMEOUT_SECONDS)
            except Exception:
                pass
        try:
            await asyncio.wait_for(self.http.aclose(), timeout=SESSION_CLOSE_TIMEOUT_SECONDS)
        except Exception:
            pass


async def _best_effort_leave(session: VirtualUser) -> None:
    try:
        await session.leave_room()
    except Exception:
        pass


async def _close_sessions(sessions: list[VirtualUser]) -> None:
    await asyncio.gather(*(session.close() for session in sessions), return_exceptions=True)


async def _leave_room_group(host: VirtualUser, guests: list[VirtualUser]) -> None:
    for guest in guests:
        await _best_effort_leave(guest)
    await _best_effort_leave(host)


async def _create_room_stack(
    base_url: str,
    recorder: LoadRecorder,
    room_index: int,
    participant_count: int,
    baseline_snapshot: dict[str, Any],
    *,
    concurrent_join: bool,
) -> tuple[VirtualUser, list[VirtualUser], str]:
    host = VirtualUser(base_url, f"Skipper-{room_index}-0", recorder)
    room_state = reshape_snapshot_for_players(baseline_snapshot, participant_count)
    room = await host.create_room(host.user_id, room_state)
    room_code = room["code"]
    guests = [VirtualUser(base_url, f"Skipper-{room_index}-{index}", recorder) for index in range(1, participant_count)]
    if concurrent_join:
        await asyncio.gather(*(guest.join_room(room_code, guest.user_id) for guest in guests))
    else:
        for guest in guests:
            await guest.join_room(room_code, guest.user_id)
    return host, guests, room_code


async def _connect_room_sockets(host: VirtualUser, guests: list[VirtualUser], room_code: str) -> None:
    await asyncio.gather(host.connect_socket(room_code), *(guest.connect_socket(room_code) for guest in guests))


async def control_loop(session: VirtualUser, room_code: str, duration_seconds: int, seed: int) -> None:
    rng = random.Random(seed)
    iterations = max(1, int(duration_seconds / REALTIME_CONTROL_INTERVAL_SECONDS))
    for _ in range(iterations):
        direction_x = round(rng.uniform(-1.0, 1.0), 3)
        direction_y = round(rng.uniform(-1.0, 1.0), 3)
        if direction_x == 0 and direction_y == 0:
            direction_x = 0.35
        await session.emit_control(room_code, direction_x, direction_y or 0.2)
        await asyncio.sleep(REALTIME_CONTROL_INTERVAL_SECONDS)


async def run_smoke(
    base_url: str,
    recorder: LoadRecorder,
    users: int,
    duration_seconds: int,
    *,
    baseline_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    snapshot = baseline_snapshot or load_local_baseline_snapshot()
    host, guests, room_code = await _create_room_stack(
        base_url,
        recorder,
        1,
        max(2, min(users, 2)),
        snapshot,
        concurrent_join=False,
    )
    sessions = [host, *guests]
    try:
        await _connect_room_sockets(host, guests, room_code)
        room_snapshot = await host.room_view(room_code)
        await host.start_room(room_code, room_snapshot["game_state"])
        await asyncio.gather(
            *(control_loop(session, room_code, duration_seconds, seed) for seed, session in enumerate(sessions, start=1))
        )
        await _leave_room_group(host, guests)
        return {"rooms": 1, "users": len(sessions), "room_codes": [room_code], "duration_seconds": duration_seconds}
    finally:
        await _close_sessions(sessions)


async def run_join_storm(
    base_url: str,
    recorder: LoadRecorder,
    users: int,
    duration_seconds: int,
    *,
    baseline_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    del duration_seconds
    snapshot = baseline_snapshot or load_local_baseline_snapshot()
    host, guests, room_code = await _create_room_stack(
        base_url,
        recorder,
        1,
        max(2, min(users, MAX_ROOM_PLAYERS)),
        snapshot,
        concurrent_join=True,
    )
    sessions = [host, *guests]
    try:
        await _connect_room_sockets(host, guests, room_code)
        await asyncio.sleep(0.5)
        return {"rooms": 1, "users": len(sessions), "room_codes": [room_code]}
    finally:
        await _close_sessions(sessions)


async def run_live_race(
    base_url: str,
    recorder: LoadRecorder,
    users: int,
    duration_seconds: int,
    *,
    rooms: int | None = None,
    users_per_room: int = MAX_ROOM_PLAYERS,
    baseline_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    snapshot = baseline_snapshot or load_local_baseline_snapshot()
    users_per_room = max(2, min(users_per_room, MAX_ROOM_PLAYERS))
    if rooms is None:
        rooms = max(1, math.ceil(max(users, 2) / users_per_room))

    sessions: list[VirtualUser] = []
    room_codes: list[str] = []
    racers: list[tuple[VirtualUser, str, int]] = []
    room_groups: list[tuple[VirtualUser, list[VirtualUser]]] = []
    remaining_users = max(users, rooms * 2)
    try:
        for room_index in range(1, rooms + 1):
            participant_count = max(2, min(users_per_room, remaining_users))
            remaining_users = max(0, remaining_users - participant_count)
            host, guests, room_code = await _create_room_stack(
                base_url,
                recorder,
                room_index,
                participant_count,
                snapshot,
                concurrent_join=True,
            )
            room_codes.append(room_code)
            room_sessions = [host, *guests]
            sessions.extend(room_sessions)
            room_groups.append((host, guests))
            await _connect_room_sockets(host, guests, room_code)
            room_snapshot = await host.room_view(room_code)
            await host.start_room(room_code, room_snapshot["game_state"])
            for seed, session in enumerate(room_sessions, start=1):
                racers.append((session, room_code, room_index * 100 + seed))

        await asyncio.gather(*(control_loop(session, room_code, duration_seconds, seed) for session, room_code, seed in racers))
        for host, guests in room_groups:
            await _leave_room_group(host, guests)
        return {"rooms": len(room_codes), "users": len(sessions), "room_codes": room_codes, "duration_seconds": duration_seconds}
    finally:
        await _close_sessions(sessions)


async def run_mixed_chaos(
    base_url: str,
    recorder: LoadRecorder,
    users: int,
    duration_seconds: int,
    *,
    baseline_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    snapshot = baseline_snapshot or load_local_baseline_snapshot()
    live_users = max(2, min(MAX_ROOM_PLAYERS, int(users * 0.6) or 2))
    lobby_users = max(2, min(MAX_ROOM_PLAYERS, max(users - live_users, 2)))

    live_host, live_guests, live_room_code = await _create_room_stack(
        base_url,
        recorder,
        1,
        live_users,
        snapshot,
        concurrent_join=True,
    )
    lobby_host, lobby_guests, lobby_room_code = await _create_room_stack(
        base_url,
        recorder,
        2,
        lobby_users,
        snapshot,
        concurrent_join=True,
    )
    live_sessions = [live_host, *live_guests]
    lobby_sessions = [lobby_host, *lobby_guests]
    sessions = [*live_sessions, *lobby_sessions]
    try:
        await _connect_room_sockets(live_host, live_guests, live_room_code)
        await _connect_room_sockets(lobby_host, lobby_guests, lobby_room_code)
        room_snapshot = await live_host.room_view(live_room_code)
        await live_host.start_room(live_room_code, room_snapshot["game_state"])

        async def lifecycle_ops() -> None:
            await asyncio.sleep(min(5, max(1, duration_seconds // 4)))
            await live_host.emit_pause(live_room_code, True)
            await asyncio.sleep(1)
            await live_host.emit_pause(live_room_code, False)
            await lobby_host.emit_view_settings(lobby_room_code, {"showLaylines": True, "showBestStart": True})
            if lobby_guests:
                await _best_effort_leave(lobby_guests[0])
            await asyncio.sleep(1)
            await live_host.reset_lobby(live_room_code)
            next_snapshot = await live_host.room_view(live_room_code)
            await live_host.start_room(live_room_code, next_snapshot["game_state"])

        await asyncio.gather(
            *(control_loop(session, live_room_code, duration_seconds, seed) for seed, session in enumerate(live_sessions, start=1)),
            lifecycle_ops(),
        )
        await _leave_room_group(lobby_host, lobby_guests)
        await _leave_room_group(live_host, live_guests)
        return {
            "rooms": 2,
            "users": len(sessions),
            "live_room_code": live_room_code,
            "lobby_room_code": lobby_room_code,
            "duration_seconds": duration_seconds,
        }
    finally:
        await _close_sessions(sessions)


SCENARIO_PRESETS: dict[str, dict[str, Any]] = {
    "smoke_1x2": {"runner": run_smoke, "users": 2, "rooms": 1, "users_per_room": 2, "duration_seconds": 45},
    "join_storm_1x20": {"runner": run_join_storm, "users": 20, "rooms": 1, "users_per_room": 20, "duration_seconds": 15},
    "live_race_1x20": {"runner": run_live_race, "users": 20, "rooms": 1, "users_per_room": 20, "duration_seconds": 180},
    "live_race_3x20": {"runner": run_live_race, "users": 60, "rooms": 3, "users_per_room": 20, "duration_seconds": 240},
    "live_race_5x20": {"runner": run_live_race, "users": 100, "rooms": 5, "users_per_room": 20, "duration_seconds": 300},
    "mixed_chaos_100": {"runner": run_mixed_chaos, "users": 100, "rooms": 5, "users_per_room": 20, "duration_seconds": 240},
}
