from __future__ import annotations

import argparse
import difflib
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
BUNDLE_PATH = ROOT_DIR / "static" / "regatta.js"
SECTIONS_DIR = ROOT_DIR / "static" / "regatta_src" / "sections"

SECTIONS = [
    ("00_bootstrap_dom.js", 1, 66, "DOMContentLoaded bootstrap and DOM references"),
    ("01_world_and_camera.js", 67, 286, "World, camera, math helpers and coordinate transforms"),
    ("02_wind_and_runtime_settings.js", 287, 432, "Wind, runtime settings and bot difficulty profiles"),
    ("03_game_objects_and_boat_state.js", 433, 1134, "Core game objects, boat state and low-level helpers"),
    ("04_geometry_intersections.js", 1135, 1284, "Geometry and intersection math"),
    ("05_rounding_rules.js", 1285, 1450, "Mark rounding runtime and planner rules"),
    ("06_collision_rules.js", 1451, 1497, "Boat and mark collision checks"),
    ("07_tack_penalty_rules.js", 1498, 1828, "Tack logic, penalties and movement factors"),
    ("08_start_line_and_move_helpers.js", 1829, 1930, "Start-line geometry and ray movement helpers"),
    ("09_progress_and_bot_ai.js", 1931, 2957, "Race progress, bots, realtime steering and local loops"),
    ("10_spawn_and_reset_placement.js", 2958, 3038, "Boat spawn placement behind the start line"),
    ("11_optimal_route_planner.js", 3039, 3391, "A* route planner and path helpers"),
    ("12_ui_status_and_stats.js", 3392, 3665, "HUD text, status labels and UI summaries"),
    ("13_reset_import_export.js", 3666, 4440, "Reset flow, import/export, snapshots and room sync helpers"),
    ("14_rendering.js", 4441, 5178, "Canvas rendering"),
    ("15_canvas_input.js", 5179, 5427, "Canvas interaction and realtime pointer input"),
    ("16_ui_events.js", 5428, 5995, "DOM event wiring"),
    ("17_init_and_bootstrap_end.js", 5996, 6050, "Init routine and public RegattaApp exposure"),
]


def bundle_lines() -> list[str]:
    return BUNDLE_PATH.read_text(encoding="utf-8").splitlines(keepends=True)


def section_paths() -> list[Path]:
    return [SECTIONS_DIR / filename for filename, *_ in SECTIONS]


def split_bundle() -> None:
    lines = bundle_lines()
    SECTIONS_DIR.mkdir(parents=True, exist_ok=True)

    for filename, start, end, _description in SECTIONS:
        chunk = "".join(lines[start - 1 : end])
        (SECTIONS_DIR / filename).write_text(chunk, encoding="utf-8")


def build_bundle() -> str:
    missing = [path for path in section_paths() if not path.exists()]
    if missing:
        missing_list = "\n".join(f"- {path.relative_to(ROOT_DIR)}" for path in missing)
        raise FileNotFoundError(f"Missing regatta source sections:\n{missing_list}")

    return "".join(path.read_text(encoding="utf-8") for path in section_paths())


def write_bundle() -> None:
    BUNDLE_PATH.write_text(build_bundle(), encoding="utf-8")


def verify_bundle() -> bool:
    source_text = build_bundle()
    bundle_text = BUNDLE_PATH.read_text(encoding="utf-8")
    if source_text == bundle_text:
        return True

    diff = difflib.unified_diff(
        bundle_text.splitlines(),
        source_text.splitlines(),
        fromfile=str(BUNDLE_PATH.relative_to(ROOT_DIR)),
        tofile="rebuilt-regatta.js",
        lineterm="",
    )
    sys.stderr.write("\n".join(diff) + "\n")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Split static/regatta.js into sectional source files and rebuild it."
    )
    parser.add_argument(
        "command",
        choices=("split", "build", "verify"),
        help="split current bundle into sections, rebuild bundle from sections, or verify both match",
    )
    args = parser.parse_args()

    if args.command == "split":
        split_bundle()
        return 0
    if args.command == "build":
        write_bundle()
        return 0
    return 0 if verify_bundle() else 1


if __name__ == "__main__":
    raise SystemExit(main())
