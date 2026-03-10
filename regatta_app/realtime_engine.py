from __future__ import annotations

import math
import random
from copy import deepcopy
from typing import Any


MARK_RADIUS = 0.35
BOAT_RULE_LENGTH = 0.85
BOAT_FOOTPRINT_LENGTH = 1.70
BOAT_FOOTPRINT_BEAM = 0.90
BOAT_COLLISION_RADIUS = BOAT_FOOTPRINT_BEAM / 2
BOAT_CAPSULE_HALF_SEGMENT = max(0.0, (BOAT_FOOTPRINT_LENGTH - BOAT_FOOTPRINT_BEAM) / 2)
BOAT_SWEEP_RADIUS = BOAT_CAPSULE_HALF_SEGMENT + BOAT_COLLISION_RADIUS
BOAT_CLEARANCE_MARGIN = 0.25
MARK_CLEARANCE_MARGIN = 0.25
ROUND_PASS_RADIUS = BOAT_RULE_LENGTH * 3
ROUNDING_MIN_SWEEP = math.pi / 3

REALTIME_SPEED_UNITS_PER_SEC = 2.4
REALTIME_DEADZONE_SOFTNESS_DEG = 18.0
REALTIME_TARGET_EPS = 0.04


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def dist(left: dict[str, float], right: dict[str, float]) -> float:
    return math.hypot(left["x"] - right["x"], left["y"] - right["y"])


def dot(left: dict[str, float], right: dict[str, float]) -> float:
    return left["x"] * right["x"] + left["y"] * right["y"]


def normalize(vec: dict[str, float]) -> dict[str, float]:
    length = math.hypot(vec["x"], vec["y"]) or 1.0
    return {"x": vec["x"] / length, "y": vec["y"] / length, "length": length}


def angle_wrap(angle: float) -> float:
    while angle > math.pi:
        angle -= 2 * math.pi
    while angle < -math.pi:
        angle += 2 * math.pi
    return angle


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


def segment_segment_distance(a0: dict[str, float], a1: dict[str, float], b0: dict[str, float], b1: dict[str, float]) -> float:
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
    return math.hypot(dx, dy)


def capsules_overlap(left: dict[str, Any], right: dict[str, Any], extra: float = 0.0) -> bool:
    return segment_segment_distance(left["a"], left["b"], right["a"], right["b"]) < (left["r"] + right["r"] + extra - 1e-9)


def capsule_intersects_mark(capsule: dict[str, Any], mark_pos: dict[str, float], extra: float = 0.0) -> bool:
    return point_to_segment(mark_pos, capsule["a"], capsule["b"])[0] < (capsule["r"] + MARK_RADIUS + extra - 1e-9)


def downwind_vec(wind_angle_deg: float) -> dict[str, float]:
    t = wind_angle_deg * math.pi / 180.0
    return {"x": math.sin(t), "y": -math.cos(t)}


def upwind_vec(wind_angle_deg: float) -> dict[str, float]:
    downwind = downwind_vec(wind_angle_deg)
    return {"x": -downwind["x"], "y": -downwind["y"]}


def angle_between(left: dict[str, float], right: dict[str, float]) -> float:
    dl = math.hypot(left["x"], left["y"]) or 1.0
    dr = math.hypot(right["x"], right["y"]) or 1.0
    cosine = (left["x"] / dl) * (right["x"] / dr) + (left["y"] / dl) * (right["y"] / dr)
    return math.acos(clamp(cosine, -1.0, 1.0))


def point_in_field(point: dict[str, float], world_w: float, world_h: float) -> bool:
    return 0.0 <= point["x"] <= world_w and 0.0 <= point["y"] <= world_h


def point_in_gust(point: dict[str, float], gust_rect: dict[str, float] | None) -> bool:
    if not gust_rect:
        return False
    return (
        gust_rect["x"] <= point["x"] <= gust_rect["x"] + gust_rect["w"]
        and gust_rect["y"] <= point["y"] <= gust_rect["y"] + gust_rect["h"]
    )


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
    normalized.setdefault("nextMark", 0)
    normalized.setdefault("finished", False)
    normalized.setdefault("place", None)
    normalized.setdefault("hasHeading", False)
    normalized.setdefault("heading", 0.0)
    normalized.setdefault("tack", 0)
    normalized.setdefault("speedCoeff", 1.0)
    normalized.setdefault("roundInZone", False)
    normalized.setdefault("roundSweep", 0.0)
    return normalized


def random_gust_rect(world_w: float, world_h: float) -> dict[str, float]:
    width = clamp(world_w * (0.16 + random.random() * 0.12), 2.4, max(2.4, world_w * 0.35))
    height = clamp(world_h * (0.14 + random.random() * 0.12), 2.2, max(2.2, world_h * 0.32))
    return {
        "x": random.random() * max(0.0, world_w - width),
        "y": random.random() * max(0.0, world_h - height),
        "w": width,
        "h": height,
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
    gust_rect = course.get("gustRect")
    gust_expires_at = int(race.get("gustExpiresAt") or 0)
    next_auto_gust_at = int(race.get("nextAutoGustAt") or 0)
    changed = False

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


def control_target_for_boat(control: dict[str, Any] | None, world_w: float, world_h: float) -> dict[str, float] | None:
    if not isinstance(control, dict) or not control.get("active"):
        return None
    target = control.get("target")
    if not isinstance(target, dict):
        return None
    x = target.get("x")
    y = target.get("y")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    return {"x": clamp(float(x), 0.0, world_w), "y": clamp(float(y), 0.0, world_h)}


def simulate_realtime_tick(game_state: dict[str, Any], controls: dict[int, dict[str, Any]], dt_seconds: float, now_ms: int) -> bool:
    settings = game_state.setdefault("settings", {})
    race = game_state.setdefault("race", {})
    course = game_state.setdefault("course", {})
    boats = [normalize_boat(boat) for boat in list(game_state.get("boats") or [])]
    game_state["boats"] = boats

    world = game_state.get("world") or {}
    world_w = float(world.get("width") or 18.0)
    world_h = float(world.get("height") or 24.0)
    wind_angle_deg = float(settings.get("windAngleDeg") or 0.0)
    dead_zone_deg = float(settings.get("deadZoneDeg") or 0.0)
    gust_rect = course.get("gustRect")

    changed = simulate_weather_tick(game_state, now_ms)
    phase = race.get("phase") or "race"
    countdown_ends_at = int(race.get("realtimeCountdownEndsAt") or 0)
    if phase == "countdown" and countdown_ends_at > 0 and now_ms >= countdown_ends_at:
        race["phase"] = "race"
        phase = "race"
        changed = True

    if phase != "race":
        return changed

    proposals: list[dict[str, Any]] = []
    for index, boat in enumerate(boats):
        proposal = {
            "accepted": False,
            "prev": {"x": float(boat["x"]), "y": float(boat["y"])},
            "dest": {"x": float(boat["x"]), "y": float(boat["y"])},
            "heading": float(boat.get("heading") or 0.0),
            "hasHeading": bool(boat.get("hasHeading")),
            "direction": None,
            "distance": 0.0,
        }
        if boat.get("finished"):
            proposals.append(proposal)
            continue

        target = control_target_for_boat(controls.get(index), world_w, world_h)
        if target is None:
            proposals.append(proposal)
            continue

        to_target = {"x": target["x"] - boat["x"], "y": target["y"] - boat["y"]}
        normalized = normalize(to_target)
        if normalized["length"] <= REALTIME_TARGET_EPS:
            proposals.append(proposal)
            continue

        upwind = upwind_vec(wind_angle_deg)
        angle = angle_between({"x": normalized["x"], "y": normalized["y"]}, upwind)
        half_dead = math.radians(dead_zone_deg) / 2.0
        softness = math.radians(max(2.0, REALTIME_DEADZONE_SOFTNESS_DEG))
        speed_factor = clamp((angle - half_dead) / softness, 0.0, 1.0)
        if speed_factor <= 1e-4:
            proposals.append(proposal)
            continue

        heading_vec = {"x": normalized["x"], "y": normalized["y"]}
        heading = math.atan2(heading_vec["y"], heading_vec["x"])
        move_factor = move_factor_for_boat(boat, heading_vec, settings, gust_rect)
        step_length = min(
            normalized["length"],
            REALTIME_SPEED_UNITS_PER_SEC * dt_seconds * speed_factor * move_factor,
        )
        if step_length <= 1e-5:
            proposals.append(proposal)
            continue

        dest = {
            "x": boat["x"] + heading_vec["x"] * step_length,
            "y": boat["y"] + heading_vec["y"] * step_length,
        }
        proposal.update(
            {
                "accepted": True,
                "dest": dest,
                "heading": heading,
                "hasHeading": True,
                "direction": heading_vec,
                "distance": step_length,
            }
        )
        proposals.append(proposal)

    invalid: set[int] = set()
    marks = list(course.get("marks") or [])
    mark_count = int(course.get("markCount") or len(marks))

    for index, proposal in enumerate(proposals):
        if not proposal["accepted"]:
            continue
        boat = boats[index]
        dest = proposal["dest"]
        heading = proposal["heading"]
        has_heading = proposal["hasHeading"]
        candidate_capsule = boat_capsule_at(dest, heading, has_heading)
        if not point_in_field(dest, world_w, world_h):
            invalid.add(index)
            continue
        for mark_index in range(mark_count):
            if capsule_intersects_mark(candidate_capsule, marks[mark_index], MARK_CLEARANCE_MARGIN):
                invalid.add(index)
                break
            if segment_distance_to_point(proposal["prev"], dest, marks[mark_index]) < (MARK_RADIUS + BOAT_SWEEP_RADIUS + MARK_CLEARANCE_MARGIN - 1e-9):
                invalid.add(index)
                break
        if index in invalid:
            continue
        for other_index, other_boat in enumerate(boats):
            if other_index == index:
                continue
            other_capsule = boat_capsule_at(
                {"x": float(other_boat["x"]), "y": float(other_boat["y"])},
                float(other_boat.get("heading") or 0.0),
                bool(other_boat.get("hasHeading")),
            )
            if capsules_overlap(candidate_capsule, other_capsule, BOAT_CLEARANCE_MARGIN):
                invalid.add(index)
                break
            if segment_segment_distance(proposal["prev"], dest, other_capsule["a"], other_capsule["b"]) < (BOAT_SWEEP_RADIUS + other_capsule["r"] + BOAT_CLEARANCE_MARGIN - 1e-9):
                invalid.add(index)
                break

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
            if capsules_overlap(left_capsule, right_capsule, BOAT_CLEARANCE_MARGIN):
                invalid.add(left)
                invalid.add(right)
                continue
            min_center_distance = segment_segment_distance(left_proposal["prev"], left_proposal["dest"], right_proposal["prev"], right_proposal["dest"])
            if min_center_distance < (BOAT_SWEEP_RADIUS * 2 + BOAT_CLEARANCE_MARGIN - 1e-9):
                invalid.add(left)
                invalid.add(right)

    race["raceFinishedCount"] = sum(1 for boat in boats if boat.get("finished"))
    any_unfinished = False
    for index, boat in enumerate(boats):
        proposal = proposals[index]
        prev_pos = proposal["prev"]
        if proposal["accepted"] and index not in invalid:
            dest = proposal["dest"]
            if abs(dest["x"] - boat["x"]) > 1e-9 or abs(dest["y"] - boat["y"]) > 1e-9:
                changed = True
                if boat.get("hasHeading") and abs(angle_wrap(proposal["heading"] - float(boat.get("heading") or 0.0))) > math.radians(12):
                    boat["turns"] = int(boat.get("turns") or 0) + 1
                boat["x"] = dest["x"]
                boat["y"] = dest["y"]
                boat["distance"] = float(boat.get("distance") or 0.0) + proposal["distance"]
                boat["heading"] = proposal["heading"]
                boat["hasHeading"] = proposal["hasHeading"]
                boat["tack"] = tack_sign_from_heading_vec(proposal["direction"], wind_angle_deg)
                update_boat_mark_and_finish(boat, prev_pos, dest, proposal["direction"], game_state)
        if not boat.get("finished"):
            any_unfinished = True

    race["currentPlayer"] = next((idx for idx, boat in enumerate(boats) if not boat.get("finished")), 0)
    race["subMovesLeft"] = 0
    if not any_unfinished and race.get("phase") == "race":
        changed = True
        race["phase"] = "finished"
    return changed
