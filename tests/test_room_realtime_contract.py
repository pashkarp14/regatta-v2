from __future__ import annotations

import time
from pathlib import Path

import pytest

from regatta_app import sockets as realtime_sockets
from regatta_app.factory import create_app
from regatta_app.extensions import socketio


def make_realtime_state(boat_count: int = 2) -> dict:
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


@pytest.fixture
def app(tmp_path: Path):
    library_dir = tmp_path / "library"
    library_dir.mkdir()
    app = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SESSION_TYPE": "filesystem",
            "LIBRARY_DIR": str(library_dir),
            "ROOM_TTL_SECONDS": 3600,
        }
    )
    yield app


@pytest.fixture
def client_factory(app):
    def factory():
        return app.test_client()

    return factory


def create_room(
    client,
    *,
    host_role: str = "player",
    display_name: str = "Host",
    state: dict | None = None,
    max_players: int = 2,
) -> dict:
    response = client.post(
        "/api/rooms",
        json={
            "display_name": display_name,
            "host_role": host_role,
            "max_players": max_players,
            "game_state": state or make_realtime_state(),
        },
    )
    assert response.status_code == 200, response.get_json()
    return response.get_json()["room"]


def join_room(client, room_code: str, display_name: str) -> dict:
    response = client.post(
        "/api/rooms/join",
        json={
            "display_name": display_name,
            "room_code": room_code,
        },
    )
    assert response.status_code == 200, response.get_json()
    return response.get_json()["room"]


def fetch_room(client, room_code: str) -> dict:
    response = client.get(f"/api/rooms/{room_code}")
    assert response.status_code == 200, response.get_json()
    return response.get_json()["room"]


def test_player_host_room_exposes_player_ids_and_can_start(client_factory):
    host = client_factory()

    room = create_room(host, host_role="player", state=make_realtime_state(2))

    assert room["joined_racers_count"] == 1
    assert room["max_players"] == 2
    assert room["can_start"] is True
    assert len(room["game_state"]["boats"]) == 1
    assert room["players"][0]["player_id"]
    assert room["self"]["player_id"] == room["players"][0]["player_id"]


def test_observer_room_grows_fleet_with_each_join_and_updates_can_start(client_factory):
    host = client_factory()
    guest_one = client_factory()
    guest_two = client_factory()

    room = create_room(host, host_role="observer", state=make_realtime_state(2))
    room_code = room["code"]

    assert room["joined_racers_count"] == 0
    assert room["max_players"] == 2
    assert room["can_start"] is False
    assert room["game_state"]["boats"] == []

    first_join = join_room(guest_one, room_code, "Guest One")
    assert first_join["joined_racers_count"] == 1
    assert first_join["max_players"] == 2
    assert first_join["can_start"] is True
    assert len(first_join["game_state"]["boats"]) == 1

    second_join = join_room(guest_two, room_code, "Guest Two")
    assert second_join["joined_racers_count"] == 2
    assert second_join["max_players"] == 2
    assert second_join["can_start"] is True
    assert len(second_join["game_state"]["boats"]) == 2


def test_live_kick_compacts_fleet_and_clears_removed_player_session(client_factory):
    host = client_factory()
    guest_one = client_factory()
    guest_two = client_factory()

    room = create_room(host, host_role="player", state=make_realtime_state(3), max_players=3)
    room_code = room["code"]
    guest_one_room = join_room(guest_one, room_code, "Guest One")
    guest_two_room = join_room(guest_two, room_code, "Guest Two")

    latest_room = fetch_room(host, room_code)
    start_response = host.post(
        f"/api/rooms/{room_code}/start",
        json={
            "arm_realtime": True,
            "game_state": latest_room["game_state"],
        },
    )
    assert start_response.status_code == 200, start_response.get_json()

    kicked_player = next(player for player in guest_one_room["players"] if player["is_self"])
    surviving_player = next(player for player in guest_two_room["players"] if player["is_self"])

    kick_response = host.post(
        f"/api/rooms/{room_code}/kick",
        json={"player_id": kicked_player["player_id"]},
    )
    assert kick_response.status_code == 200, kick_response.get_json()

    kicked_room = kick_response.get_json()["room"]
    assert kicked_room["status"] == "live"
    assert kicked_room["joined_racers_count"] == 2
    assert kicked_room["max_players"] == 3
    assert len(kicked_room["game_state"]["boats"]) == 2

    remaining_ids = [player["player_id"] for player in kicked_room["players"] if not player["is_observer"]]
    assert kicked_player["player_id"] not in remaining_ids
    assert surviving_player["player_id"] in remaining_ids
    assert sorted(player["seat_index"] for player in kicked_room["players"] if player["seat_index"] is not None) == [0, 1]

    kicked_bootstrap = guest_one.get("/api/bootstrap")
    assert kicked_bootstrap.status_code == 200
    assert kicked_bootstrap.get_json()["room"] is None


def test_kicked_player_receives_room_kicked_socket_event(app, client_factory):
    host = client_factory()
    guest = client_factory()

    room = create_room(host, host_role="player", state=make_realtime_state(2))
    room_code = room["code"]
    guest_room = join_room(guest, room_code, "Guest")

    socket_client = socketio.test_client(app, flask_test_client=guest)
    assert socket_client.is_connected()
    socket_client.emit("room:join_socket", {"room_code": room_code})
    socket_client.get_received()

    kicked_player = next(player for player in guest_room["players"] if player["is_self"])
    kick_response = host.post(
        f"/api/rooms/{room_code}/kick",
        json={"player_id": kicked_player["player_id"]},
    )
    assert kick_response.status_code == 200, kick_response.get_json()

    events = socket_client.get_received()
    assert any(event["name"] == "room:kicked" for event in events), events


def test_join_socket_skips_snapshot_when_client_revision_is_current(app, client_factory):
    host = client_factory()
    guest = client_factory()

    room = create_room(host, host_role="player", state=make_realtime_state(2))
    room_code = room["code"]
    joined_room = join_room(guest, room_code, "Guest")

    socket_client = socketio.test_client(app, flask_test_client=guest)
    assert socket_client.is_connected()

    socket_client.emit(
        "room:join_socket",
        {"room_code": room_code, "known_revision": joined_room["revision"]},
    )

    events = socket_client.get_received()
    assert not any(event["name"] == "room:snapshot" for event in events), events
    presence_events = [event for event in events if event["name"] == "room:presence"]
    assert presence_events, events
    assert presence_events[-1]["args"][0]["room"]["revision"] == joined_room["revision"]


def test_room_presence_payload_omits_game_state_but_keeps_roster_fields(app, client_factory):
    host = client_factory()
    guest = client_factory()

    room = create_room(host, host_role="player", state=make_realtime_state(2))
    room_code = room["code"]
    join_room(guest, room_code, "Guest")

    socket_client = socketio.test_client(app, flask_test_client=host)
    assert socket_client.is_connected()

    socket_client.emit("room:join_socket", {"room_code": room_code})

    events = socket_client.get_received()
    presence_events = [event for event in events if event["name"] == "room:presence"]
    assert presence_events, events
    room_payload = presence_events[-1]["args"][0]["room"]

    assert "game_state" not in room_payload
    assert room_payload["code"] == room_code
    assert room_payload["status"] == "lobby"
    assert room_payload["revision"] >= room["revision"]
    assert room_payload["joined_count"] == 2
    assert room_payload["joined_racers_count"] == 2
    assert room_payload["capacity"] == 100
    assert len(room_payload["players"]) == 2


def test_http_join_broadcasts_presence_before_guest_socket_connect(app, client_factory):
    host = client_factory()
    guest = client_factory()

    room = create_room(host, host_role="player", state=make_realtime_state(2))
    room_code = room["code"]

    host_socket = socketio.test_client(app, flask_test_client=host)
    assert host_socket.is_connected()
    host_socket.emit("room:join_socket", {"room_code": room_code, "known_revision": room["revision"]})
    host_socket.get_received()

    joined_room = join_room(guest, room_code, "Guest")
    host_events = host_socket.get_received()
    host_presence = [event for event in host_events if event["name"] == "room:presence"]
    assert host_presence, host_events
    assert host_presence[-1]["args"][0]["room"]["joined_count"] == 2

    guest_socket = socketio.test_client(app, flask_test_client=guest)
    assert guest_socket.is_connected()
    guest_socket.emit("room:join_socket", {"room_code": room_code, "known_revision": joined_room["revision"]})
    guest_events = guest_socket.get_received()
    assert any(event["name"] == "room:presence" for event in guest_events), guest_events
    assert not any(event["name"] == "room:presence" for event in host_socket.get_received())


def test_room_payload_exposes_split_racer_and_observer_capacity(client_factory):
    host = client_factory()

    room = create_room(host, host_role="player", state=make_realtime_state(2), max_players=2)

    assert room["max_players"] == 2
    assert room["max_racers"] == 2
    assert room["max_observers"] == 98
    assert room["joined_racers_count"] == 1
    assert room["joined_observers_count"] == 0
    assert room["capacity"] == 100


def test_join_after_racer_capacity_is_reached_becomes_observer(client_factory):
    host = client_factory()
    guest_one = client_factory()
    guest_two = client_factory()

    room = create_room(host, host_role="player", state=make_realtime_state(2), max_players=2)
    room_code = room["code"]

    first_join = join_room(guest_one, room_code, "Guest One")
    second_join = join_room(guest_two, room_code, "Guest Two")

    assert first_join["joined_racers_count"] == 2
    assert first_join["joined_observers_count"] == 0
    assert len(first_join["game_state"]["boats"]) == 2

    self_player = next(player for player in second_join["players"] if player["is_self"])
    assert self_player["is_observer"] is True
    assert self_player["seat_index"] is None
    assert second_join["joined_racers_count"] == 2
    assert second_join["joined_observers_count"] == 1
    assert second_join["max_racers"] == 2
    assert second_join["max_observers"] == 98
    assert second_join["capacity"] == 100
    assert len(second_join["game_state"]["boats"]) == 2


def test_live_room_loop_stops_after_last_socket_disconnect(app, client_factory):
    host = client_factory()
    guest = client_factory()

    room = create_room(host, host_role="player", state=make_realtime_state(2))
    room_code = room["code"]
    join_room(guest, room_code, "Guest")

    latest_room = fetch_room(host, room_code)
    start_response = host.post(
        f"/api/rooms/{room_code}/start",
        json={
            "arm_realtime": True,
            "game_state": latest_room["game_state"],
        },
    )
    assert start_response.status_code == 200, start_response.get_json()

    host_socket = socketio.test_client(app, flask_test_client=host)
    guest_socket = socketio.test_client(app, flask_test_client=guest)
    assert host_socket.is_connected()
    assert guest_socket.is_connected()

    host_socket.emit("room:join_socket", {"room_code": room_code})
    guest_socket.emit("room:join_socket", {"room_code": room_code})
    host_socket.get_received()
    guest_socket.get_received()

    deadline = time.time() + 1.0
    while time.time() < deadline:
        with realtime_sockets._realtime_lock:
            if room_code in realtime_sockets._realtime_loops:
                break
        time.sleep(0.02)

    with realtime_sockets._realtime_lock:
        assert room_code in realtime_sockets._realtime_loops

    host_socket.disconnect()
    guest_socket.disconnect()

    deadline = time.time() + 1.5
    while time.time() < deadline:
        with realtime_sockets._realtime_lock:
            if room_code not in realtime_sockets._realtime_loops:
                break
        time.sleep(0.02)

    with realtime_sockets._realtime_lock:
        assert room_code not in realtime_sockets._realtime_loops
