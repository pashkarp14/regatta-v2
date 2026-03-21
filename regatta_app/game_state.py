from __future__ import annotations

import time
from copy import deepcopy
from typing import Any


VIEW_SETTINGS_BOOLEAN_KEYS = (
    "showWindArrow",
    "showOptimal",
    "showBestStart",
    "showLaylines",
    "showTrails",
)

VIEW_SETTINGS_TARGET_KEYS = (
    "optimalBoatIndex",
    "bestStartBoatIndex",
)

VIEW_SETTINGS_KEYS = VIEW_SETTINGS_BOOLEAN_KEYS + VIEW_SETTINGS_TARGET_KEYS


def state_play_mode(game_state: dict[str, Any] | None) -> str:
    return "realtime"


def state_auto_gusts_enabled(game_state: dict[str, Any] | None) -> bool:
    if not isinstance(game_state, dict):
        return False
    settings = game_state.get("settings") or {}
    return bool(settings.get("autoGustsEnabled"))


def room_requires_live_loop(room: dict[str, Any] | None) -> bool:
    if not isinstance(room, dict) or room.get("status") != "live":
        return False
    game_state = room.get("game_state")
    return state_play_mode(game_state) == "realtime" or state_auto_gusts_enabled(game_state)


def _normalize_view_target_index(raw_value: Any) -> int | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, bool):
        return None
    if isinstance(raw_value, int):
        return max(0, raw_value)
    if isinstance(raw_value, float):
        if not raw_value.is_integer():
            return None
        return max(0, int(raw_value))
    if isinstance(raw_value, str):
        cleaned = raw_value.strip()
        if not cleaned:
            return None
        try:
            return max(0, int(cleaned))
        except ValueError:
            return None
    return None


def normalize_view_settings_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    raw_settings = (payload or {}).get("settings")
    if not isinstance(raw_settings, dict):
        return {}

    normalized: dict[str, Any] = {}
    for key in VIEW_SETTINGS_BOOLEAN_KEYS:
        if key in raw_settings:
            normalized[key] = bool(raw_settings.get(key))
    for key in VIEW_SETTINGS_TARGET_KEYS:
        if key in raw_settings:
            normalized[key] = _normalize_view_target_index(raw_settings.get(key))
    return normalized


def apply_room_view_settings(room: dict[str, Any], view_settings: dict[str, Any]) -> bool:
    changed = False
    for state_key in ("start_state", "game_state"):
        game_state = room.get(state_key)
        if not isinstance(game_state, dict):
            continue
        settings = game_state.setdefault("settings", {})
        for key, value in view_settings.items():
            if settings.get(key) != value:
                settings[key] = value
                changed = True
    return changed


def _shift_future_timestamp(container: dict[str, Any], key: str, delta_ms: int) -> bool:
    raw_value = int(container.get(key) or 0)
    if raw_value <= 0 or delta_ms <= 0:
        return False
    container[key] = raw_value + delta_ms
    return True


def shift_realtime_state_timers(game_state: dict[str, Any], delta_ms: int) -> bool:
    if delta_ms <= 0:
        return False

    changed = False
    race = game_state.setdefault("race", {})
    changed = _shift_future_timestamp(race, "realtimeCountdownEndsAt", delta_ms) or changed
    changed = _shift_future_timestamp(race, "gustExpiresAt", delta_ms) or changed
    changed = _shift_future_timestamp(race, "nextAutoGustAt", delta_ms) or changed

    for boat in list(game_state.get("boats") or []):
        if not isinstance(boat, dict):
            continue
        changed = _shift_future_timestamp(boat, "penaltySlowUntil", delta_ms) or changed
        changed = _shift_future_timestamp(boat, "lastPenaltyAt", delta_ms) or changed

    return changed


def apply_realtime_pause(game_state: dict[str, Any], *, paused: bool, now_ms: int) -> bool:
    race = game_state.setdefault("race", {})
    phase = race.get("phase") or "race"
    if phase not in {"countdown", "race"}:
        return False

    currently_paused = bool(race.get("realtimePaused"))
    pause_started_at = int(race.get("realtimePauseStartedAt") or 0)
    boats = list(game_state.get("boats") or [])
    changed = False

    if paused:
        if currently_paused:
            return False
        race["realtimePaused"] = True
        race["realtimePauseStartedAt"] = now_ms
        changed = True
        for boat in boats:
            if not isinstance(boat, dict):
                continue
            if float(boat.get("currentSpeedUnitsPerSec") or 0.0) != 0.0:
                boat["currentSpeedUnitsPerSec"] = 0.0
                changed = True
        return changed

    if not currently_paused:
        return False

    changed = shift_realtime_state_timers(game_state, max(0, now_ms - pause_started_at)) or changed
    if race.get("realtimePaused") or race.get("realtimePauseStartedAt"):
        race["realtimePaused"] = False
        race["realtimePauseStartedAt"] = 0
        changed = True
    return changed


def _normalize_interaction_mode(raw_mode: Any) -> str:
    return str(raw_mode) if raw_mode in {"ghost", "rules"} else "contact"


def _prepare_boat_runtime_state(
    boat: dict[str, Any],
    *,
    reset_penalties: bool,
    reset_rounding: bool,
    round_sweep_default: float,
) -> None:
    boat.setdefault("distance", 0)
    boat.setdefault("turns", 0)
    if reset_penalties:
        boat["penalties"] = 0
        boat["collisions"] = 0
    else:
        boat.setdefault("penalties", 0)
        boat.setdefault("collisions", 0)

    boat.setdefault("nextMark", 0)
    boat.setdefault("finished", False)
    boat.setdefault("place", None)
    boat.setdefault("hasHeading", False)
    boat.setdefault("heading", 0)
    boat.setdefault("tack", 0)
    boat.setdefault("speedCoeff", 1.0)
    boat["currentSpeedUnitsPerSec"] = 0.0
    boat["penaltySlowUntil"] = 0
    boat["lastPenaltyAt"] = 0
    boat["lastPenaltyKey"] = ""
    boat["lastPenaltyReason"] = ""

    if reset_rounding:
        boat["roundInZone"] = False
        boat["roundSweep"] = round_sweep_default
    else:
        boat.setdefault("roundInZone", False)
        boat.setdefault("roundSweep", round_sweep_default)

    boat["startDeltaMs"] = None
    boat["falseStartDeltaMs"] = None


def normalize_room_start_state(game_state: dict[str, Any], *, arm_realtime: bool = True) -> dict[str, Any]:
    settings = game_state.setdefault("settings", {})
    race = game_state.setdefault("race", {})
    boats = list(game_state.get("boats") or [])

    settings["playMode"] = "realtime"
    settings.setdefault("realtimePrepSeconds", 18)
    settings.setdefault("turnRateDegPerSec", 120)
    settings["interactionMode"] = _normalize_interaction_mode(settings.get("interactionMode"))

    for boat in boats:
        _prepare_boat_runtime_state(
            boat,
            reset_penalties=True,
            reset_rounding=True,
            round_sweep_default=0,
        )

    prep_seconds = max(0.0, float(settings.get("realtimePrepSeconds") or 0.0))
    race["phase"] = "countdown"
    race["realtimeCountdownEndsAt"] = (
        int(time.time() * 1000) + int(prep_seconds * 1000) if arm_realtime else 0
    )
    race["raceFinishedCount"] = 0
    race.pop("currentPlayer", None)
    race.pop("subMovesLeft", None)
    race.pop("prestartRoundsLeft", None)
    race.pop("hybridRound", None)
    race.pop("hybridMovesLeft", None)
    race["realtimePaused"] = False
    race["realtimePauseStartedAt"] = 0
    race["isLobbyPreview"] = False
    race.setdefault("gustExpiresAt", 0)
    race.setdefault("nextAutoGustAt", 0)
    return game_state


def normalize_lobby_preview_state(game_state: Any) -> dict[str, Any]:
    if not isinstance(game_state, dict):
        raise TypeError("Game state must be a JSON object.")

    preview_state = deepcopy(game_state)
    settings = preview_state.setdefault("settings", {})
    race = preview_state.setdefault("race", {})
    boats = list(preview_state.get("boats") or [])
    preview_state["boats"] = boats
    settings["playMode"] = "realtime"

    for boat in boats:
        if not isinstance(boat, dict):
            continue
        _prepare_boat_runtime_state(
            boat,
            reset_penalties=False,
            reset_rounding=False,
            round_sweep_default=0.0,
        )

    race["phase"] = "race"
    race["realtimeCountdownEndsAt"] = 0
    race["realtimePaused"] = False
    race["realtimePauseStartedAt"] = 0
    race["isLobbyPreview"] = True
    race["raceFinishedCount"] = int(
        race.get("raceFinishedCount") or sum(1 for boat in boats if boat.get("finished"))
    )
    race.pop("currentPlayer", None)
    race.pop("subMovesLeft", None)
    race.pop("prestartRoundsLeft", None)
    race.pop("hybridRound", None)
    race.pop("hybridMovesLeft", None)

    race.setdefault("gustExpiresAt", 0)
    race.setdefault("nextAutoGustAt", 0)
    return preview_state
