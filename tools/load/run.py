from __future__ import annotations

import argparse
import asyncio
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import random
import statistics
import sys
from typing import Any

import httpx
import socketio


DEFAULT_BASE_URL = "http://127.0.0.1:5001"
DEFAULT_OUTPUT_ROOT = Path("output") / "load"
REALTIME_CONTROL_INTERVAL_SECONDS = 0.25


@dataclass(slots=True)
class RequestSample:
    scenario: str
    user_id: str
    method: str
    path: str
    status: int
    duration_ms: float
    room_code: str | None = None
    ok: bool = True
    error: str = ""


@dataclass(slots=True)
class SocketSample:
    scenario: str
    user_id: str
    event: str
    direction: str
    status: str
    duration_ms: float
    payload_bytes: int
    room_code: str | None = None
    revision: int | None = None
    error: str = ""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def ensure_output_dir(root: Path, scenario: str) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = root / f"{timestamp}-{scenario}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def payload_bytes(payload: Any) -> int:
    if payload is None:
        return 0
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


def summarize_samples(requests: list[RequestSample], socket_events: list[SocketSample], errors: list[dict[str, Any]]) -> dict[str, Any]:
    request_groups: dict[str, list[float]] = defaultdict(list)
    socket_groups: dict[str, list[float]] = defaultdict(list)
    for sample in requests:
        request_groups[f"{sample.method} {sample.path}"].append(sample.duration_ms)
    for sample in socket_events:
        if sample.direction != "out":
            continue
        socket_groups[sample.event].append(sample.duration_ms)

    top_requests = sorted(
        (
            {"name": name, **summarize_durations(values)}
            for name, values in request_groups.items()
        ),
        key=lambda item: item["p95"],
        reverse=True,
    )
    top_socket_events = sorted(
        (
            {"name": name, **summarize_durations(values)}
            for name, values in socket_groups.items()
        ),
        key=lambda item: item["p95"],
        reverse=True,
    )
    return {
        "requests": top_requests,
        "socket_events": top_socket_events,
        "errors_total": len(errors),
        "top_errors": errors[:20],
    }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    import csv

    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


class LoadRecorder:
    def __init__(self, scenario: str) -> None:
        self.scenario = scenario
        self.requests: list[RequestSample] = []
        self.socket_events: list[SocketSample] = []
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
                }
            )

    def record_socket(self, sample: SocketSample) -> None:
        self.socket_events.append(sample)
        if sample.status not in {"ok", "connected"}:
            self.errors.append(
                {
                    "source": "socket",
                    "event": sample.event,
                    "status": sample.status,
                    "error": sample.error,
                    "user_id": sample.user_id,
                    "room_code": sample.room_code,
                }
            )

    def write(self, output_dir: Path, scenario_config: dict[str, Any]) -> None:
        summary = summarize_samples(self.requests, self.socket_events, self.errors)
        latency_histograms = {
            "http": {
                sample.path: summarize_durations([item.duration_ms for item in self.requests if item.path == sample.path])
                for sample in self.requests
            },
            "socket": {
                sample.event: summarize_durations([item.duration_ms for item in self.socket_events if item.event == sample.event])
                for sample in self.socket_events
            },
        }
        write_csv(output_dir / "requests.csv", [asdict(item) for item in self.requests])
        write_csv(output_dir / "socket_events.csv", [asdict(item) for item in self.socket_events])
        (output_dir / "errors.json").write_text(json.dumps(self.errors, ensure_ascii=False, indent=2), encoding="utf-8")
        (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        (output_dir / "latency_histograms.json").write_text(json.dumps(latency_histograms, ensure_ascii=False, indent=2), encoding="utf-8")
        (output_dir / "scenario_config.json").write_text(json.dumps(scenario_config, ensure_ascii=False, indent=2), encoding="utf-8")


class UserSession:
    def __init__(self, base_url: str, user_id: str, recorder: LoadRecorder) -> None:
        self.base_url = base_url.rstrip("/")
        self.user_id = user_id
        self.recorder = recorder
        self.http = httpx.AsyncClient(base_url=self.base_url, timeout=15.0, follow_redirects=True)
        self.socket = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
        self.socket_queue: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue()
        self.room_code: str | None = None
        self._install_socket_handlers()

    def _install_socket_handlers(self) -> None:
        @self.socket.event
        async def connect() -> None:
            self.recorder.record_socket(
                SocketSample(
                    scenario=self.recorder.scenario,
                    user_id=self.user_id,
                    event="connect",
                    direction="out",
                    status="connected",
                    duration_ms=0.0,
                    payload_bytes=0,
                    room_code=self.room_code,
                )
            )

        @self.socket.on("room:snapshot")
        async def on_snapshot(payload: dict[str, Any]) -> None:
            room = payload.get("room") if isinstance(payload, dict) else None
            revision = room.get("revision") if isinstance(room, dict) else None
            self.recorder.record_socket(
                SocketSample(
                    scenario=self.recorder.scenario,
                    user_id=self.user_id,
                    event="room:snapshot",
                    direction="in",
                    status="ok",
                    duration_ms=0.0,
                    payload_bytes=payload_bytes(payload),
                    room_code=room.get("code") if isinstance(room, dict) else self.room_code,
                    revision=revision if isinstance(revision, int) else None,
                )
            )
            await self.socket_queue.put(("room:snapshot", payload))

        @self.socket.on("room:state_updated")
        async def on_state_updated(payload: dict[str, Any]) -> None:
            room = payload.get("room") if isinstance(payload, dict) else None
            revision = room.get("revision") if isinstance(room, dict) else None
            self.recorder.record_socket(
                SocketSample(
                    scenario=self.recorder.scenario,
                    user_id=self.user_id,
                    event="room:state_updated",
                    direction="in",
                    status="ok",
                    duration_ms=0.0,
                    payload_bytes=payload_bytes(payload),
                    room_code=room.get("code") if isinstance(room, dict) else self.room_code,
                    revision=revision if isinstance(revision, int) else None,
                )
            )
            await self.socket_queue.put(("room:state_updated", payload))

        @self.socket.on("room:error")
        async def on_room_error(payload: dict[str, Any]) -> None:
            self.recorder.record_socket(
                SocketSample(
                    scenario=self.recorder.scenario,
                    user_id=self.user_id,
                    event="room:error",
                    direction="in",
                    status="error",
                    duration_ms=0.0,
                    payload_bytes=payload_bytes(payload),
                    room_code=self.room_code,
                    error=str(payload.get("error") if isinstance(payload, dict) else payload),
                )
            )
            await self.socket_queue.put(("room:error", payload))

    async def request(self, method: str, path: str, *, json_body: dict[str, Any] | None = None) -> dict[str, Any]:
        started_at = asyncio.get_running_loop().time()
        status = 0
        try:
            response = await self.http.request(method, path, json=json_body)
            status = response.status_code
            payload = response.json()
            sample = RequestSample(
                scenario=self.recorder.scenario,
                user_id=self.user_id,
                method=method,
                path=path,
                status=status,
                duration_ms=round((asyncio.get_running_loop().time() - started_at) * 1000.0, 2),
                room_code=self.room_code,
                ok=response.is_success,
                error="" if response.is_success else str(payload.get("error", response.text)),
            )
            self.recorder.record_request(sample)
            if not response.is_success:
                raise RuntimeError(sample.error or f"HTTP {status}")
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
                        duration_ms=round((asyncio.get_running_loop().time() - started_at) * 1000.0, 2),
                        room_code=self.room_code,
                        ok=False,
                        error=str(exc),
                    )
                )
            raise

    def cookie_header(self) -> str:
        return "; ".join(f"{key}={value}" for key, value in self.http.cookies.items())

    async def create_room(self, display_name: str, host_role: str = "player") -> dict[str, Any]:
        payload = await self.request(
            "POST",
            "/api/rooms",
            json_body={
                "display_name": display_name,
                "host_role": host_role,
                "max_players": 20,
                "game_state": make_realtime_state(2),
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

    async def leave_room(self) -> None:
        await self.request("POST", "/api/rooms/leave")

    async def connect_socket(self, room_code: str) -> None:
        self.room_code = room_code
        headers = {"Cookie": self.cookie_header()} if self.cookie_header() else {}
        await self.socket.connect(self.base_url, transports=["websocket", "polling"], headers=headers)
        started_at = asyncio.get_running_loop().time()
        payload = {"room_code": room_code}
        await self.socket.emit("room:join_socket", payload)
        self.recorder.record_socket(
            SocketSample(
                scenario=self.recorder.scenario,
                user_id=self.user_id,
                event="room:join_socket",
                direction="out",
                status="ok",
                duration_ms=round((asyncio.get_running_loop().time() - started_at) * 1000.0, 2),
                payload_bytes=payload_bytes(payload),
                room_code=room_code,
            )
        )
        await asyncio.wait_for(self.socket_queue.get(), timeout=10.0)

    async def emit_control(self, room_code: str, direction_x: float, direction_y: float) -> None:
        payload = {
            "room_code": room_code,
            "active": True,
            "direction": {"x": direction_x, "y": direction_y},
            "target": {"x": 20 + direction_x, "y": 20 + direction_y},
        }
        started_at = asyncio.get_running_loop().time()
        await self.socket.emit("room:control", payload)
        self.recorder.record_socket(
            SocketSample(
                scenario=self.recorder.scenario,
                user_id=self.user_id,
                event="room:control",
                direction="out",
                status="ok",
                duration_ms=round((asyncio.get_running_loop().time() - started_at) * 1000.0, 2),
                payload_bytes=payload_bytes(payload),
                room_code=room_code,
            )
        )

    async def emit_pause(self, room_code: str, paused: bool) -> None:
        payload = {"room_code": room_code, "paused": paused}
        started_at = asyncio.get_running_loop().time()
        await self.socket.emit("room:pause", payload)
        self.recorder.record_socket(
            SocketSample(
                scenario=self.recorder.scenario,
                user_id=self.user_id,
                event="room:pause",
                direction="out",
                status="ok",
                duration_ms=round((asyncio.get_running_loop().time() - started_at) * 1000.0, 2),
                payload_bytes=payload_bytes(payload),
                room_code=room_code,
            )
        )

    async def emit_push_state(self, room_code: str, state: dict[str, Any]) -> None:
        payload = {"room_code": room_code, "state": state}
        started_at = asyncio.get_running_loop().time()
        await self.socket.emit("room:push_state", payload)
        self.recorder.record_socket(
            SocketSample(
                scenario=self.recorder.scenario,
                user_id=self.user_id,
                event="room:push_state",
                direction="out",
                status="ok",
                duration_ms=round((asyncio.get_running_loop().time() - started_at) * 1000.0, 2),
                payload_bytes=payload_bytes(payload),
                room_code=room_code,
            )
        )

    async def close(self) -> None:
        if self.socket.connected:
            await self.socket.disconnect()
        await self.http.aclose()


def make_realtime_state(boat_count: int = 2) -> dict[str, Any]:
    boats = []
    for index in range(boat_count):
        boats.append(
            {
                "x": 8 + index * 3,
                "y": 8 + index * 2,
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
                "color": f"boat-{index}",
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
        )
    return {
        "version": 2,
        "world": {"width": 30, "height": 30},
        "settings": {
            "playMode": "realtime",
            "finishSeparate": False,
            "realtimePrepSeconds": 10,
            "turnRateDegPerSec": 120,
            "interactionMode": "contact",
            "windAngleDeg": 0,
        },
        "course": {
            "markCount": 1,
            "marks": [{"x": 22, "y": 22}],
            "startA": {"x": 8, "y": 2},
            "startB": {"x": 22, "y": 2},
            "finishA": {"x": 8, "y": 2},
            "finishB": {"x": 22, "y": 2},
        },
        "race": {
            "phase": "countdown",
            "raceFinishedCount": 0,
            "realtimeCountdownEndsAt": 0,
            "realtimePaused": False,
            "realtimePauseStartedAt": 0,
            "gustExpiresAt": 0,
            "nextAutoGustAt": 0,
        },
        "boats": boats,
    }


def mutate_lobby_state(state: dict[str, Any], iteration: int) -> dict[str, Any]:
    next_state = json.loads(json.dumps(state))
    next_state.setdefault("settings", {})
    next_state["settings"]["windAngleDeg"] = (iteration * 18) % 360
    next_state["settings"]["showLaylines"] = iteration % 2 == 0
    return next_state


async def build_room(base_url: str, recorder: LoadRecorder, room_index: int, participant_count: int) -> tuple[UserSession, list[UserSession], str]:
    host = UserSession(base_url, f"room-{room_index}-host", recorder)
    await host.create_room(f"Host {room_index}")
    assert host.room_code is not None
    guests: list[UserSession] = []
    for guest_index in range(max(0, participant_count - 1)):
        guest = UserSession(base_url, f"room-{room_index}-guest-{guest_index + 1}", recorder)
        await guest.join_room(host.room_code, f"Guest {room_index}-{guest_index + 1}")
        guests.append(guest)
    return host, guests, host.room_code


async def connect_room_sockets(host: UserSession, guests: list[UserSession], room_code: str) -> None:
    await asyncio.gather(host.connect_socket(room_code), *(guest.connect_socket(room_code) for guest in guests))


async def run_join_storm(base_url: str, recorder: LoadRecorder, users: int, _duration_seconds: int) -> dict[str, Any]:
    host, guests, room_code = await build_room(base_url, recorder, 1, max(2, min(users, 20)))
    try:
        await connect_room_sockets(host, guests, room_code)
        return {"rooms": 1, "users": 1 + len(guests), "room_codes": [room_code]}
    finally:
        await asyncio.gather(*(guest.close() for guest in guests), host.close())


async def run_lobby_edit(base_url: str, recorder: LoadRecorder, users: int, duration_seconds: int) -> dict[str, Any]:
    host, guests, room_code = await build_room(base_url, recorder, 1, max(2, min(users, 20)))
    try:
        await connect_room_sockets(host, guests, room_code)
        room = await host.room_view(room_code)
        state = room["game_state"]
        for index in range(max(4, duration_seconds * 2)):
            state = mutate_lobby_state(state, index)
            await host.emit_push_state(room_code, state)
            await asyncio.sleep(0.5)
        return {"rooms": 1, "users": 1 + len(guests), "iterations": max(4, duration_seconds * 2)}
    finally:
        await asyncio.gather(*(guest.close() for guest in guests), host.close())


async def control_loop(session: UserSession, room_code: str, duration_seconds: int, seed: int) -> None:
    random.seed(seed)
    iterations = max(1, int(duration_seconds / REALTIME_CONTROL_INTERVAL_SECONDS))
    for step in range(iterations):
        angle = (step * 17 + seed * 13) % 360
        direction_x = round(random.uniform(-1.0, 1.0), 3)
        direction_y = round(random.uniform(-1.0, 1.0), 3)
        await session.emit_control(room_code, direction_x or 0.4, direction_y or 0.2)
        await asyncio.sleep(REALTIME_CONTROL_INTERVAL_SECONDS)


async def run_live_race(base_url: str, recorder: LoadRecorder, users: int, duration_seconds: int) -> dict[str, Any]:
    rooms = max(1, min(5, (users + 19) // 20))
    sessions: list[UserSession] = []
    room_codes: list[str] = []
    racers: list[tuple[UserSession, str, int]] = []
    try:
        remaining_users = max(2, users)
        for room_index in range(rooms):
            participants = min(20, remaining_users)
            remaining_users = max(0, remaining_users - participants)
            host, guests, room_code = await build_room(base_url, recorder, room_index + 1, max(2, participants))
            sessions.extend([host, *guests])
            room_codes.append(room_code)
            await connect_room_sockets(host, guests, room_code)
            room_snapshot = await host.room_view(room_code)
            await host.start_room(room_code, room_snapshot["game_state"])
            for seed, session in enumerate([host, *guests], start=1):
                racers.append((session, room_code, room_index * 100 + seed))
        await asyncio.gather(*(control_loop(session, room_code, duration_seconds, seed) for session, room_code, seed in racers))
        return {"rooms": len(room_codes), "users": len(sessions), "room_codes": room_codes, "duration_seconds": duration_seconds}
    finally:
        await asyncio.gather(*(session.close() for session in sessions))


async def run_mixed_chaos(base_url: str, recorder: LoadRecorder, users: int, duration_seconds: int) -> dict[str, Any]:
    users = max(10, users)
    live_users = max(10, int(users * 0.6))
    lobby_users = max(4, users - live_users)
    live_summary = await run_live_race(base_url, recorder, live_users, duration_seconds)
    lobby_summary = await run_lobby_edit(base_url, recorder, min(20, lobby_users), max(4, duration_seconds // 2))
    return {
        "live": live_summary,
        "lobby": lobby_summary,
        "mixed_users": users,
    }


SCENARIOS = {
    "join_storm_1x20": run_join_storm,
    "lobby_edit_1x20": run_lobby_edit,
    "live_race_5x20": run_live_race,
    "mixed_chaos_100": run_mixed_chaos,
}


def default_users_for_scenario(scenario: str) -> int:
    return {
        "join_storm_1x20": 20,
        "lobby_edit_1x20": 20,
        "live_race_5x20": 100,
        "mixed_chaos_100": 100,
    }.get(scenario, 20)


async def run_scenario(args: argparse.Namespace) -> Path:
    recorder = LoadRecorder(args.scenario)
    users = args.users or default_users_for_scenario(args.scenario)
    output_dir = ensure_output_dir(Path(args.output_root), args.scenario)
    config = {
        "scenario": args.scenario,
        "base_url": args.base_url,
        "users": users,
        "duration_seconds": args.duration_seconds,
        "started_at": utc_now_iso(),
    }
    scenario_fn = SCENARIOS[args.scenario]
    config["result"] = await scenario_fn(args.base_url, recorder, users, args.duration_seconds)
    config["finished_at"] = utc_now_iso()
    recorder.write(output_dir, config)
    return output_dir


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Regatta load scenarios and write machine-readable reports.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--scenario", choices=sorted(SCENARIOS.keys()), default="join_storm_1x20")
    parser.add_argument("--users", type=int, default=None, help="Override total simulated users.")
    parser.add_argument("--duration-seconds", type=int, default=12)
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT))
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    output_dir = asyncio.run(run_scenario(args))
    print(json.dumps({"output_dir": str(output_dir)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
