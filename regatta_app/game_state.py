from __future__ import annotations

import time
from copy import deepcopy
from typing import Any


VIEW_SETTINGS_KEYS = (
    "showWindArrow",
    "showOptimal",
    "showBestStart",
    "showLaylines",
    "showTrails",
)


def state_play_mode(game_state: dict[str, Any] | None) -> str:
    if not isinstance(game_state, dict):
        return "turns"
    settings = game_state.get("settings") or {}
    return "realtime" if settings.get("playMode") in {"realtime", "hybrid"} else "turns"


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


def normalize_view_settings_payload(payload: dict[str, Any] | None) -> dict[str, bool]:
    raw_settings = (payload or {}).get("settings")
    if not isinstance(raw_settings, dict):
        return {}

    normalized: dict[str, bool] = {}
    for key in VIEW_SETTINGS_KEYS:
        if key in raw_settings:
            normalized[key] = bool(raw_settings.get(key))
    return normalized


def apply_room_view_settings(room: dict[str, Any], view_settings: dict[str, bool]) -> bool:
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

    if settings.get("playMode") in {"realtime", "hybrid"}:
        settings["playMode"] = "realtime"
        prep_seconds = max(0.0, float(settings.get("realtimePrepSeconds") or 0.0))
        race["phase"] = "countdown"
        race["realtimeCountdownEndsAt"] = (
            int(time.time() * 1000) + int(prep_seconds * 1000) if arm_realtime else 0
        )
        race["currentPlayer"] = 0
        race["subMovesLeft"] = 0
        race["raceFinishedCount"] = 0
        race["prestartRoundsLeft"] = 0
        race.pop("hybridRound", None)
        race.pop("hybridMovesLeft", None)
    else:
        race.pop("realtimeCountdownEndsAt", None)

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
    race["isLobbyPreview"] = True
    race["subMovesLeft"] = 0
    race["prestartRoundsLeft"] = 0
    race["raceFinishedCount"] = int(
        race.get("raceFinishedCount") or sum(1 for boat in boats if boat.get("finished"))
    )
    current_player = race.get("currentPlayer")
    if not isinstance(current_player, int) or not (0 <= current_player < len(boats)):
        race["currentPlayer"] = next(
            (idx for idx, boat in enumerate(boats) if not boat.get("finished")),
            0,
        )

    if settings.get("playMode") in {"hybrid"}:
        settings["playMode"] = "turns"
        race.pop("hybridRound", None)
        race.pop("hybridMovesLeft", None)

    race.setdefault("gustExpiresAt", 0)
    race.setdefault("nextAutoGustAt", 0)
    return preview_state
