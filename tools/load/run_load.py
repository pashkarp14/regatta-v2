from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from tools.load.report_load import generate_report
    from tools.load.run import (
        BlockingIssue,
        DEFAULT_BASE_URL,
        DEFAULT_OUTPUT_ROOT,
        LoadRecorder,
        SCENARIO_PRESETS,
        capture_metrics_snapshot,
        collect_environment,
        ensure_output_dir,
        fetch_baseline_snapshot,
        normalize_base_url,
        run_live_race,
        utc_now_iso,
        write_blocking_issue,
    )
else:
    from .report_load import generate_report
    from .run import (
        BlockingIssue,
        DEFAULT_BASE_URL,
        DEFAULT_OUTPUT_ROOT,
        LoadRecorder,
        SCENARIO_PRESETS,
        capture_metrics_snapshot,
        collect_environment,
        ensure_output_dir,
        fetch_baseline_snapshot,
        normalize_base_url,
        run_live_race,
        utc_now_iso,
        write_blocking_issue,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a Regatta load scenario against a remote stand.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--scenario", choices=sorted(set(SCENARIO_PRESETS) | {"live_race"}), default="smoke_1x2")
    parser.add_argument("--rooms", type=int, default=None)
    parser.add_argument("--users", type=int, default=None)
    parser.add_argument("--users-per-room", type=int, default=None)
    parser.add_argument("--duration-sec", type=int, default=None)
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT))
    return parser


def _scenario_params(args: argparse.Namespace) -> tuple[Any, dict[str, Any]]:
    if args.scenario == "live_race":
        users_per_room = args.users_per_room or 20
        rooms = args.rooms or 1
        users = args.users or (rooms * users_per_room)
        return run_live_race, {
            "users": users,
            "rooms": rooms,
            "users_per_room": users_per_room,
            "duration_seconds": args.duration_sec or 180,
        }

    preset = dict(SCENARIO_PRESETS[args.scenario])
    runner = preset.pop("runner")
    return runner, {
        "users": args.users or preset["users"],
        "rooms": args.rooms or preset["rooms"],
        "users_per_room": args.users_per_room or preset["users_per_room"],
        "duration_seconds": args.duration_sec or preset["duration_seconds"],
    }


async def _execute_scenario(
    runner: Any,
    *,
    base_url: str,
    recorder: LoadRecorder,
    users: int,
    rooms: int,
    users_per_room: int,
    duration_seconds: int,
    baseline_snapshot: dict[str, Any],
) -> dict[str, Any]:
    if runner is run_live_race:
        return await runner(
            base_url,
            recorder,
            users,
            duration_seconds,
            rooms=rooms,
            users_per_room=users_per_room,
            baseline_snapshot=baseline_snapshot,
        )
    return await runner(
        base_url,
        recorder,
        users,
        duration_seconds,
        baseline_snapshot=baseline_snapshot,
    )


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    base_url = normalize_base_url(args.base_url)
    output_dir = ensure_output_dir(args.output_root)

    try:
        environment, _metrics_text, _inventory = collect_environment(base_url, output_dir)
    except BlockingIssue:
        print(json.dumps({"output_dir": str(output_dir)}, ensure_ascii=False))
        return 1

    baseline_snapshot, baseline_source = fetch_baseline_snapshot(base_url, output_dir)
    runner, params = _scenario_params(args)
    recorder = LoadRecorder(args.scenario)
    scenario_config = {
        "scenario": args.scenario,
        "base_url": base_url,
        "users": params["users"],
        "rooms": params["rooms"],
        "users_per_room": params["users_per_room"],
        "duration_seconds": params["duration_seconds"],
        "baseline_snapshot_source": baseline_source,
        "started_at": utc_now_iso(),
    }

    exit_code = 0
    try:
        result = asyncio.run(
            _execute_scenario(
                runner,
                base_url=base_url,
                recorder=recorder,
                users=params["users"],
                rooms=params["rooms"],
                users_per_room=params["users_per_room"],
                duration_seconds=params["duration_seconds"],
                baseline_snapshot=baseline_snapshot,
            )
        )
        scenario_config["result"] = result
    except Exception as exc:
        scenario_config["error"] = str(exc)
        write_blocking_issue(output_dir, "Scenario execution failed.", {"scenario": args.scenario, "error": str(exc)})
        exit_code = 1
    finally:
        scenario_config["finished_at"] = utc_now_iso()
        recorder.write(output_dir, scenario_config, environment=environment)
        try:
            capture_metrics_snapshot(base_url, output_dir / "metrics_final.txt")
        except BlockingIssue as exc:
            write_blocking_issue(output_dir, "Final metrics snapshot failed.", exc.details)
            exit_code = 1
        try:
            generate_report(output_dir)
        except Exception as exc:
            write_blocking_issue(output_dir, "Report generation failed.", {"error": str(exc)})
            exit_code = 1

    print(json.dumps({"output_dir": str(output_dir)}, ensure_ascii=False))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
