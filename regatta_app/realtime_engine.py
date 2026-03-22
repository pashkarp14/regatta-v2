from __future__ import annotations

import logging
import math
import random
from copy import deepcopy
from typing import Any

from flask import current_app, has_app_context


MARK_RADIUS = 0.28
BOAT_RULE_LENGTH = 0.85
BOAT_FOOTPRINT_LENGTH = 1.55
BOAT_FOOTPRINT_BEAM = 0.78
BOAT_COLLISION_RADIUS = BOAT_FOOTPRINT_BEAM / 2
BOAT_CAPSULE_HALF_SEGMENT = max(0.0, (BOAT_FOOTPRINT_LENGTH - BOAT_FOOTPRINT_BEAM) / 2)
BOAT_SWEEP_RADIUS = BOAT_CAPSULE_HALF_SEGMENT + BOAT_COLLISION_RADIUS
BOAT_CLEARANCE_MARGIN = 0.16
MARK_CLEARANCE_MARGIN = 0.16
ROUND_PASS_RADIUS = BOAT_RULE_LENGTH * 3
ROUNDING_MIN_SWEEP = math.pi / 3
UNSTICK_PUSH_EPS = 0.03
UNSTICK_MAX_PASSES = 4
PRESSURE_UNSTICK_EXTRA_CLEARANCE = 0.18
PRESSURE_UNSTICK_MIN_PUSH = 0.08
PRESSURE_UNSTICK_APPROACH_DOT = 0.25
PRESSURE_UNSTICK_MAX_PASSES = 2

REALTIME_SPEED_UNITS_PER_SEC = 2.4
REALTIME_DEADZONE_SOFTNESS_DEG = 18.0
REALTIME_TARGET_EPS = 0.04
DEFAULT_TURN_RATE_DEG_PER_SEC = 120.0
DEFAULT_LUFFING_SPEED_PERCENT = 25.0
RULES_PENALTY_COOLDOWN_MS = 2200
RULES_PENALTY_SLOW_MS = 4000
RULES_PENALTY_SPEED_FACTOR = 0.72
RULES_OVERLAP_EPS = 0.05
RULES_LEEWAY_EPS = 0.05
RULES_MARK_ROOM_EPS = 0.15
BOAT_LENGTH_HALF = BOAT_FOOTPRINT_LENGTH / 2


def _realtime_logger() -> logging.Logger:
    if has_app_context():
        return current_app.logger
    return logging.getLogger(__name__)


def _format_realtime_log_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return f"{value:.3f}"
    if isinstance(value, dict) and "x" in value and "y" in value:
        return f"({float(value['x']):.3f},{float(value['y']):.3f})"
    if value is None:
        return "none"
    return repr(value) if isinstance(value, str) else str(value)


def _log_realtime_event(event: str, **fields: Any) -> None:
    details = " ".join(
        f"{key}={_format_realtime_log_value(value)}"
        for key, value in fields.items()
    )
    message = f"{event} {details}".strip()
    _realtime_logger().info(message)


def _log_mark_collision_detected(
    *,
    boat_index: int,
    mark_index: int,
    collision_kind: str,
    prev_pos: dict[str, float],
    dest_pos: dict[str, float],
    mark_pos: dict[str, float],
    distance: float,
    required_distance: float,
    proposal_distance: float,
) -> None:
    _log_realtime_event(
        "realtime.collision.mark.detected",
        boat_index=boat_index,
        mark_index=mark_index,
        collision_kind=collision_kind,
        prev_pos=prev_pos,
        dest_pos=dest_pos,
        mark_pos=mark_pos,
        distance=distance,
        required_distance=required_distance,
        proposal_distance=proposal_distance,
    )


def _log_boat_collision_detected(
    *,
    scope: str,
    collision_kind: str,
    boat_index: int | None = None,
    other_index: int | None = None,
    left_index: int | None = None,
    right_index: int | None = None,
    prev_pos: dict[str, float] | None = None,
    dest_pos: dict[str, float] | None = None,
    other_pos: dict[str, float] | None = None,
    left_prev: dict[str, float] | None = None,
    left_dest: dict[str, float] | None = None,
    right_prev: dict[str, float] | None = None,
    right_dest: dict[str, float] | None = None,
    distance: float,
    required_distance: float,
    proposal_distance: float | None = None,
    other_distance: float | None = None,
    pressure_pair_added: bool = False,
    other_moving: bool | None = None,
) -> None:
    _log_realtime_event(
        "realtime.collision.boats.detected",
        scope=scope,
        collision_kind=collision_kind,
        boat_index=boat_index,
        other_index=other_index,
        left_index=left_index,
        right_index=right_index,
        prev_pos=prev_pos,
        dest_pos=dest_pos,
        other_pos=other_pos,
        left_prev=left_prev,
        left_dest=left_dest,
        right_prev=right_prev,
        right_dest=right_dest,
        distance=distance,
        required_distance=required_distance,
        proposal_distance=proposal_distance,
        other_distance=other_distance,
        pressure_pair_added=pressure_pair_added,
        other_moving=other_moving,
    )


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def dist(left: dict[str, float], right: dict[str, float]) -> float:
    return math.hypot(left["x"] - right["x"], left["y"] - right["y"])


def dot(left: dict[str, float], right: dict[str, float]) -> float:
    return left["x"] * right["x"] + left["y"] * right["y"]


def normalize(vec: dict[str, float]) -> dict[str, float]:
    length = math.hypot(vec["x"], vec["y"]) or 1.0
    return {"x": vec["x"] / length, "y": vec["y"] / length, "length": length}


def lerp_point(start: dict[str, float], end: dict[str, float], t: float) -> dict[str, float]:
    return {
        "x": start["x"] + (end["x"] - start["x"]) * t,
        "y": start["y"] + (end["y"] - start["y"]) * t,
    }


def angle_wrap(angle: float) -> float:
    while angle > math.pi:
        angle -= 2 * math.pi
    while angle < -math.pi:
        angle += 2 * math.pi
    return angle


def turn_rate_rad_per_second(settings: dict[str, Any]) -> float:
    raw_rate = float(settings.get("turnRateDegPerSec") or DEFAULT_TURN_RATE_DEG_PER_SEC)
    return math.radians(clamp(raw_rate, 30.0, 360.0))


def realtime_luffing_speed_factor(settings: dict[str, Any]) -> float:
    raw_percent = float(settings.get("luffingSpeedPercent") or DEFAULT_LUFFING_SPEED_PERCENT)
    return clamp(raw_percent / 100.0, 0.0, 0.95)


def realtime_speed_factor_for_angle(angle_rad: float, settings: dict[str, Any]) -> float:
    half_dead = math.radians(float(settings.get("deadZoneDeg") or 0.0)) / 2.0
    if half_dead <= 1e-6:
        return 1.0

    softness = math.radians(max(2.0, REALTIME_DEADZONE_SOFTNESS_DEG))
    luff_factor = realtime_luffing_speed_factor(settings)
    if angle_rad <= half_dead:
        inside_ratio = clamp(angle_rad / half_dead, 0.0, 1.0)
        return clamp(luff_factor * (0.45 + inside_ratio * 0.55), 0.0, 1.0)

    return clamp(
        luff_factor + ((angle_rad - half_dead) / softness) * (1.0 - luff_factor),
        luff_factor,
        1.0,
    )


def steer_heading_toward(boat: dict[str, Any], desired_heading: float, dt_seconds: float, settings: dict[str, Any]) -> float:
    if not bool(boat.get("hasHeading")) or dt_seconds <= 0.0:
        return desired_heading
    current_heading = float(boat.get("heading") or 0.0)
    max_delta = turn_rate_rad_per_second(settings) * dt_seconds
    delta = angle_wrap(desired_heading - current_heading)
    return angle_wrap(current_heading + clamp(delta, -max_delta, max_delta))


def point_to_segment(point: dict[str, float], start: dict[str, float], end: dict[str, float]) -> tuple[float, dict[str, float], float]:
    abx = end["x"] - start["x"]
    aby = end["y"] - start["y"]
    apx = point["x"] - start["x"]
    apy = point["y"] - start["y"]
    ab2 = abx * abx + aby * aby
    if ab2 == 0:
        return dist(point, start), {"x": start["x"], "y": start["y"]}, 0.0
    t = clamp((apx * abx + apy * aby) / ab2, 0.0, 1.0)
    proj = {"x": start["x"] + t * abx, "y": start["y"] + t * aby}
    return dist(point, proj), proj, t


def segment_distance_to_point(start: dict[str, float], end: dict[str, float], point: dict[str, float]) -> float:
    return point_to_segment(point, start, end)[0]


def orientation(a: dict[str, float], b: dict[str, float], c: dict[str, float]) -> float:
    return (b["x"] - a["x"]) * (c["y"] - a["y"]) - (b["y"] - a["y"]) * (c["x"] - a["x"])


def on_segment(a: dict[str, float], b: dict[str, float], c: dict[str, float]) -> bool:
    return (
        min(a["x"], b["x"]) - 1e-9 <= c["x"] <= max(a["x"], b["x"]) + 1e-9
        and min(a["y"], b["y"]) - 1e-9 <= c["y"] <= max(a["y"], b["y"]) + 1e-9
    )


def segments_intersect(p1: dict[str, float], p2: dict[str, float], q1: dict[str, float], q2: dict[str, float]) -> bool:
    o1 = orientation(p1, p2, q1)
    o2 = orientation(p1, p2, q2)
    o3 = orientation(q1, q2, p1)
    o4 = orientation(q1, q2, p2)

    if ((o1 > 0 > o2) or (o1 < 0 < o2)) and ((o3 > 0 > o4) or (o3 < 0 < o4)):
        return True
    if abs(o1) < 1e-9 and on_segment(p1, p2, q1):
        return True
    if abs(o2) < 1e-9 and on_segment(p1, p2, q2):
        return True
    if abs(o3) < 1e-9 and on_segment(q1, q2, p1):
        return True
    if abs(o4) < 1e-9 and on_segment(q1, q2, p2):
        return True
    return False


def boat_axis_unit(heading: float | None, has_heading: bool) -> dict[str, float]:
    if has_heading and isinstance(heading, (int, float)):
        return {"x": math.cos(heading), "y": math.sin(heading)}
    return {"x": 0.0, "y": 1.0}


def boat_capsule_at(position: dict[str, float], heading: float | None, has_heading: bool) -> dict[str, Any]:
    axis = boat_axis_unit(heading, has_heading)
    return {
        "a": {
            "x": position["x"] - axis["x"] * BOAT_CAPSULE_HALF_SEGMENT,
            "y": position["y"] - axis["y"] * BOAT_CAPSULE_HALF_SEGMENT,
        },
        "b": {
            "x": position["x"] + axis["x"] * BOAT_CAPSULE_HALF_SEGMENT,
            "y": position["y"] + axis["y"] * BOAT_CAPSULE_HALF_SEGMENT,
        },
        "r": BOAT_COLLISION_RADIUS,
    }


def segment_segment_closest_points(
    a0: dict[str, float], a1: dict[str, float], b0: dict[str, float], b1: dict[str, float]
) -> tuple[dict[str, float], dict[str, float], float]:
    eps = 1e-9
    u = {"x": a1["x"] - a0["x"], "y": a1["y"] - a0["y"]}
    v = {"x": b1["x"] - b0["x"], "y": b1["y"] - b0["y"]}
    w = {"x": a0["x"] - b0["x"], "y": a0["y"] - b0["y"]}

    a = dot(u, u)
    b = dot(u, v)
    c = dot(v, v)
    d = dot(u, w)
    e = dot(v, w)
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
    dx = w["x"] + sc * u["x"] - tc * v["x"]
    dy = w["y"] + sc * u["y"] - tc * v["y"]
    point_a = lerp_point(a0, a1, sc)
    point_b = lerp_point(b0, b1, tc)
    return point_a, point_b, math.hypot(dx, dy)


def segment_segment_distance(a0: dict[str, float], a1: dict[str, float], b0: dict[str, float], b1: dict[str, float]) -> float:
    return segment_segment_closest_points(a0, a1, b0, b1)[2]


def capsules_overlap(left: dict[str, Any], right: dict[str, Any], extra: float = 0.0) -> bool:
    return segment_segment_distance(left["a"], left["b"], right["a"], right["b"]) < (left["r"] + right["r"] + extra - 1e-9)


def capsule_intersects_mark(capsule: dict[str, Any], mark_pos: dict[str, float], extra: float = 0.0) -> bool:
    return point_to_segment(mark_pos, capsule["a"], capsule["b"])[0] < (capsule["r"] + MARK_RADIUS + extra - 1e-9)


def boat_position(boat: dict[str, Any]) -> dict[str, float]:
    return {"x": float(boat["x"]), "y": float(boat["y"])}


def capsule_fits_within_field(
    capsule: dict[str, Any], world_w: float, world_h: float, extra: float = 0.0
) -> bool:
    min_x = min(capsule["a"]["x"], capsule["b"]["x"]) - capsule["r"] - extra
    max_x = max(capsule["a"]["x"], capsule["b"]["x"]) + capsule["r"] + extra
    min_y = min(capsule["a"]["y"], capsule["b"]["y"]) - capsule["r"] - extra
    max_y = max(capsule["a"]["y"], capsule["b"]["y"]) + capsule["r"] + extra
    return min_x >= -1e-9 and max_x <= world_w + 1e-9 and min_y >= -1e-9 and max_y <= world_h + 1e-9


def clamp_position_to_field(position: dict[str, float], world_w: float, world_h: float) -> dict[str, float]:
    return {
        "x": clamp(position["x"], 0.0, world_w),
        "y": clamp(position["y"], 0.0, world_h),
    }


def clamp_position_to_capsule_field(
    position: dict[str, float],
    heading: float | None,
    has_heading: bool,
    world_w: float,
    world_h: float,
    extra: float = 0.0,
) -> dict[str, float]:
    axis = boat_axis_unit(heading, has_heading)
    extent_x = abs(axis["x"]) * BOAT_CAPSULE_HALF_SEGMENT + BOAT_COLLISION_RADIUS + extra
    extent_y = abs(axis["y"]) * BOAT_CAPSULE_HALF_SEGMENT + BOAT_COLLISION_RADIUS + extra
    min_x = min(extent_x, world_w * 0.5)
    max_x = max(min_x, world_w - min_x)
    min_y = min(extent_y, world_h * 0.5)
    max_y = max(min_y, world_h - min_y)
    return {
        "x": clamp(position["x"], min_x, max_x),
        "y": clamp(position["y"], min_y, max_y),
    }


def preferred_separation_direction(
    primary: dict[str, float], fallback: dict[str, float], *, heading: float | None = None, has_heading: bool = False
) -> dict[str, float]:
    normalized = normalize(primary)
    if normalized["length"] > 1e-6:
        return {"x": normalized["x"], "y": normalized["y"]}
    normalized = normalize(fallback)
    if normalized["length"] > 1e-6:
        return {"x": normalized["x"], "y": normalized["y"]}
    axis = boat_axis_unit(heading, has_heading)
    return normalize(axis)


def separation_direction_candidates(
    primary: dict[str, float],
    fallback: dict[str, float],
    *,
    heading: float | None = None,
    has_heading: bool = False,
    extra_vectors: list[dict[str, float]] | None = None,
) -> list[dict[str, float]]:
    directions: list[dict[str, float]] = []
    seen_keys: set[tuple[float, float]] = set()

    def append(vector: dict[str, float]) -> None:
        normalized = normalize(vector)
        if normalized["length"] <= 1e-6:
            return
        key = (round(normalized["x"], 4), round(normalized["y"], 4))
        if key in seen_keys:
            return
        seen_keys.add(key)
        directions.append({"x": normalized["x"], "y": normalized["y"]})

    axis = boat_axis_unit(heading, has_heading)
    perpendicular = {"x": -axis["y"], "y": axis["x"]}
    append(primary)
    append(fallback)
    append(axis)
    append({"x": -axis["x"], "y": -axis["y"]})
    append(perpendicular)
    append({"x": -perpendicular["x"], "y": -perpendicular["y"]})
    for vector in extra_vectors or []:
        append(vector)
    if not directions:
        append({"x": 1.0, "y": 0.0})
    return directions


def best_mark_unstick_position(
    position: dict[str, float],
    mark: dict[str, float],
    heading: float,
    has_heading: bool,
    push_distance: float,
    primary: dict[str, float],
    fallback: dict[str, float],
    *,
    world_w: float,
    world_h: float,
) -> dict[str, float] | None:
    best_position: dict[str, float] | None = None
    best_clearance = -math.inf
    best_movement = 0.0

    for direction in separation_direction_candidates(primary, fallback, heading=heading, has_heading=has_heading):
        next_position = clamp_position_to_capsule_field(
            {
                "x": position["x"] + direction["x"] * push_distance,
                "y": position["y"] + direction["y"] * push_distance,
            },
            heading,
            has_heading,
            world_w,
            world_h,
            BOAT_CLEARANCE_MARGIN,
        )
        moved = dist(position, next_position)
        if moved <= 1e-6:
            continue

        next_capsule = boat_capsule_at(next_position, heading, has_heading)
        next_clearance, _, _ = point_to_segment(mark, next_capsule["a"], next_capsule["b"])
        if (
            best_position is None
            or next_clearance > best_clearance + 1e-6
            or (abs(next_clearance - best_clearance) <= 1e-6 and moved > best_movement + 1e-6)
        ):
            best_position = next_position
            best_clearance = next_clearance
            best_movement = moved

    return best_position


def best_boat_unstick_pair(
    left_position: dict[str, float],
    right_position: dict[str, float],
    left_heading: float,
    left_has_heading: bool,
    right_heading: float,
    right_has_heading: bool,
    push_distance: float,
    primary: dict[str, float],
    fallback: dict[str, float],
    *,
    world_w: float,
    world_h: float,
) -> tuple[dict[str, float], dict[str, float]] | None:
    right_axis = boat_axis_unit(right_heading, right_has_heading)
    right_perpendicular = {"x": -right_axis["y"], "y": right_axis["x"]}
    directions = separation_direction_candidates(
        primary,
        fallback,
        heading=left_heading,
        has_heading=left_has_heading,
        extra_vectors=[
            right_axis,
            {"x": -right_axis["x"], "y": -right_axis["y"]},
            right_perpendicular,
            {"x": -right_perpendicular["x"], "y": -right_perpendicular["y"]},
        ],
    )
    best_pair: tuple[dict[str, float], dict[str, float]] | None = None
    best_clearance = -math.inf
    best_movement = 0.0

    for direction in directions:
        next_left = clamp_position_to_capsule_field(
            {
                "x": left_position["x"] + direction["x"] * push_distance,
                "y": left_position["y"] + direction["y"] * push_distance,
            },
            left_heading,
            left_has_heading,
            world_w,
            world_h,
            BOAT_CLEARANCE_MARGIN,
        )
        next_right = clamp_position_to_capsule_field(
            {
                "x": right_position["x"] - direction["x"] * push_distance,
                "y": right_position["y"] - direction["y"] * push_distance,
            },
            right_heading,
            right_has_heading,
            world_w,
            world_h,
            BOAT_CLEARANCE_MARGIN,
        )
        moved = dist(left_position, next_left) + dist(right_position, next_right)
        if moved <= 1e-6:
            continue

        next_left_capsule = boat_capsule_at(next_left, left_heading, left_has_heading)
        next_right_capsule = boat_capsule_at(next_right, right_heading, right_has_heading)
        _, _, next_clearance = segment_segment_closest_points(
            next_left_capsule["a"],
            next_left_capsule["b"],
            next_right_capsule["a"],
            next_right_capsule["b"],
        )
        if (
            best_pair is None
            or next_clearance > best_clearance + 1e-6
            or (abs(next_clearance - best_clearance) <= 1e-6 and moved > best_movement + 1e-6)
        ):
            best_pair = (next_left, next_right)
            best_clearance = next_clearance
            best_movement = moved

    return best_pair


def best_single_boat_unstick_position(
    position: dict[str, float],
    heading: float,
    has_heading: bool,
    other_position: dict[str, float],
    other_heading: float,
    other_has_heading: bool,
    push_distance: float,
    primary: dict[str, float],
    fallback: dict[str, float],
    *,
    world_w: float,
    world_h: float,
) -> dict[str, float] | None:
    other_axis = boat_axis_unit(other_heading, other_has_heading)
    other_perpendicular = {"x": -other_axis["y"], "y": other_axis["x"]}
    directions = separation_direction_candidates(
        primary,
        fallback,
        heading=heading,
        has_heading=has_heading,
        extra_vectors=[
            other_axis,
            {"x": -other_axis["x"], "y": -other_axis["y"]},
            other_perpendicular,
            {"x": -other_perpendicular["x"], "y": -other_perpendicular["y"]},
        ],
    )
    other_capsule = boat_capsule_at(other_position, other_heading, other_has_heading)
    best_position: dict[str, float] | None = None
    best_clearance = -math.inf
    best_movement = 0.0

    for direction in directions:
        next_position = clamp_position_to_capsule_field(
            {
                "x": position["x"] + direction["x"] * push_distance,
                "y": position["y"] + direction["y"] * push_distance,
            },
            heading,
            has_heading,
            world_w,
            world_h,
            BOAT_CLEARANCE_MARGIN,
        )
        moved = dist(position, next_position)
        if moved <= 1e-6:
            continue

        next_capsule = boat_capsule_at(next_position, heading, has_heading)
        _, _, next_clearance = segment_segment_closest_points(
            next_capsule["a"],
            next_capsule["b"],
            other_capsule["a"],
            other_capsule["b"],
        )
        if (
            best_position is None
            or next_clearance > best_clearance + 1e-6
            or (abs(next_clearance - best_clearance) <= 1e-6 and moved > best_movement + 1e-6)
        ):
            best_position = next_position
            best_clearance = next_clearance
            best_movement = moved

    return best_position


def proposal_escape_direction(proposal: dict[str, Any] | None) -> dict[str, float]:
    motion = proposal_motion_unit(proposal)
    if motion is None:
        return {"x": 0.0, "y": 0.0}
    return {"x": -motion["x"], "y": -motion["y"]}


def resolve_realtime_stuck_motion(
    boats: list[dict[str, Any]],
    proposals: list[dict[str, Any]],
    blocked_events: list[dict[str, Any]],
    *,
    world_w: float,
    world_h: float,
) -> bool:
    changed = False

    for event in blocked_events:
        kind = str(event.get("kind") or "")
        boat_index = int(event.get("boat_index") or 0)
        if not (0 <= boat_index < len(boats)):
            continue

        proposal = proposals[boat_index] if boat_index < len(proposals) else None
        if not isinstance(proposal, dict) or not proposal.get("accepted"):
            continue
        proposal_distance = float(proposal.get("distance") or 0.0)
        if proposal_distance <= 1e-5:
            continue

        boat = boats[boat_index]
        position = boat_position(boat)
        heading = float(boat.get("heading") or 0.0)
        has_heading = bool(boat.get("hasHeading"))
        reverse_motion = proposal_escape_direction(proposal)

        if kind == "mark":
            mark = event.get("mark")
            mark_index = int(event.get("mark_index") or 0)
            if not isinstance(mark, dict):
                continue
            capsule = boat_capsule_at(position, heading, has_heading)
            current_distance, nearest_point, _ = point_to_segment(mark, capsule["a"], capsule["b"])
            required_distance = capsule["r"] + MARK_RADIUS + MARK_CLEARANCE_MARGIN
            push_distance = max(
                PRESSURE_UNSTICK_MIN_PUSH,
                min(PRESSURE_UNSTICK_EXTRA_CLEARANCE, proposal_distance),
                required_distance - current_distance + UNSTICK_PUSH_EPS,
            )
            primary = {"x": nearest_point["x"] - float(mark["x"]), "y": nearest_point["y"] - float(mark["y"])}
            fallback = reverse_motion
            _log_realtime_event(
                "realtime.stuck.mark.detected",
                boat_index=boat_index,
                mark_index=mark_index,
                boat_pos=position,
                mark_pos=mark,
                current_distance=current_distance,
                required_distance=required_distance,
                proposal_distance=proposal_distance,
                push_distance=push_distance,
            )
            next_position = best_mark_unstick_position(
                position,
                mark,
                heading,
                has_heading,
                push_distance,
                primary,
                fallback,
                world_w=world_w,
                world_h=world_h,
            )
            if next_position is None:
                _log_realtime_event(
                    "realtime.stuck.mark.unresolved",
                    boat_index=boat_index,
                    mark_index=mark_index,
                    boat_pos=position,
                    mark_pos=mark,
                    current_distance=current_distance,
                    required_distance=required_distance,
                    proposal_distance=proposal_distance,
                    push_distance=push_distance,
                    reason="no_candidate",
                )
                continue

            next_capsule = boat_capsule_at(next_position, heading, has_heading)
            next_clearance, _, _ = point_to_segment(mark, next_capsule["a"], next_capsule["b"])
            if dist(position, next_position) <= 1e-6:
                _log_realtime_event(
                    "realtime.stuck.mark.unresolved",
                    boat_index=boat_index,
                    mark_index=mark_index,
                    boat_pos=position,
                    mark_pos=mark,
                    current_distance=current_distance,
                    required_distance=required_distance,
                    proposal_distance=proposal_distance,
                    push_distance=push_distance,
                    reason="zero_move",
                )
                continue

            boat["x"] = next_position["x"]
            boat["y"] = next_position["y"]
            boat["currentSpeedUnitsPerSec"] = 0.0
            changed = True
            _log_realtime_event(
                "realtime.stuck.mark.resolved",
                boat_index=boat_index,
                mark_index=mark_index,
                from_pos=position,
                to_pos=next_position,
                moved=dist(position, next_position),
                push_distance=push_distance,
                selected_clearance=next_clearance,
            )
            continue

        if kind == "boats":
            other_index = int(event.get("other_index") or -1)
            if not (0 <= other_index < len(boats)) or other_index == boat_index:
                continue

            other_boat = boats[other_index]
            other_position = boat_position(other_boat)
            other_heading = float(other_boat.get("heading") or 0.0)
            other_has_heading = bool(other_boat.get("hasHeading"))
            capsule = boat_capsule_at(position, heading, has_heading)
            other_capsule = boat_capsule_at(other_position, other_heading, other_has_heading)
            closest_self, closest_other, current_distance = segment_segment_closest_points(
                capsule["a"],
                capsule["b"],
                other_capsule["a"],
                other_capsule["b"],
            )
            required_distance = capsule["r"] + other_capsule["r"] + BOAT_CLEARANCE_MARGIN
            push_distance = max(
                PRESSURE_UNSTICK_MIN_PUSH,
                min(PRESSURE_UNSTICK_EXTRA_CLEARANCE, proposal_distance),
                required_distance - current_distance + UNSTICK_PUSH_EPS,
            )
            primary = {
                "x": closest_self["x"] - closest_other["x"],
                "y": closest_self["y"] - closest_other["y"],
            }
            fallback = reverse_motion
            other_proposal = proposals[other_index] if other_index < len(proposals) else None
            other_moving = bool((other_proposal or {}).get("accepted")) and float((other_proposal or {}).get("distance") or 0.0) > 1e-5
            _log_realtime_event(
                "realtime.stuck.boats.detected",
                boat_index=boat_index,
                other_index=other_index,
                boat_pos=position,
                other_pos=other_position,
                current_distance=current_distance,
                required_distance=required_distance,
                proposal_distance=proposal_distance,
                push_distance=push_distance,
                other_moving=other_moving,
            )
            next_position = best_single_boat_unstick_position(
                position,
                heading,
                has_heading,
                other_position,
                other_heading,
                other_has_heading,
                push_distance,
                primary,
                fallback,
                world_w=world_w,
                world_h=world_h,
            )
            if next_position is None:
                _log_realtime_event(
                    "realtime.stuck.boats.unresolved",
                    boat_index=boat_index,
                    other_index=other_index,
                    boat_pos=position,
                    other_pos=other_position,
                    current_distance=current_distance,
                    required_distance=required_distance,
                    proposal_distance=proposal_distance,
                    push_distance=push_distance,
                    other_moving=other_moving,
                    reason="no_candidate",
                )
                continue

            next_capsule = boat_capsule_at(next_position, heading, has_heading)
            _, _, next_clearance = segment_segment_closest_points(
                next_capsule["a"],
                next_capsule["b"],
                other_capsule["a"],
                other_capsule["b"],
            )
            if dist(position, next_position) <= 1e-6:
                _log_realtime_event(
                    "realtime.stuck.boats.unresolved",
                    boat_index=boat_index,
                    other_index=other_index,
                    boat_pos=position,
                    other_pos=other_position,
                    current_distance=current_distance,
                    required_distance=required_distance,
                    proposal_distance=proposal_distance,
                    push_distance=push_distance,
                    other_moving=other_moving,
                    reason="zero_move",
                )
                continue

            boat["x"] = next_position["x"]
            boat["y"] = next_position["y"]
            boat["currentSpeedUnitsPerSec"] = 0.0
            changed = True
            _log_realtime_event(
                "realtime.stuck.boats.resolved",
                boat_index=boat_index,
                other_index=other_index,
                from_pos=position,
                to_pos=next_position,
                other_pos=other_position,
                moved=dist(position, next_position),
                push_distance=push_distance,
                selected_clearance=next_clearance,
                other_moving=other_moving,
            )

    return changed


def downwind_vec(wind_angle_deg: float) -> dict[str, float]:
    t = wind_angle_deg * math.pi / 180.0
    return {"x": math.sin(t), "y": -math.cos(t)}


def upwind_vec(wind_angle_deg: float) -> dict[str, float]:
    downwind = downwind_vec(wind_angle_deg)
    return {"x": -downwind["x"], "y": -downwind["y"]}


def resolve_realtime_overlaps(
    boats: list[dict[str, Any]],
    marks: list[dict[str, float]],
    mark_count: int,
    settings: dict[str, Any],
    *,
    world_w: float,
    world_h: float,
    wind_angle_deg: float,
) -> bool:
    changed = False
    active_marks = marks[: max(0, min(mark_count, len(marks)))]

    for pass_index in range(UNSTICK_MAX_PASSES):
        pass_changed = False

        for boat_index, boat in enumerate(boats):
            position = boat_position(boat)
            heading = float(boat.get("heading") or 0.0)
            has_heading = bool(boat.get("hasHeading"))
            clamped_position = clamp_position_to_capsule_field(
                position,
                heading,
                has_heading,
                world_w,
                world_h,
                BOAT_CLEARANCE_MARGIN,
            )
            if dist(position, clamped_position) > 1e-6:
                boat["x"] = clamped_position["x"]
                boat["y"] = clamped_position["y"]
                boat["currentSpeedUnitsPerSec"] = 0.0
                position = clamped_position
                pass_changed = True
            capsule = boat_capsule_at(position, heading, has_heading)

            for mark in active_marks:
                distance, nearest_point, _ = point_to_segment(mark, capsule["a"], capsule["b"])
                required_distance = capsule["r"] + MARK_RADIUS + MARK_CLEARANCE_MARGIN
                if distance >= required_distance - 1e-9:
                    continue

                primary = {"x": nearest_point["x"] - mark["x"], "y": nearest_point["y"] - mark["y"]}
                fallback = {"x": position["x"] - mark["x"], "y": position["y"] - mark["y"]}
                push_distance = required_distance - distance + UNSTICK_PUSH_EPS
                _log_realtime_event(
                    "realtime.unstick.mark.detected",
                    boat_index=boat_index,
                    pass_index=pass_index + 1,
                    boat_pos=position,
                    mark_pos=mark,
                    distance=distance,
                    required_distance=required_distance,
                    push_distance=push_distance,
                )
                next_position = best_mark_unstick_position(
                    position,
                    mark,
                    heading,
                    has_heading,
                    push_distance,
                    primary,
                    fallback,
                    world_w=world_w,
                    world_h=world_h,
                )
                if next_position is None:
                    _log_realtime_event(
                        "realtime.unstick.mark.unresolved",
                        boat_index=boat_index,
                        pass_index=pass_index + 1,
                        boat_pos=position,
                        mark_pos=mark,
                        distance=distance,
                        required_distance=required_distance,
                        push_distance=push_distance,
                        reason="no_candidate",
                    )
                    continue

                next_capsule = boat_capsule_at(next_position, heading, has_heading)
                next_clearance, _, _ = point_to_segment(mark, next_capsule["a"], next_capsule["b"])
                _log_realtime_event(
                    "realtime.unstick.mark.resolved",
                    boat_index=boat_index,
                    pass_index=pass_index + 1,
                    from_pos=position,
                    to_pos=next_position,
                    moved=dist(position, next_position),
                    push_distance=push_distance,
                    selected_clearance=next_clearance,
                )

                boat["x"] = next_position["x"]
                boat["y"] = next_position["y"]
                boat["currentSpeedUnitsPerSec"] = 0.0
                position = next_position
                capsule = boat_capsule_at(position, heading, has_heading)
                pass_changed = True

        if boats_physical_collisions_enabled(settings):
            for left_index in range(len(boats)):
                left_boat = boats[left_index]
                left_position = boat_position(left_boat)
                left_heading = float(left_boat.get("heading") or 0.0)
                left_has_heading = bool(left_boat.get("hasHeading"))
                left_capsule = boat_capsule_at(left_position, left_heading, left_has_heading)

                for right_index in range(left_index + 1, len(boats)):
                    right_boat = boats[right_index]
                    right_position = boat_position(right_boat)
                    right_heading = float(right_boat.get("heading") or 0.0)
                    right_has_heading = bool(right_boat.get("hasHeading"))
                    right_capsule = boat_capsule_at(right_position, right_heading, right_has_heading)

                    closest_left, closest_right, separation = segment_segment_closest_points(
                        left_capsule["a"],
                        left_capsule["b"],
                        right_capsule["a"],
                        right_capsule["b"],
                    )
                    required_distance = left_capsule["r"] + right_capsule["r"] + BOAT_CLEARANCE_MARGIN
                    if separation >= required_distance - 1e-9:
                        continue

                    primary = {"x": closest_left["x"] - closest_right["x"], "y": closest_left["y"] - closest_right["y"]}
                    fallback = {"x": left_position["x"] - right_position["x"], "y": left_position["y"] - right_position["y"]}
                    push_distance = (required_distance - separation + UNSTICK_PUSH_EPS) / 2.0
                    _log_realtime_event(
                        "realtime.unstick.boats.detected",
                        left_index=left_index,
                        right_index=right_index,
                        pass_index=pass_index + 1,
                        left_pos=left_position,
                        right_pos=right_position,
                        distance=separation,
                        required_distance=required_distance,
                        push_distance=push_distance,
                    )
                    next_pair = best_boat_unstick_pair(
                        left_position,
                        right_position,
                        left_heading,
                        left_has_heading,
                        right_heading,
                        right_has_heading,
                        push_distance,
                        primary,
                        fallback,
                        world_w=world_w,
                        world_h=world_h,
                    )
                    if next_pair is None:
                        _log_realtime_event(
                            "realtime.unstick.boats.unresolved",
                            left_index=left_index,
                            right_index=right_index,
                            pass_index=pass_index + 1,
                            left_pos=left_position,
                            right_pos=right_position,
                            distance=separation,
                            required_distance=required_distance,
                            push_distance=push_distance,
                            reason="no_candidate",
                        )
                        continue
                    next_left, next_right = next_pair
                    next_left_capsule = boat_capsule_at(next_left, left_heading, left_has_heading)
                    next_right_capsule = boat_capsule_at(next_right, right_heading, right_has_heading)
                    _, _, next_clearance = segment_segment_closest_points(
                        next_left_capsule["a"],
                        next_left_capsule["b"],
                        next_right_capsule["a"],
                        next_right_capsule["b"],
                    )
                    _log_realtime_event(
                        "realtime.unstick.boats.resolved",
                        left_index=left_index,
                        right_index=right_index,
                        pass_index=pass_index + 1,
                        left_from=left_position,
                        right_from=right_position,
                        left_to=next_left,
                        right_to=next_right,
                        moved=dist(left_position, next_left) + dist(right_position, next_right),
                        push_distance=push_distance,
                        selected_clearance=next_clearance,
                    )

                    moved = False
                    if dist(left_position, next_left) > 1e-6:
                        left_boat["x"] = next_left["x"]
                        left_boat["y"] = next_left["y"]
                        left_boat["currentSpeedUnitsPerSec"] = 0.0
                        left_position = next_left
                        left_capsule = boat_capsule_at(left_position, left_heading, left_has_heading)
                        moved = True
                    if dist(right_position, next_right) > 1e-6:
                        right_boat["x"] = next_right["x"]
                        right_boat["y"] = next_right["y"]
                        right_boat["currentSpeedUnitsPerSec"] = 0.0
                        right_position = next_right
                        moved = True
                    if moved:
                        pass_changed = True

        changed = pass_changed or changed
        if not pass_changed:
            break

    return changed


def proposal_motion_unit(proposal: dict[str, Any] | None) -> dict[str, float] | None:
    if not isinstance(proposal, dict) or not proposal.get("accepted"):
        return None

    motion = proposal.get("motionDirection") or proposal.get("direction")
    if not isinstance(motion, dict):
        return None

    dx = motion.get("x")
    dy = motion.get("y")
    if not isinstance(dx, (int, float)) or not isinstance(dy, (int, float)):
        return None

    normalized = normalize({"x": float(dx), "y": float(dy)})
    if normalized["length"] <= 1e-6:
        return None
    return {"x": normalized["x"], "y": normalized["y"]}


def proposal_presses_into_boat(
    source_boat: dict[str, Any],
    target_boat: dict[str, Any],
    proposal: dict[str, Any] | None,
) -> bool:
    if float((proposal or {}).get("distance") or 0.0) <= 1e-5:
        return False

    motion = proposal_motion_unit(proposal)
    if motion is None:
        return False

    towards_target = normalize(
        {
            "x": float(target_boat["x"]) - float(source_boat["x"]),
            "y": float(target_boat["y"]) - float(source_boat["y"]),
        }
    )
    if towards_target["length"] <= 1e-6:
        return False
    return dot(motion, {"x": towards_target["x"], "y": towards_target["y"]}) >= PRESSURE_UNSTICK_APPROACH_DOT


def resolve_realtime_pressure_jams(
    boats: list[dict[str, Any]],
    proposals: list[dict[str, Any]],
    pressure_pairs: set[tuple[int, int]],
    settings: dict[str, Any],
    *,
    world_w: float,
    world_h: float,
) -> bool:
    if not boats_physical_collisions_enabled(settings) or not pressure_pairs:
        return False

    changed = False
    sorted_pairs = sorted(pressure_pairs)

    for pass_index in range(PRESSURE_UNSTICK_MAX_PASSES):
        pass_changed = False

        for left_index, right_index in sorted_pairs:
            if not (0 <= left_index < len(boats) and 0 <= right_index < len(boats)):
                continue

            left_boat = boats[left_index]
            right_boat = boats[right_index]
            if left_boat.get("finished") or right_boat.get("finished"):
                continue

            left_proposal = proposals[left_index] if left_index < len(proposals) else None
            right_proposal = proposals[right_index] if right_index < len(proposals) else None
            left_presses = proposal_presses_into_boat(left_boat, right_boat, left_proposal)
            right_presses = proposal_presses_into_boat(right_boat, left_boat, right_proposal)
            if not (left_presses and right_presses):
                if left_presses != right_presses:
                    pushing_index = left_index if left_presses else right_index
                    blocked_index = right_index if left_presses else left_index
                    pushing_boat = left_boat if left_presses else right_boat
                    blocked_boat = right_boat if left_presses else left_boat
                    pushing_proposal = left_proposal if left_presses else right_proposal
                    pushing_position = boat_position(pushing_boat)
                    blocked_position = boat_position(blocked_boat)
                    pushing_heading = float(pushing_boat.get("heading") or 0.0)
                    blocked_heading = float(blocked_boat.get("heading") or 0.0)
                    pushing_has_heading = bool(pushing_boat.get("hasHeading"))
                    blocked_has_heading = bool(blocked_boat.get("hasHeading"))
                    pushing_capsule = boat_capsule_at(pushing_position, pushing_heading, pushing_has_heading)
                    blocked_capsule = boat_capsule_at(blocked_position, blocked_heading, blocked_has_heading)
                    closest_pushing, closest_blocked, separation = segment_segment_closest_points(
                        pushing_capsule["a"],
                        pushing_capsule["b"],
                        blocked_capsule["a"],
                        blocked_capsule["b"],
                    )
                    required_distance = pushing_capsule["r"] + blocked_capsule["r"] + BOAT_CLEARANCE_MARGIN
                    pushing_distance = float((pushing_proposal or {}).get("distance") or 0.0)
                    push_distance = max(
                        PRESSURE_UNSTICK_MIN_PUSH,
                        min(PRESSURE_UNSTICK_EXTRA_CLEARANCE, pushing_distance),
                        max(0.0, required_distance - separation + UNSTICK_PUSH_EPS),
                    )
                    _log_realtime_event(
                        "realtime.unstick.pressure.one_sided.detected",
                        left_index=left_index,
                        right_index=right_index,
                        pass_index=pass_index + 1,
                        pushing_index=pushing_index,
                        blocked_index=blocked_index,
                        pushing_pos=pushing_position,
                        blocked_pos=blocked_position,
                        separation=separation,
                        required_distance=required_distance,
                        push_distance=push_distance,
                    )
                    next_position = best_single_boat_unstick_position(
                        pushing_position,
                        pushing_heading,
                        pushing_has_heading,
                        blocked_position,
                        blocked_heading,
                        blocked_has_heading,
                        push_distance,
                        {
                            "x": closest_pushing["x"] - closest_blocked["x"],
                            "y": closest_pushing["y"] - closest_blocked["y"],
                        },
                        proposal_escape_direction(pushing_proposal),
                        world_w=world_w,
                        world_h=world_h,
                    )
                    if next_position is not None and dist(pushing_position, next_position) > 1e-6:
                        next_capsule = boat_capsule_at(next_position, pushing_heading, pushing_has_heading)
                        _, _, next_clearance = segment_segment_closest_points(
                            next_capsule["a"],
                            next_capsule["b"],
                            blocked_capsule["a"],
                            blocked_capsule["b"],
                        )
                        pushing_boat["x"] = next_position["x"]
                        pushing_boat["y"] = next_position["y"]
                        pushing_boat["currentSpeedUnitsPerSec"] = 0.0
                        pass_changed = True
                        _log_realtime_event(
                            "realtime.unstick.pressure.one_sided.resolved",
                            left_index=left_index,
                            right_index=right_index,
                            pass_index=pass_index + 1,
                            pushing_index=pushing_index,
                            blocked_index=blocked_index,
                            from_pos=pushing_position,
                            to_pos=next_position,
                            moved=dist(pushing_position, next_position),
                            push_distance=push_distance,
                            selected_clearance=next_clearance,
                        )
                        continue
                _log_realtime_event(
                    "realtime.unstick.pressure.skip",
                    left_index=left_index,
                    right_index=right_index,
                    pass_index=pass_index + 1,
                    left_presses=left_presses,
                    right_presses=right_presses,
                    left_distance=float((left_proposal or {}).get("distance") or 0.0),
                    right_distance=float((right_proposal or {}).get("distance") or 0.0),
                )
                continue

            left_position = boat_position(left_boat)
            right_position = boat_position(right_boat)
            left_heading = float(left_boat.get("heading") or 0.0)
            right_heading = float(right_boat.get("heading") or 0.0)
            left_has_heading = bool(left_boat.get("hasHeading"))
            right_has_heading = bool(right_boat.get("hasHeading"))
            left_capsule = boat_capsule_at(left_position, left_heading, left_has_heading)
            right_capsule = boat_capsule_at(right_position, right_heading, right_has_heading)

            closest_left, closest_right, separation = segment_segment_closest_points(
                left_capsule["a"],
                left_capsule["b"],
                right_capsule["a"],
                right_capsule["b"],
            )
            required_distance = left_capsule["r"] + right_capsule["r"] + BOAT_CLEARANCE_MARGIN
            target_distance = required_distance + PRESSURE_UNSTICK_EXTRA_CLEARANCE
            if separation >= target_distance - 1e-9:
                continue

            left_motion = proposal_motion_unit(left_proposal)
            right_motion = proposal_motion_unit(right_proposal)
            fallback = {
                "x": (left_motion["x"] if left_motion else 0.0) - (right_motion["x"] if right_motion else 0.0),
                "y": (left_motion["y"] if left_motion else 0.0) - (right_motion["y"] if right_motion else 0.0),
            }
            if math.hypot(fallback["x"], fallback["y"]) <= 1e-6:
                fallback = {
                    "x": left_position["x"] - right_position["x"],
                    "y": left_position["y"] - right_position["y"],
                }

            attempted_push = min(
                PRESSURE_UNSTICK_EXTRA_CLEARANCE,
                max(
                    float((left_proposal or {}).get("distance") or 0.0),
                    float((right_proposal or {}).get("distance") or 0.0),
                ),
            )
            push_distance = max(
                PRESSURE_UNSTICK_MIN_PUSH / 2.0,
                (target_distance - separation + UNSTICK_PUSH_EPS) / 2.0,
                attempted_push / 2.0,
            )
            _log_realtime_event(
                "realtime.unstick.pressure.detected",
                left_index=left_index,
                right_index=right_index,
                pass_index=pass_index + 1,
                left_pos=left_position,
                right_pos=right_position,
                separation=separation,
                target_distance=target_distance,
                attempted_push=attempted_push,
                push_distance=push_distance,
            )
            next_pair = best_boat_unstick_pair(
                left_position,
                right_position,
                left_heading,
                left_has_heading,
                right_heading,
                right_has_heading,
                push_distance,
                {
                    "x": closest_left["x"] - closest_right["x"],
                    "y": closest_left["y"] - closest_right["y"],
                },
                fallback,
                world_w=world_w,
                world_h=world_h,
            )
            if next_pair is None:
                _log_realtime_event(
                    "realtime.unstick.pressure.unresolved",
                    left_index=left_index,
                    right_index=right_index,
                    pass_index=pass_index + 1,
                    left_pos=left_position,
                    right_pos=right_position,
                    separation=separation,
                    target_distance=target_distance,
                    push_distance=push_distance,
                    reason="no_candidate",
                )
                continue

            next_left, next_right = next_pair
            next_left_capsule = boat_capsule_at(next_left, left_heading, left_has_heading)
            next_right_capsule = boat_capsule_at(next_right, right_heading, right_has_heading)
            _, _, next_clearance = segment_segment_closest_points(
                next_left_capsule["a"],
                next_left_capsule["b"],
                next_right_capsule["a"],
                next_right_capsule["b"],
            )
            _log_realtime_event(
                "realtime.unstick.pressure.resolved",
                left_index=left_index,
                right_index=right_index,
                pass_index=pass_index + 1,
                left_from=left_position,
                right_from=right_position,
                left_to=next_left,
                right_to=next_right,
                moved=dist(left_position, next_left) + dist(right_position, next_right),
                push_distance=push_distance,
                selected_clearance=next_clearance,
            )
            moved = False
            if dist(left_position, next_left) > 1e-6:
                left_boat["x"] = next_left["x"]
                left_boat["y"] = next_left["y"]
                left_boat["currentSpeedUnitsPerSec"] = 0.0
                moved = True
            if dist(right_position, next_right) > 1e-6:
                right_boat["x"] = next_right["x"]
                right_boat["y"] = next_right["y"]
                right_boat["currentSpeedUnitsPerSec"] = 0.0
                moved = True
            if moved:
                pass_changed = True

        changed = pass_changed or changed
        if not pass_changed:
            break

    return changed


def angle_between(left: dict[str, float], right: dict[str, float]) -> float:
    dl = math.hypot(left["x"], left["y"]) or 1.0
    dr = math.hypot(right["x"], right["y"]) or 1.0
    cosine = (left["x"] / dl) * (right["x"] / dr) + (left["y"] / dl) * (right["y"] / dr)
    return math.acos(clamp(cosine, -1.0, 1.0))


def point_in_field(point: dict[str, float], world_w: float, world_h: float) -> bool:
    return 0.0 <= point["x"] <= world_w and 0.0 <= point["y"] <= world_h


def clamp_along_ray_to_field(start_pos: dict[str, float], direction: dict[str, float], max_len: float, world_w: float, world_h: float) -> dict[str, float]:
    t_max = max_len

    if abs(direction["x"]) > 1e-9:
        tx1 = (0.0 - start_pos["x"]) / direction["x"]
        tx2 = (world_w - start_pos["x"]) / direction["x"]
        t_max = min(t_max, max(tx1, tx2))
        t_max = max(0.0, t_max)
    elif start_pos["x"] < 0.0 or start_pos["x"] > world_w:
        return {"x": start_pos["x"], "y": start_pos["y"]}

    if abs(direction["y"]) > 1e-9:
        ty1 = (0.0 - start_pos["y"]) / direction["y"]
        ty2 = (world_h - start_pos["y"]) / direction["y"]
        t_max = min(t_max, max(ty1, ty2))
        t_max = max(0.0, t_max)
    elif start_pos["y"] < 0.0 or start_pos["y"] > world_h:
        return {"x": start_pos["x"], "y": start_pos["y"]}

    return {
        "x": start_pos["x"] + direction["x"] * t_max,
        "y": start_pos["y"] + direction["y"] * t_max,
    }


def normalize_gust_zone(gust_rect: dict[str, float] | None, world_w: float | None = None, world_h: float | None = None) -> dict[str, float] | None:
    if not isinstance(gust_rect, dict):
        return None

    if all(isinstance(gust_rect.get(key), (int, float)) for key in ("cx", "cy", "rx", "ry")):
        cx = float(gust_rect["cx"])
        cy = float(gust_rect["cy"])
        rx = max(0.8, float(gust_rect["rx"]))
        ry = max(0.8, float(gust_rect["ry"]))
        angle = float(gust_rect.get("angle") or 0.0)
        if world_w is not None:
            cx = clamp(cx, rx, max(rx, world_w - rx))
        if world_h is not None:
            cy = clamp(cy, ry, max(ry, world_h - ry))
        return {"cx": cx, "cy": cy, "rx": rx, "ry": ry, "angle": angle}

    if all(isinstance(gust_rect.get(key), (int, float)) for key in ("x", "y", "w", "h")):
        width = max(1.6, float(gust_rect["w"]))
        height = max(1.6, float(gust_rect["h"]))
        return {
            "cx": float(gust_rect["x"]) + width / 2.0,
            "cy": float(gust_rect["y"]) + height / 2.0,
            "rx": width / 2.0,
            "ry": height / 2.0,
            "angle": 0.0,
        }

    return None


def point_in_gust(point: dict[str, float], gust_rect: dict[str, float] | None) -> bool:
    gust_zone = normalize_gust_zone(gust_rect)
    if not gust_zone:
        return False

    cos_a = math.cos(-gust_zone["angle"])
    sin_a = math.sin(-gust_zone["angle"])
    dx = point["x"] - gust_zone["cx"]
    dy = point["y"] - gust_zone["cy"]
    local_x = dx * cos_a - dy * sin_a
    local_y = dx * sin_a + dy * cos_a
    return ((local_x / gust_zone["rx"]) ** 2 + (local_y / gust_zone["ry"]) ** 2) <= 1.0


def midpoint(left: dict[str, float], right: dict[str, float]) -> dict[str, float]:
    return {"x": (left["x"] + right["x"]) / 2.0, "y": (left["y"] + right["y"]) / 2.0}


def start_line_dir_unit(start_a: dict[str, float], start_b: dict[str, float]) -> dict[str, float]:
    direction = normalize({"x": start_b["x"] - start_a["x"], "y": start_b["y"] - start_a["y"]})
    return {"x": direction["x"], "y": direction["y"]}


def course_side_normal_unit(start_a: dict[str, float], start_b: dict[str, float], marks: list[dict[str, float]]) -> dict[str, float]:
    direction = start_line_dir_unit(start_a, start_b)
    normal_a = {"x": -direction["y"], "y": direction["x"]}
    normal_b = {"x": direction["y"], "y": -direction["x"]}
    mid = midpoint(start_a, start_b)
    first_mark = marks[0] if marks else {"x": mid["x"], "y": mid["y"] + 1.0}
    to_mark = {"x": first_mark["x"] - mid["x"], "y": first_mark["y"] - mid["y"]}
    dot_a = normal_a["x"] * to_mark["x"] + normal_a["y"] * to_mark["y"]
    dot_b = normal_b["x"] * to_mark["x"] + normal_b["y"] * to_mark["y"]
    return normal_a if dot_a >= dot_b else normal_b


def start_line_side_value(point: dict[str, float], start_a: dict[str, float], start_b: dict[str, float], marks: list[dict[str, float]]) -> float:
    mid = midpoint(start_a, start_b)
    normal = course_side_normal_unit(start_a, start_b, marks)
    return (point["x"] - mid["x"]) * normal["x"] + (point["y"] - mid["y"]) * normal["y"]


def classify_start_line_crossing(
    prev_pos: dict[str, float],
    cur_pos: dict[str, float],
    start_a: dict[str, float],
    start_b: dict[str, float],
    marks: list[dict[str, float]],
) -> str | None:
    if not segments_intersect(prev_pos, cur_pos, start_a, start_b):
        return None
    prev_side = start_line_side_value(prev_pos, start_a, start_b, marks)
    cur_side = start_line_side_value(cur_pos, start_a, start_b, marks)
    if prev_side <= 1e-6 and cur_side > 1e-6:
        return "to_course"
    if prev_side >= -1e-6 and cur_side < -1e-6:
        return "to_prestart"
    return None


def start_line_crossing_time_ms(
    prev_pos: dict[str, float],
    cur_pos: dict[str, float],
    start_a: dict[str, float],
    start_b: dict[str, float],
    marks: list[dict[str, float]],
    tick_start_ms: int,
    tick_end_ms: int,
) -> int:
    prev_side = start_line_side_value(prev_pos, start_a, start_b, marks)
    cur_side = start_line_side_value(cur_pos, start_a, start_b, marks)
    denom = prev_side - cur_side
    if abs(denom) < 1e-9:
        return tick_end_ms
    fraction = clamp(prev_side / denom, 0.0, 1.0)
    return int(tick_start_ms + (tick_end_ms - tick_start_ms) * fraction)


def record_realtime_start_crossing(
    boat: dict[str, Any],
    prev_pos: dict[str, float],
    cur_pos: dict[str, float],
    course: dict[str, Any],
    gun_at_ms: int,
    tick_start_ms: int,
    tick_end_ms: int,
) -> None:
    if gun_at_ms <= 0:
        return
    start_a = course.get("startA") or {"x": 0.0, "y": 0.0}
    start_b = course.get("startB") or {"x": 1.0, "y": 0.0}
    marks = list(course.get("marks") or [])
    crossing = classify_start_line_crossing(prev_pos, cur_pos, start_a, start_b, marks)
    if crossing != "to_course":
        return
    event_time_ms = start_line_crossing_time_ms(prev_pos, cur_pos, start_a, start_b, marks, tick_start_ms, tick_end_ms)
    delta_ms = int(event_time_ms - gun_at_ms)
    if delta_ms < 0:
        if delta_ms >= -3000 and boat.get("falseStartDeltaMs") is None:
            boat["falseStartDeltaMs"] = delta_ms
        return
    if boat.get("startDeltaMs") is None:
        boat["startDeltaMs"] = delta_ms


def boat_speed_coeff(boat: dict[str, Any]) -> float:
    return clamp(float(boat.get("speedCoeff") or 1.0), 0.5, 1.8)


def tack_sign_from_heading_vec(heading_vec: dict[str, float], wind_angle_deg: float) -> int:
    upwind = upwind_vec(wind_angle_deg)
    cross = upwind["x"] * heading_vec["y"] - upwind["y"] * heading_vec["x"]
    if abs(cross) < 1e-9:
        return 0
    return 1 if cross > 0 else -1


def would_change_tack(boat: dict[str, Any], heading_vec: dict[str, float], wind_angle_deg: float) -> bool:
    if not boat.get("hasHeading"):
        return False
    new_tack = tack_sign_from_heading_vec(heading_vec, wind_angle_deg)
    if boat.get("tack", 0) == 0 or new_tack == 0:
        return False
    return new_tack != boat.get("tack")


def move_factor_for_boat(boat: dict[str, Any], heading_vec: dict[str, float], settings: dict[str, Any], gust_rect: dict[str, float] | None) -> float:
    factor = boat_speed_coeff(boat)
    if point_in_gust({"x": boat["x"], "y": boat["y"]}, gust_rect):
        factor *= 2.0
    tack_penalty = float(settings.get("tackPenaltyFactor") or 1.0)
    wind_angle_deg = float(settings.get("windAngleDeg") or 0.0)
    if tack_penalty < 1.0 and would_change_tack(boat, heading_vec, wind_angle_deg):
        factor *= tack_penalty
    return factor


def normalize_interaction_mode(raw_mode: Any) -> str:
    if raw_mode in {"ghost", "rules"}:
        return str(raw_mode)
    return "contact"


def boats_physical_collisions_enabled(settings: dict[str, Any]) -> bool:
    return normalize_interaction_mode(settings.get("interactionMode")) == "contact"


def rules_mode_enabled(settings: dict[str, Any]) -> bool:
    return normalize_interaction_mode(settings.get("interactionMode")) == "rules"


def realtime_penalty_factor(boat: dict[str, Any], now_ms: int) -> float:
    penalty_slow_until = int(boat.get("penaltySlowUntil") or 0)
    return RULES_PENALTY_SPEED_FACTOR if penalty_slow_until > now_ms else 1.0


def heading_vector_from_state(state: dict[str, Any]) -> dict[str, float]:
    direction = state.get("direction")
    if isinstance(direction, dict):
        x = float(direction.get("x") or 0.0)
        y = float(direction.get("y") or 0.0)
        if math.hypot(x, y) > 1e-6:
            normalized = normalize({"x": x, "y": y})
            return {"x": normalized["x"], "y": normalized["y"]}
    return boat_axis_unit(float(state.get("heading") or 0.0), bool(state.get("hasHeading")))


def boat_encounter_state(index: int, boat: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    pos = overrides.get("pos") or {"x": float(boat.get("x") or 0.0), "y": float(boat.get("y") or 0.0)}
    prev = overrides.get("prev") or {"x": pos["x"], "y": pos["y"]}
    heading = float(overrides.get("heading") if overrides.get("heading") is not None else boat.get("heading") or 0.0)
    has_heading = bool(overrides.get("hasHeading") if overrides.get("hasHeading") is not None else boat.get("hasHeading"))
    direction = overrides.get("direction") or boat_axis_unit(heading, has_heading)
    signed_speed_units_per_sec = float(
        overrides.get("signedSpeedUnitsPerSec")
        if overrides.get("signedSpeedUnitsPerSec") is not None
        else boat.get("currentSpeedUnitsPerSec") or 0.0
    )
    tack = int(
        overrides.get("tack")
        if overrides.get("tack") is not None
        else boat.get("tack") if boat.get("tack") is not None else 0
    )
    return {
        "index": index,
        "boat": boat,
        "pos": pos,
        "prev": prev,
        "heading": heading,
        "hasHeading": has_heading,
        "direction": direction,
        "tack": tack,
        "nextMark": int(overrides.get("nextMark") if overrides.get("nextMark") is not None else boat.get("nextMark") or 0),
        "finished": bool(overrides.get("finished") if overrides.get("finished") is not None else boat.get("finished")),
        "signedSpeedUnitsPerSec": signed_speed_units_per_sec,
        "reverse": signed_speed_units_per_sec < -1e-6,
    }


def pair_reference_axis(left_state: dict[str, Any], right_state: dict[str, Any]) -> dict[str, float]:
    left_dir = heading_vector_from_state(left_state)
    right_dir = heading_vector_from_state(right_state)
    axis = {"x": left_dir["x"] + right_dir["x"], "y": left_dir["y"] + right_dir["y"]}
    if math.hypot(axis["x"], axis["y"]) < 1e-6:
        axis = {"x": left_dir["x"], "y": left_dir["y"]}
    if math.hypot(axis["x"], axis["y"]) < 1e-6:
        axis = {"x": right_dir["x"], "y": right_dir["y"]}
    if math.hypot(axis["x"], axis["y"]) < 1e-6:
        axis = {
            "x": float(right_state["pos"]["x"]) - float(left_state["pos"]["x"]),
            "y": float(right_state["pos"]["y"]) - float(left_state["pos"]["y"]),
        }
    if math.hypot(axis["x"], axis["y"]) < 1e-6:
        axis = {"x": 1.0, "y": 0.0}
    normalized = normalize(axis)
    return {"x": normalized["x"], "y": normalized["y"]}


def pair_longitudinal_info(left_state: dict[str, Any], right_state: dict[str, Any]) -> dict[str, Any]:
    axis = pair_reference_axis(left_state, right_state)
    left_center = dot(left_state["pos"], axis)
    right_center = dot(right_state["pos"], axis)
    left_range = {"min": left_center - BOAT_LENGTH_HALF, "max": left_center + BOAT_LENGTH_HALF}
    right_range = {"min": right_center - BOAT_LENGTH_HALF, "max": right_center + BOAT_LENGTH_HALF}
    left_clear_astern = left_range["max"] < right_range["min"] - RULES_OVERLAP_EPS
    right_clear_astern = right_range["max"] < left_range["min"] - RULES_OVERLAP_EPS
    return {
        "axis": axis,
        "leftRange": left_range,
        "rightRange": right_range,
        "linked": not left_clear_astern and not right_clear_astern,
        "leftClearAstern": left_clear_astern,
        "rightClearAstern": right_clear_astern,
    }


def pair_leeward_info(left_state: dict[str, Any], right_state: dict[str, Any], wind_angle_deg: float) -> dict[str, Any]:
    downwind = downwind_vec(wind_angle_deg)
    left_proj = dot(left_state["pos"], downwind)
    right_proj = dot(right_state["pos"], downwind)
    if abs(left_proj - right_proj) <= RULES_LEEWAY_EPS:
        return {"leewardIndex": None, "windwardIndex": None}
    if left_proj > right_proj:
        return {"leewardIndex": left_state["index"], "windwardIndex": right_state["index"]}
    return {"leewardIndex": right_state["index"], "windwardIndex": left_state["index"]}


def pair_mark_room_info(left_state: dict[str, Any], right_state: dict[str, Any], marks: list[dict[str, float]], mark_count: int) -> dict[str, Any] | None:
    if left_state["finished"] or right_state["finished"]:
        return None
    if left_state["nextMark"] != right_state["nextMark"]:
        return None
    if left_state["nextMark"] < 0 or left_state["nextMark"] >= mark_count:
        return None
    if left_state["nextMark"] >= len(marks):
        return None

    mark = marks[left_state["nextMark"]]
    left_dist = dist(left_state["pos"], mark)
    right_dist = dist(right_state["pos"], mark)
    in_zone = left_dist <= ROUND_PASS_RADIUS + RULES_MARK_ROOM_EPS or right_dist <= ROUND_PASS_RADIUS + RULES_MARK_ROOM_EPS
    if not in_zone:
        return None

    longitudinal = pair_longitudinal_info(left_state, right_state)
    if longitudinal["linked"] and abs(left_dist - right_dist) > RULES_MARK_ROOM_EPS:
        inner = left_state if left_dist < right_dist else right_state
        outer = right_state if inner["index"] == left_state["index"] else left_state
        return {
            "giveWayIndex": outer["index"],
            "rightOfWayIndex": inner["index"],
            "reason": "наружная лодка не дала место у знака",
        }

    if not longitudinal["linked"]:
        if longitudinal["leftClearAstern"]:
            return {
                "giveWayIndex": left_state["index"],
                "rightOfWayIndex": right_state["index"],
                "reason": "чисто позади не уступила у знака",
            }
        if longitudinal["rightClearAstern"]:
            return {
                "giveWayIndex": right_state["index"],
                "rightOfWayIndex": left_state["index"],
                "reason": "чисто позади не уступила у знака",
            }
    return None


def evaluate_right_of_way_for_pair(
    left_state: dict[str, Any],
    right_state: dict[str, Any],
    wind_angle_deg: float,
    marks: list[dict[str, float]],
    mark_count: int,
) -> dict[str, Any] | None:
    if left_state["reverse"] != right_state["reverse"]:
        give_way = left_state if left_state["reverse"] else right_state
        right_of_way = right_state if give_way["index"] == left_state["index"] else left_state
        return {
            "giveWayIndex": give_way["index"],
            "rightOfWayIndex": right_of_way["index"],
            "reason": "лодка на заднем ходу должна сторониться",
        }

    mark_room = pair_mark_room_info(left_state, right_state, marks, mark_count)
    if mark_room:
        return mark_room

    if left_state["tack"] != 0 and right_state["tack"] != 0 and left_state["tack"] != right_state["tack"]:
        port_boat = left_state if left_state["tack"] < 0 else right_state
        starboard_boat = right_state if port_boat["index"] == left_state["index"] else left_state
        return {
            "giveWayIndex": port_boat["index"],
            "rightOfWayIndex": starboard_boat["index"],
            "reason": "левый галс уступает правому",
        }

    if left_state["tack"] != 0 and left_state["tack"] == right_state["tack"]:
        longitudinal = pair_longitudinal_info(left_state, right_state)
        if longitudinal["linked"]:
            leeward = pair_leeward_info(left_state, right_state, wind_angle_deg)
            if leeward["windwardIndex"] is not None:
                return {
                    "giveWayIndex": leeward["windwardIndex"],
                    "rightOfWayIndex": leeward["leewardIndex"],
                    "reason": "наветренная лодка не уступила подветренной",
                }
        if longitudinal["leftClearAstern"]:
            return {
                "giveWayIndex": left_state["index"],
                "rightOfWayIndex": right_state["index"],
                "reason": "чисто позади не уступила чисто впереди",
            }
        if longitudinal["rightClearAstern"]:
            return {
                "giveWayIndex": right_state["index"],
                "rightOfWayIndex": left_state["index"],
                "reason": "чисто позади не уступила чисто впереди",
            }

    return None


def pair_motion_incident(left_state: dict[str, Any], right_state: dict[str, Any]) -> dict[str, bool]:
    left_capsule = boat_capsule_at(left_state["pos"], left_state["heading"], left_state["hasHeading"])
    right_capsule = boat_capsule_at(right_state["pos"], right_state["heading"], right_state["hasHeading"])
    hull_contact = capsules_overlap(left_capsule, right_capsule, BOAT_CLEARANCE_MARGIN)
    sweep_distance = segment_segment_distance(left_state["prev"], left_state["pos"], right_state["prev"], right_state["pos"])
    sweep_contact = sweep_distance < (BOAT_SWEEP_RADIUS * 2 + BOAT_CLEARANCE_MARGIN - 1e-9)
    return {
        "incident": hull_contact or sweep_contact,
        "collision": hull_contact or sweep_distance < (BOAT_SWEEP_RADIUS * 2 - 1e-9),
    }


def apply_boat_rule_penalty(
    boat: dict[str, Any],
    other_index: int,
    reason: str,
    now_ms: int,
    *,
    collision: bool = False,
) -> bool:
    penalty_key = f"{other_index}:{reason}"
    last_at = int(boat.get("lastPenaltyAt") or 0)
    if boat.get("lastPenaltyKey") == penalty_key and now_ms - last_at < RULES_PENALTY_COOLDOWN_MS:
        return False

    boat["penalties"] = int(boat.get("penalties") or 0) + 1
    if collision:
        boat["collisions"] = int(boat.get("collisions") or 0) + 1
    boat["lastPenaltyAt"] = now_ms
    boat["lastPenaltyKey"] = penalty_key
    boat["lastPenaltyReason"] = reason
    boat["penaltySlowUntil"] = max(int(boat.get("penaltySlowUntil") or 0), now_ms + RULES_PENALTY_SLOW_MS)
    return True


def apply_realtime_rules_penalties(
    boats: list[dict[str, Any]],
    proposals: list[dict[str, Any]],
    settings: dict[str, Any],
    marks: list[dict[str, float]],
    mark_count: int,
    invalid: set[int],
    now_ms: int,
) -> bool:
    if not rules_mode_enabled(settings):
        return False

    encounter_states = [
        boat_encounter_state(
            index,
            boat,
            pos=proposal["dest"] if proposal.get("accepted") and index not in invalid else {"x": float(boat["x"]), "y": float(boat["y"])},
            prev=proposal.get("prev") or {"x": float(boat["x"]), "y": float(boat["y"])},
            heading=proposal["heading"] if proposal.get("accepted") and index not in invalid else float(boat.get("heading") or 0.0),
            hasHeading=proposal["hasHeading"] if proposal.get("accepted") and index not in invalid else bool(boat.get("hasHeading")),
            direction=proposal["direction"] if proposal.get("accepted") and index not in invalid and proposal.get("direction") else boat_axis_unit(float(boat.get("heading") or 0.0), bool(boat.get("hasHeading"))),
            signedSpeedUnitsPerSec=proposal["signedSpeedUnitsPerSec"] if proposal.get("accepted") and index not in invalid else 0.0,
        )
        for index, (boat, proposal) in enumerate(zip(boats, proposals))
    ]

    changed = False
    wind_angle_deg = float(settings.get("windAngleDeg") or 0.0)
    for left in range(len(encounter_states)):
        if encounter_states[left]["finished"]:
            continue
        left_moved = bool(proposals[left].get("accepted")) and left not in invalid and float(proposals[left].get("distance") or 0.0) > 1e-5
        for right in range(left + 1, len(encounter_states)):
            if encounter_states[right]["finished"]:
                continue
            right_moved = bool(proposals[right].get("accepted")) and right not in invalid and float(proposals[right].get("distance") or 0.0) > 1e-5
            if not left_moved and not right_moved:
                continue

            incident = pair_motion_incident(encounter_states[left], encounter_states[right])
            if not incident["incident"]:
                continue

            ruling = evaluate_right_of_way_for_pair(encounter_states[left], encounter_states[right], wind_angle_deg, marks, mark_count)
            if ruling is None:
                if incident["collision"]:
                    changed = apply_boat_rule_penalty(boats[left], right, "не избежал контакта", now_ms, collision=True) or changed
                    changed = apply_boat_rule_penalty(boats[right], left, "не избежал контакта", now_ms, collision=True) or changed
                continue

            violator = int(ruling["giveWayIndex"])
            other = int(ruling["rightOfWayIndex"])
            changed = apply_boat_rule_penalty(boats[violator], other, str(ruling["reason"]), now_ms, collision=incident["collision"]) or changed

    return changed


def rounding_zone_relation(point: dict[str, float], mark_pos: dict[str, float]) -> int:
    distance = dist(point, mark_pos)
    if distance < ROUND_PASS_RADIUS - 1e-9:
        return -1
    if distance > ROUND_PASS_RADIUS + 1e-9:
        return 1
    return 0


def rounding_side_ok_at(point: dict[str, float], direction: dict[str, float], mark_pos: dict[str, float], rounding_side: str) -> bool:
    vector = {"x": mark_pos["x"] - point["x"], "y": mark_pos["y"] - point["y"]}
    cross = direction["x"] * vector["y"] - direction["y"] * vector["x"]
    if rounding_side == "port":
        return cross > 1e-9
    return cross < -1e-9


def angle_around_mark(point: dict[str, float], mark_pos: dict[str, float]) -> float:
    return math.atan2(point["y"] - mark_pos["y"], point["x"] - mark_pos["x"])


def rounding_sweep_delta(from_point: dict[str, float], to_point: dict[str, float], mark_pos: dict[str, float]) -> float:
    return angle_wrap(angle_around_mark(to_point, mark_pos) - angle_around_mark(from_point, mark_pos))


def rounding_sweep_ok(sweep: float, rounding_side: str) -> bool:
    if rounding_side == "port":
        return sweep >= ROUNDING_MIN_SWEEP - 1e-9
    return sweep <= -ROUNDING_MIN_SWEEP + 1e-9


def segment_rounding_info(prev_pos: dict[str, float], cur_pos: dict[str, float], mark_pos: dict[str, float]) -> dict[str, Any]:
    start_rel = rounding_zone_relation(prev_pos, mark_pos)
    end_rel = rounding_zone_relation(cur_pos, mark_pos)

    start_inside = start_rel < 0
    end_inside = end_rel < 0
    end_outside = end_rel > 0
    start_boundary = start_rel == 0

    seg = {"x": cur_pos["x"] - prev_pos["x"], "y": cur_pos["y"] - prev_pos["y"]}
    a = seg["x"] * seg["x"] + seg["y"] * seg["y"]

    entered_interior = start_inside or end_inside
    exit_point = None
    if a > 1e-12:
        fx = prev_pos["x"] - mark_pos["x"]
        fy = prev_pos["y"] - mark_pos["y"]
        b = 2 * (fx * seg["x"] + fy * seg["y"])
        c = fx * fx + fy * fy - ROUND_PASS_RADIUS * ROUND_PASS_RADIUS
        disc = b * b - 4 * a * c
        if disc > 1e-12:
            sqrt_disc = math.sqrt(disc)
            t1 = (-b - sqrt_disc) / (2 * a)
            t2 = (-b + sqrt_disc) / (2 * a)
            interior_start = max(0.0, t1)
            interior_end = min(1.0, t2)
            if interior_end - interior_start > 1e-6:
                entered_interior = True
                if end_outside:
                    t_exit = clamp(t2, 0.0, 1.0)
                    exit_point = {"x": prev_pos["x"] + seg["x"] * t_exit, "y": prev_pos["y"] + seg["y"] * t_exit}

    return {
        "startInside": start_inside,
        "startBoundary": start_boundary,
        "endInside": end_inside,
        "endOutside": end_outside,
        "enteredInterior": entered_interior,
        "exitPoint": exit_point,
    }


def process_rounding_runtime(boat: dict[str, Any], prev_pos: dict[str, float], cur_pos: dict[str, float], direction: dict[str, float], mark_pos: dict[str, float], rounding_side: str) -> bool:
    info = segment_rounding_info(prev_pos, cur_pos, mark_pos)
    effective_in_zone = boat.get("roundInZone", False) or info["startInside"]
    current_sweep = float(boat.get("roundSweep") or 0.0)

    if not effective_in_zone:
        if info["endInside"]:
            boat["roundInZone"] = True
            boat["roundSweep"] = 0.0
        else:
            boat["roundInZone"] = False
            boat["roundSweep"] = 0.0
        return False

    if not info["endOutside"]:
        boat["roundInZone"] = True
        boat["roundSweep"] = current_sweep + rounding_sweep_delta(prev_pos, cur_pos, mark_pos)
        return False

    exit_point = info["exitPoint"]
    if not exit_point and info["startBoundary"]:
        exit_point = prev_pos
    total_sweep = current_sweep + rounding_sweep_delta(prev_pos, exit_point, mark_pos) if exit_point else current_sweep

    boat["roundInZone"] = False
    boat["roundSweep"] = 0.0
    return bool(exit_point) and rounding_sweep_ok(total_sweep, rounding_side) and rounding_side_ok_at(exit_point, direction, mark_pos, rounding_side)


def update_boat_mark_and_finish(boat: dict[str, Any], prev_pos: dict[str, float], cur_pos: dict[str, float], direction: dict[str, float], state: dict[str, Any]) -> None:
    race = state.setdefault("race", {})
    settings = state.get("settings") or {}
    course = state.get("course") or {}
    marks = list(course.get("marks") or [])
    mark_count = int(course.get("markCount") or len(marks))
    rounding_side = "starboard" if settings.get("roundingSide") == "starboard" else "port"
    finish_separate = bool(settings.get("finishSeparate"))
    finish_a = course.get("finishA") or course.get("startA") or {"x": 0.0, "y": 0.0}
    finish_b = course.get("finishB") or course.get("startB") or {"x": 0.0, "y": 0.0}
    if not finish_separate:
        finish_a = course.get("startA") or finish_a
        finish_b = course.get("startB") or finish_b

    if int(boat.get("nextMark", 0)) < mark_count:
        mark_index = int(boat.get("nextMark", 0))
        mark_pos = marks[mark_index]
        if process_rounding_runtime(boat, prev_pos, cur_pos, direction, mark_pos, rounding_side):
            boat["nextMark"] = mark_index + 1
            boat["roundInZone"] = False
            boat["roundSweep"] = 0.0
    else:
        boat["roundInZone"] = False
        boat["roundSweep"] = 0.0

    if not boat.get("finished") and int(boat.get("nextMark", 0)) >= mark_count:
        if segments_intersect(prev_pos, cur_pos, finish_a, finish_b):
            boat["finished"] = True
            race["raceFinishedCount"] = int(race.get("raceFinishedCount") or 0) + 1
            boat["place"] = race["raceFinishedCount"]


def normalize_boat(boat: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(boat)
    normalized.setdefault("distance", 0.0)
    normalized.setdefault("turns", 0)
    normalized.setdefault("penalties", 0)
    normalized.setdefault("collisions", 0)
    normalized.setdefault("nextMark", 0)
    normalized.setdefault("finished", False)
    normalized.setdefault("place", None)
    normalized.setdefault("hasHeading", False)
    normalized.setdefault("heading", 0.0)
    normalized.setdefault("tack", 0)
    normalized.setdefault("speedCoeff", 1.0)
    normalized.setdefault("currentSpeedUnitsPerSec", 0.0)
    normalized.setdefault("penaltySlowUntil", 0)
    normalized.setdefault("lastPenaltyAt", 0)
    normalized.setdefault("lastPenaltyKey", "")
    normalized.setdefault("lastPenaltyReason", "")
    normalized.setdefault("roundInZone", False)
    normalized.setdefault("roundSweep", 0.0)
    normalized.setdefault("startDeltaMs", None)
    normalized.setdefault("falseStartDeltaMs", None)
    return normalized


def random_gust_rect(world_w: float, world_h: float) -> dict[str, float]:
    rx = clamp(world_w * (0.08 + random.random() * 0.1), 1.4, max(1.4, world_w * 0.2))
    ry = clamp(world_h * (0.06 + random.random() * 0.1), 1.2, max(1.2, world_h * 0.18))
    return {
        "cx": random.random() * max(0.0, world_w - rx * 2.0) + rx,
        "cy": random.random() * max(0.0, world_h - ry * 2.0) + ry,
        "rx": rx,
        "ry": ry,
        "angle": random.random() * math.pi,
    }


def schedule_next_auto_gust(race: dict[str, Any], settings: dict[str, Any], now_ms: int) -> None:
    interval_sec = clamp(float(settings.get("autoGustIntervalSec") or 10.0), 3.0, 60.0)
    factor = 0.6 + random.random() * 0.8
    race["nextAutoGustAt"] = int(now_ms + interval_sec * 1000.0 * factor)


def simulate_weather_tick(game_state: dict[str, Any], now_ms: int) -> bool:
    settings = game_state.setdefault("settings", {})
    race = game_state.setdefault("race", {})
    course = game_state.setdefault("course", {})
    world = game_state.get("world") or {}
    world_w = float(world.get("width") or 18.0)
    world_h = float(world.get("height") or 24.0)
    auto_enabled = bool(settings.get("autoGustsEnabled"))
    changed = False
    gust_rect = normalize_gust_zone(course.get("gustRect"), world_w, world_h)
    if course.get("gustRect") != gust_rect:
        course["gustRect"] = gust_rect
        changed = True
    gust_expires_at = int(race.get("gustExpiresAt") or 0)
    next_auto_gust_at = int(race.get("nextAutoGustAt") or 0)

    if gust_rect and gust_expires_at > 0 and now_ms >= gust_expires_at:
        course["gustRect"] = None
        race["gustExpiresAt"] = 0
        gust_rect = None
        changed = True
        if auto_enabled:
            schedule_next_auto_gust(race, settings, now_ms)

    if auto_enabled:
        if not gust_rect and next_auto_gust_at <= 0:
            schedule_next_auto_gust(race, settings, now_ms)
            changed = True
        elif not gust_rect and now_ms >= next_auto_gust_at:
            course["gustRect"] = random_gust_rect(world_w, world_h)
            duration_sec = clamp(float(settings.get("autoGustDurationSec") or 6.0), 2.0, 30.0)
            race["gustExpiresAt"] = int(now_ms + duration_sec * 1000.0)
            race["nextAutoGustAt"] = 0
            changed = True
    else:
        if next_auto_gust_at:
            race["nextAutoGustAt"] = 0
            changed = True
        if not gust_rect and gust_expires_at:
            race["gustExpiresAt"] = 0
            changed = True

    return changed


def control_direction_for_boat(control: dict[str, Any] | None, boat: dict[str, Any], world_w: float, world_h: float) -> dict[str, float] | None:
    if not isinstance(control, dict) or not control.get("active"):
        return None

    target = control.get("target")
    if isinstance(target, dict):
        x = target.get("x")
        y = target.get("y")
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            target_point = {"x": clamp(float(x), 0.0, world_w), "y": clamp(float(y), 0.0, world_h)}
            normalized = normalize({"x": target_point["x"] - float(boat["x"]), "y": target_point["y"] - float(boat["y"])})
            if normalized["length"] > REALTIME_TARGET_EPS:
                return {"x": normalized["x"], "y": normalized["y"]}

    direction = control.get("direction")
    if isinstance(direction, dict):
        dx = direction.get("x")
        dy = direction.get("y")
        if isinstance(dx, (int, float)) and isinstance(dy, (int, float)):
            normalized = normalize({"x": float(dx), "y": float(dy)})
            if normalized["length"] > 1e-6:
                return {"x": normalized["x"], "y": normalized["y"]}

    return None


def simulate_realtime_tick(game_state: dict[str, Any], controls: dict[int, dict[str, Any]], dt_seconds: float, now_ms: int) -> bool:
    settings = game_state.setdefault("settings", {})
    race = game_state.setdefault("race", {})
    course = game_state.setdefault("course", {})
    boats = [normalize_boat(boat) for boat in list(game_state.get("boats") or [])]
    game_state["boats"] = boats
    settings["interactionMode"] = normalize_interaction_mode(settings.get("interactionMode"))

    world = game_state.get("world") or {}
    world_w = float(world.get("width") or 18.0)
    world_h = float(world.get("height") or 24.0)
    wind_angle_deg = float(settings.get("windAngleDeg") or 0.0)
    dead_zone_deg = float(settings.get("deadZoneDeg") or 0.0)
    gust_rect = course.get("gustRect")
    tick_start_ms = int(now_ms - dt_seconds * 1000.0)

    changed = simulate_weather_tick(game_state, now_ms)
    phase = race.get("phase") or "race"
    countdown_ends_at = int(race.get("realtimeCountdownEndsAt") or 0)
    countdown_active = phase == "countdown" and countdown_ends_at > now_ms
    if phase == "countdown" and countdown_ends_at > 0 and now_ms >= countdown_ends_at:
        tick_start_ms = max(tick_start_ms, countdown_ends_at)
        race["phase"] = "race"
        phase = "race"
        changed = True

    if phase != "race" and not countdown_active:
        zeroed_any_speed = False
        for boat in boats:
            if float(boat.get("currentSpeedUnitsPerSec") or 0.0) != 0.0:
                boat["currentSpeedUnitsPerSec"] = 0.0
                zeroed_any_speed = True
        return changed or zeroed_any_speed

    marks = list(course.get("marks") or [])
    mark_count = int(course.get("markCount") or len(marks))
    changed = (
        resolve_realtime_overlaps(
            boats,
            marks,
            mark_count,
            settings,
            world_w=world_w,
            world_h=world_h,
            wind_angle_deg=wind_angle_deg,
        )
        or changed
    )

    proposals: list[dict[str, Any]] = []
    for index, boat in enumerate(boats):
        proposal = {
            "accepted": False,
            "prev": {"x": float(boat["x"]), "y": float(boat["y"])},
            "dest": {"x": float(boat["x"]), "y": float(boat["y"])},
            "heading": float(boat.get("heading") or 0.0),
            "hasHeading": bool(boat.get("hasHeading")),
            "direction": None,
            "motionDirection": None,
            "distance": 0.0,
            "signedSpeedUnitsPerSec": 0.0,
            "reverseMode": False,
        }
        if boat.get("finished"):
            proposals.append(proposal)
            continue

        heading_vec = control_direction_for_boat(controls.get(index), boat, world_w, world_h)
        if heading_vec is None:
            proposals.append(proposal)
            continue

        desired_heading = math.atan2(heading_vec["y"], heading_vec["x"])
        heading = steer_heading_toward(boat, desired_heading, dt_seconds, settings)
        actual_direction = {"x": math.cos(heading), "y": math.sin(heading)}

        upwind = upwind_vec(wind_angle_deg)
        angle = angle_between(actual_direction, upwind)
        half_dead = math.radians(dead_zone_deg) / 2.0
        reverse_threshold = half_dead * 0.5
        move_factor = move_factor_for_boat(boat, actual_direction, settings, gust_rect) * realtime_penalty_factor(boat, now_ms)
        reverse_mode = angle <= reverse_threshold
        speed_factor = 0.0 if reverse_mode else realtime_speed_factor_for_angle(angle, settings)
        step_length = (
            REALTIME_SPEED_UNITS_PER_SEC * dt_seconds * move_factor * 0.10
            if reverse_mode
            else REALTIME_SPEED_UNITS_PER_SEC * dt_seconds * speed_factor * move_factor
        )
        if step_length <= 1e-5:
            proposals.append(proposal)
            continue

        motion_vec = {"x": -actual_direction["x"], "y": -actual_direction["y"]} if reverse_mode else actual_direction
        dest = clamp_along_ray_to_field(
            {"x": float(boat["x"]), "y": float(boat["y"])},
            motion_vec,
            step_length,
            world_w,
            world_h,
        )
        dest = clamp_position_to_capsule_field(
            dest,
            heading,
            True,
            world_w,
            world_h,
            BOAT_CLEARANCE_MARGIN,
        )
        travel_distance = dist({"x": float(boat["x"]), "y": float(boat["y"])}, dest)
        proposal.update(
            {
                "accepted": True,
                "dest": dest,
                "heading": heading,
                "hasHeading": True,
                "direction": actual_direction,
                "motionDirection": motion_vec,
                "distance": travel_distance,
                "signedSpeedUnitsPerSec": ((-1.0 if reverse_mode else 1.0) * (travel_distance / dt_seconds)) if dt_seconds > 1e-6 else 0.0,
                "reverseMode": reverse_mode,
            }
        )
        proposals.append(proposal)

    invalid: set[int] = set()
    pressure_pairs: set[tuple[int, int]] = set()
    blocked_events: dict[int, dict[str, Any]] = {}

    for index, proposal in enumerate(proposals):
        if not proposal["accepted"]:
            continue
        boat = boats[index]
        dest = proposal["dest"]
        heading = proposal["heading"]
        has_heading = proposal["hasHeading"]
        candidate_capsule = boat_capsule_at(dest, heading, has_heading)
        if not point_in_field(dest, world_w, world_h) or not capsule_fits_within_field(
            candidate_capsule,
            world_w,
            world_h,
            BOAT_CLEARANCE_MARGIN,
        ):
            invalid.add(index)
            continue
        for mark_index in range(mark_count):
            mark = marks[mark_index]
            required_mark_distance = candidate_capsule["r"] + MARK_RADIUS + MARK_CLEARANCE_MARGIN
            mark_distance, _, _ = point_to_segment(mark, candidate_capsule["a"], candidate_capsule["b"])
            if mark_distance < required_mark_distance - 1e-9:
                blocked_events.setdefault(
                    index,
                    {
                        "kind": "mark",
                        "boat_index": index,
                        "mark_index": mark_index,
                        "mark": {"x": float(mark["x"]), "y": float(mark["y"])},
                    },
                )
                _log_mark_collision_detected(
                    boat_index=index,
                    mark_index=mark_index,
                    collision_kind="overlap",
                    prev_pos=proposal["prev"],
                    dest_pos=dest,
                    mark_pos=mark,
                    distance=mark_distance,
                    required_distance=required_mark_distance,
                    proposal_distance=float(proposal.get("distance") or 0.0),
                )
                invalid.add(index)
                break
            sweep_required_distance = MARK_RADIUS + BOAT_SWEEP_RADIUS + MARK_CLEARANCE_MARGIN
            sweep_distance = segment_distance_to_point(proposal["prev"], dest, mark)
            if sweep_distance < sweep_required_distance - 1e-9:
                blocked_events.setdefault(
                    index,
                    {
                        "kind": "mark",
                        "boat_index": index,
                        "mark_index": mark_index,
                        "mark": {"x": float(mark["x"]), "y": float(mark["y"])},
                    },
                )
                _log_mark_collision_detected(
                    boat_index=index,
                    mark_index=mark_index,
                    collision_kind="sweep",
                    prev_pos=proposal["prev"],
                    dest_pos=dest,
                    mark_pos=mark,
                    distance=sweep_distance,
                    required_distance=sweep_required_distance,
                    proposal_distance=float(proposal.get("distance") or 0.0),
                )
                invalid.add(index)
                break
        if index in invalid:
            continue
        if boats_physical_collisions_enabled(settings):
            for other_index, other_boat in enumerate(boats):
                if other_index == index:
                    continue
                other_capsule = boat_capsule_at(
                    {"x": float(other_boat["x"]), "y": float(other_boat["y"])},
                    float(other_boat.get("heading") or 0.0),
                    bool(other_boat.get("hasHeading")),
                )
                required_boat_distance = candidate_capsule["r"] + other_capsule["r"] + BOAT_CLEARANCE_MARGIN
                _, _, boat_distance = segment_segment_closest_points(
                    candidate_capsule["a"],
                    candidate_capsule["b"],
                    other_capsule["a"],
                    other_capsule["b"],
                )
                other_proposal = proposals[other_index]
                other_moving = bool(other_proposal["accepted"]) and float(other_proposal.get("distance") or 0.0) > 1e-5
                if boat_distance < required_boat_distance - 1e-9:
                    pressure_pair_added = bool(other_proposal["accepted"])
                    if pressure_pair_added:
                        pressure_pairs.add((min(index, other_index), max(index, other_index)))
                    blocked_events.setdefault(
                        index,
                        {
                            "kind": "boats",
                            "boat_index": index,
                            "other_index": other_index,
                        },
                    )
                    _log_boat_collision_detected(
                        scope="proposal_vs_current",
                        collision_kind="overlap",
                        boat_index=index,
                        other_index=other_index,
                        prev_pos=proposal["prev"],
                        dest_pos=dest,
                        other_pos={"x": float(other_boat["x"]), "y": float(other_boat["y"])},
                        distance=boat_distance,
                        required_distance=required_boat_distance,
                        proposal_distance=float(proposal.get("distance") or 0.0),
                        other_distance=float(other_proposal.get("distance") or 0.0),
                        pressure_pair_added=pressure_pair_added,
                        other_moving=other_moving,
                    )
                    invalid.add(index)
                    break
                sweep_required_distance = BOAT_SWEEP_RADIUS + other_capsule["r"] + BOAT_CLEARANCE_MARGIN
                sweep_distance = segment_segment_distance(proposal["prev"], dest, other_capsule["a"], other_capsule["b"])
                if sweep_distance < sweep_required_distance - 1e-9:
                    pressure_pair_added = bool(other_proposal["accepted"])
                    if pressure_pair_added:
                        pressure_pairs.add((min(index, other_index), max(index, other_index)))
                    blocked_events.setdefault(
                        index,
                        {
                            "kind": "boats",
                            "boat_index": index,
                            "other_index": other_index,
                        },
                    )
                    _log_boat_collision_detected(
                        scope="proposal_vs_current",
                        collision_kind="sweep",
                        boat_index=index,
                        other_index=other_index,
                        prev_pos=proposal["prev"],
                        dest_pos=dest,
                        other_pos={"x": float(other_boat["x"]), "y": float(other_boat["y"])},
                        distance=sweep_distance,
                        required_distance=sweep_required_distance,
                        proposal_distance=float(proposal.get("distance") or 0.0),
                        other_distance=float(other_proposal.get("distance") or 0.0),
                        pressure_pair_added=pressure_pair_added,
                        other_moving=other_moving,
                    )
                    invalid.add(index)
                    break

    if boats_physical_collisions_enabled(settings):
        for left in range(len(proposals)):
            left_proposal = proposals[left]
            if not left_proposal["accepted"] or left in invalid:
                continue
            left_capsule = boat_capsule_at(left_proposal["dest"], left_proposal["heading"], left_proposal["hasHeading"])
            for right in range(left + 1, len(proposals)):
                right_proposal = proposals[right]
                if not right_proposal["accepted"] or right in invalid:
                    continue
                right_capsule = boat_capsule_at(right_proposal["dest"], right_proposal["heading"], right_proposal["hasHeading"])
                required_pair_distance = left_capsule["r"] + right_capsule["r"] + BOAT_CLEARANCE_MARGIN
                _, _, pair_distance = segment_segment_closest_points(
                    left_capsule["a"],
                    left_capsule["b"],
                    right_capsule["a"],
                    right_capsule["b"],
                )
                if pair_distance < required_pair_distance - 1e-9:
                    _log_boat_collision_detected(
                        scope="proposal_pair",
                        collision_kind="overlap",
                        left_index=left,
                        right_index=right,
                        left_prev=left_proposal["prev"],
                        left_dest=left_proposal["dest"],
                        right_prev=right_proposal["prev"],
                        right_dest=right_proposal["dest"],
                        distance=pair_distance,
                        required_distance=required_pair_distance,
                        proposal_distance=float(left_proposal.get("distance") or 0.0),
                        other_distance=float(right_proposal.get("distance") or 0.0),
                        pressure_pair_added=True,
                    )
                    pressure_pairs.add((left, right))
                    invalid.add(left)
                    invalid.add(right)
                    continue
                min_center_distance = segment_segment_distance(left_proposal["prev"], left_proposal["dest"], right_proposal["prev"], right_proposal["dest"])
                sweep_required_distance = BOAT_SWEEP_RADIUS * 2 + BOAT_CLEARANCE_MARGIN
                if min_center_distance < sweep_required_distance - 1e-9:
                    _log_boat_collision_detected(
                        scope="proposal_pair",
                        collision_kind="sweep",
                        left_index=left,
                        right_index=right,
                        left_prev=left_proposal["prev"],
                        left_dest=left_proposal["dest"],
                        right_prev=right_proposal["prev"],
                        right_dest=right_proposal["dest"],
                        distance=min_center_distance,
                        required_distance=sweep_required_distance,
                        proposal_distance=float(left_proposal.get("distance") or 0.0),
                        other_distance=float(right_proposal.get("distance") or 0.0),
                        pressure_pair_added=True,
                    )
                    pressure_pairs.add((left, right))
                    invalid.add(left)
                    invalid.add(right)

    changed = apply_realtime_rules_penalties(boats, proposals, settings, marks, mark_count, invalid, now_ms) or changed

    race["raceFinishedCount"] = sum(1 for boat in boats if boat.get("finished"))
    any_unfinished = False
    for index, boat in enumerate(boats):
        proposal = proposals[index]
        prev_pos = proposal["prev"]
        boat["currentSpeedUnitsPerSec"] = 0.0
        if proposal["accepted"] and index not in invalid:
            dest = proposal["dest"]
            if abs(dest["x"] - boat["x"]) > 1e-9 or abs(dest["y"] - boat["y"]) > 1e-9:
                changed = True
                if (
                    race.get("phase") == "race"
                    and boat.get("hasHeading")
                    and abs(angle_wrap(proposal["heading"] - float(boat.get("heading") or 0.0))) > math.radians(12)
                ):
                    boat["turns"] = int(boat.get("turns") or 0) + 1
                boat["x"] = dest["x"]
                boat["y"] = dest["y"]
                if race.get("phase") == "race":
                    boat["distance"] = float(boat.get("distance") or 0.0) + proposal["distance"]
                boat["heading"] = proposal["heading"]
                boat["hasHeading"] = proposal["hasHeading"]
                boat["tack"] = tack_sign_from_heading_vec(proposal["direction"], wind_angle_deg)
                boat["currentSpeedUnitsPerSec"] = float(proposal.get("signedSpeedUnitsPerSec") or 0.0)
                record_realtime_start_crossing(boat, prev_pos, dest, course, countdown_ends_at, tick_start_ms, now_ms)
                update_boat_mark_and_finish(boat, prev_pos, dest, proposal["direction"], game_state)
        if not boat.get("finished"):
            any_unfinished = True

    changed = (
        resolve_realtime_overlaps(
            boats,
            marks,
            mark_count,
            settings,
            world_w=world_w,
            world_h=world_h,
            wind_angle_deg=wind_angle_deg,
        )
        or changed
    )
    pressure_changed = resolve_realtime_pressure_jams(
        boats,
        proposals,
        pressure_pairs,
        settings,
        world_w=world_w,
        world_h=world_h,
    )
    changed = pressure_changed or changed
    if pressure_changed:
        changed = (
            resolve_realtime_overlaps(
                boats,
                marks,
                mark_count,
                settings,
                world_w=world_w,
                world_h=world_h,
                wind_angle_deg=wind_angle_deg,
            )
            or changed
        )
    stuck_changed = resolve_realtime_stuck_motion(
        boats,
        proposals,
        list(blocked_events.values()),
        world_w=world_w,
        world_h=world_h,
    )
    changed = stuck_changed or changed
    if stuck_changed:
        changed = (
            resolve_realtime_overlaps(
                boats,
                marks,
                mark_count,
                settings,
                world_w=world_w,
                world_h=world_h,
                wind_angle_deg=wind_angle_deg,
            )
            or changed
        )

    if not any_unfinished and race.get("phase") == "race":
        changed = True
        race["phase"] = "finished"
    return changed
