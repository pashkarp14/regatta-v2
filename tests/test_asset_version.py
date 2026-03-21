from __future__ import annotations

from pathlib import Path

from regatta_app.factory import create_app


def test_index_uses_cache_busting_asset_version(tmp_path: Path):
    library_dir = tmp_path / "library"
    library_dir.mkdir()

    app = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SESSION_TYPE": "filesystem",
            "LIBRARY_DIR": str(library_dir),
            "ROOM_TTL_SECONDS": 3600,
            "APP_VERSION": "2.0.0",
        }
    )
    client = app.test_client()

    response = client.get("/")
    html = response.get_data(as_text=True)

    asset_version = app.config["ASSET_VERSION"]
    assert asset_version.startswith("2.0.0-")
    assert asset_version != app.config["APP_VERSION"]
    assert response.headers["Cache-Control"] == "no-store, max-age=0"
    assert response.headers["Pragma"] == "no-cache"
    assert response.headers["Expires"] == "0"
    assert f'/static/multiplayer.js?v={asset_version}' in html
    assert f'/static/regatta.js?v={asset_version}' in html
    assert f'/static/game_shell.js?v={asset_version}' in html
    assert f'/static/regatta.css?v={asset_version}' in html


def test_bootstrap_exposes_asset_version(tmp_path: Path):
    library_dir = tmp_path / "library"
    library_dir.mkdir()

    app = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SESSION_TYPE": "filesystem",
            "LIBRARY_DIR": str(library_dir),
            "ROOM_TTL_SECONDS": 3600,
            "APP_VERSION": "2.0.0",
        }
    )
    client = app.test_client()

    response = client.get("/api/bootstrap")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["version"] == "2.0.0"
    assert payload["asset_version"] == app.config["ASSET_VERSION"]
