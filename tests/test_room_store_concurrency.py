from __future__ import annotations

import concurrent.futures as cf
import threading
import time

from regatta_app.locked_room_store import LockedRoomStore
from regatta_app.room_store import room_joined_racer_count


def make_realtime_state(boat_count: int = 20) -> dict:
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
            "phase": "race",
            "raceFinishedCount": 0,
            "realtimeCountdownEndsAt": 0,
            "realtimePaused": False,
            "realtimePauseStartedAt": 0,
            "gustExpiresAt": 0,
            "nextAutoGustAt": 0,
        },
        "boats": boats,
    }


class SlowLockedRoomStore(LockedRoomStore):
    def save_room(self, room):
        time.sleep(0.01)
        return super().save_room(room)


def test_concurrent_join_room_preserves_full_roster():
    store = SlowLockedRoomStore(redis_client=None, ttl_seconds=3600)
    room, _ = store.create_room("Host", 20, make_realtime_state(20))
    room_code = room["code"]
    starter = threading.Event()

    def worker(index: int) -> None:
        starter.wait(timeout=2)
        store.join_room(room_code, f"Guest {index}")

    with cf.ThreadPoolExecutor(max_workers=19) as pool:
        futures = [pool.submit(worker, i) for i in range(19)]
        starter.set()
        for future in futures:
            future.result()

    final_room = store.get_room(room_code)
    assert final_room is not None
    assert room_joined_racer_count(final_room) == 20
    assert len(final_room["players"]) == 20
    assert len(final_room["racer_player_ids"]) == 20
    assert len(final_room["game_state"]["boats"]) == 20
