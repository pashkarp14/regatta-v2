from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
SESSION_DIR = REPO_ROOT / ".flask_session"
PYTHON_BIN = REPO_ROOT / ".venv" / "Scripts" / "python.exe"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _clear_session_dir() -> None:
    if not SESSION_DIR.exists():
        return
    for child in SESSION_DIR.iterdir():
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)


def _wait_for_health(base_url: str, *, timeout_s: float, stdout_path: Path, stderr_path: Path) -> None:
    deadline = time.time() + timeout_s
    health_url = f"{base_url}/healthz"
    last_error = "healthz did not respond"
    while time.time() < deadline:
        try:
            with urlopen(health_url, timeout=1.5) as response:
                if response.status == 200:
                    return
                last_error = f"unexpected status {response.status}"
        except URLError as exc:
            last_error = str(exc)
        time.sleep(0.2)

    stdout_tail = stdout_path.read_text(encoding="utf-8", errors="replace")[-4000:] if stdout_path.exists() else ""
    stderr_tail = stderr_path.read_text(encoding="utf-8", errors="replace")[-4000:] if stderr_path.exists() else ""
    raise RuntimeError(
        f"Timed out waiting for {health_url}: {last_error}\n"
        f"--- stdout ---\n{stdout_tail}\n"
        f"--- stderr ---\n{stderr_tail}\n"
    )


@pytest.fixture(scope="session")
def base_url(tmp_path_factory: pytest.TempPathFactory) -> str:
    if not PYTHON_BIN.exists():
        raise RuntimeError(f"Missing virtualenv python at {PYTHON_BIN}")

    port = _free_port()
    base = f"http://127.0.0.1:{port}"
    runtime_dir = tmp_path_factory.mktemp("e2e-server")
    stdout_path = runtime_dir / "server.out.log"
    stderr_path = runtime_dir / "server.err.log"
    library_dir = runtime_dir / "library"
    library_dir.mkdir(parents=True, exist_ok=True)
    _clear_session_dir()

    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "testing",
            "PORT": str(port),
            "LIBRARY_DIR": str(library_dir),
            "FLASK_USE_RELOADER": "0",
            "FLASK_DEBUG": "0",
            "PYTHONUNBUFFERED": "1",
        }
    )

    with stdout_path.open("w", encoding="utf-8") as stdout_file, stderr_path.open("w", encoding="utf-8") as stderr_file:
        process = subprocess.Popen(
            [str(PYTHON_BIN), "app.py"],
            cwd=REPO_ROOT,
            env=env,
            stdout=stdout_file,
            stderr=stderr_file,
            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
        )

    try:
        _wait_for_health(base, timeout_s=20, stdout_path=stdout_path, stderr_path=stderr_path)
        yield base
    finally:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


@pytest.fixture
def app_page(page, base_url: str):
    page.goto(base_url, wait_until="networkidle")
    page.wait_for_function("() => !!window.RegattaApp && !!window.RegattaMultiplayer")
    return page
