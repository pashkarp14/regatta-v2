from __future__ import annotations

import time

from regatta_app import sockets as _sockets


def _room_has_connected_socket(room_code: str) -> bool:
    with _sockets._realtime_lock:
        for saved_room_code, _player_token in _sockets._socket_memberships.values():
            if saved_room_code == room_code:
                return True
    return False


def _patched_run_realtime_room_loop(app, room_code: str) -> None:
    tick_dt = 1.0 / _sockets.REALTIME_TICK_HZ
    try:
        while True:
            with app.app_context():
                room = _sockets.room_store().get_room(room_code)
                if room is None:
                    break

                if room.get("status") == "live" and not _room_has_connected_socket(room_code):
                    break

                now_ms = int(time.time() * 1000)
                controls = _sockets.realtime_controls_snapshot(room_code)
                changed = False

                if room.get("status") == "lobby":
                    if not _sockets.any_active_control(controls):
                        break
                    changed = _sockets.simulate_realtime_tick(room["game_state"], controls, tick_dt, now_ms)
                else:
                    if not _sockets.room_requires_live_loop(room):
                        break
                    if ((room.get("game_state", {}).get("race") or {}).get("phase")) == "finished":
                        break
                    if _sockets.state_play_mode(room.get("game_state")) == "realtime":
                        race = (room.get("game_state") or {}).get("race") or {}
                        if bool(race.get("realtimePaused")):
                            changed = False
                        else:
                            changed = _sockets.simulate_realtime_tick(room["game_state"], controls, tick_dt, now_ms)
                    else:
                        changed = _sockets.simulate_weather_tick(room["game_state"], now_ms)
                if changed:
                    room["revision"] += 1
                    _sockets.room_store().save_room(room)
                    _sockets.broadcast_room_state(room)
            _sockets.socketio.sleep(tick_dt)
    finally:
        with _sockets._realtime_lock:
            _sockets._realtime_loops.discard(room_code)
        _sockets.pop_realtime_control(room_code)


_sockets.run_realtime_room_loop = _patched_run_realtime_room_loop
