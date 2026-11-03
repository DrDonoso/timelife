"""Isolated Timelife server for the Playwright end-to-end suite (local development and CI only).

Playwright's ``webServer`` runs ``uv run --no-sync python scripts/e2e_server.py`` (build the SPA
first: ``npm run build`` in ``frontend/``). Each start creates a fresh SQLite database and media
folder in ``.tmp/e2e-server/<port>-<pid>/``, applies the migrations, seeds the default
categories, loads the deterministic demo data (``timelife.demo``, ``--events`` milestones) and
serves the API plus ``frontend/dist`` on ``http://127.0.0.1:<port>`` with the development sign-in
(``admin`` / ``viewer``, password ``admin``). Settings come only from this script, never from a
local ``.env``.

The folder is deleted when the server stops: on SIGINT/SIGTERM (Playwright sends SIGTERM on
Linux and macOS) and also when the process is killed outright, as Playwright does on Windows,
thanks to a small detached helper that waits for the server to exit. Folders left behind by a
crash are wiped by the next start."""

import argparse
import asyncio
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
from collections.abc import Sequence
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = str(Path(__file__).resolve())
DATA_ROOT = ROOT / ".tmp" / "e2e-server"
HOST = "127.0.0.1"
DEFAULT_PORT = 7810
DEFAULT_EVENTS = 40


def in_use(port: int) -> bool:
    try:
        with socket.create_connection((HOST, port), timeout=1):
            return True
    except OSError:
        return False


def configure(port: int, data_dir: Path) -> None:
    os.environ.update(
        DATABASE_URL=f"sqlite+aiosqlite:///{(data_dir / 'timelife.db').as_posix()}",
        MEDIA_DIR=str(data_dir / "media"),
        AUTH_SECRET=secrets.token_urlsafe(48),
        PUBLIC_ORIGIN=f"http://{HOST}:{port}",
        AUTH_COOKIE_SECURE="false",
        ALLOW_INSECURE_LOCAL_LOGIN="true",
        LOCAL_LOGIN_PASSWORD="admin",
        GOOGLE_CLIENT_ID="",
        GOOGLE_CLIENT_SECRET="",
        SMTP_HOST="",
        IMAGE_TAG="e2e",
        TZ="Europe/Madrid",
    )


def remove(data_dir: Path, attempts: int = 1) -> None:
    for attempt in range(attempts):
        shutil.rmtree(data_dir, ignore_errors=True)
        if not data_dir.exists():
            return
        if attempt + 1 < attempts:
            time.sleep(0.2)


def remove_after_exit(data_dir: Path) -> None:
    """Windows: delete ``data_dir`` even if this process is killed (``taskkill /T /F``, no signal).
    The helper is started through a short-lived intermediate process, so it is neither part of the
    killed process tree nor of its kill-on-close job."""
    if sys.platform == "win32":
        command = [sys.executable, SCRIPT, "--spawn-cleanup", str(os.getpid()), str(data_dir)]
        subprocess.run(command, check=False)


def spawn_cleanup(pid: str, data_dir: str) -> None:
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(
        subprocess, "CREATE_NEW_PROCESS_GROUP", 0
    )
    subprocess.Popen(
        [sys.executable, SCRIPT, "--cleanup", pid, data_dir],
        creationflags=flags,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
    )


def cleanup(pid: str, data_dir: str) -> None:
    if sys.platform == "win32":
        import ctypes

        kernel32 = ctypes.WinDLL("kernel32")
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        synchronize, infinite = 0x00100000, 0xFFFFFFFF
        handle = kernel32.OpenProcess(synchronize, False, int(pid))
        if handle:
            kernel32.WaitForSingleObject(handle, infinite)
            kernel32.CloseHandle(handle)
    # The database file stays locked for a moment after the server is gone.
    remove(Path(data_dir), attempts=50)


def serve(port: int, events: int) -> None:
    # Imported once the environment is configured.
    import uvicorn
    from alembic.config import Config

    from alembic import command
    from timelife import demo
    from timelife.app import create_app
    from timelife.config import Settings

    migrations = Config()  # no alembic.ini: keeps its logging configuration out of the output
    migrations.set_main_option("script_location", str(ROOT / "alembic"))
    command.upgrade(migrations, "head")
    config = Settings(_env_file=None)
    # Seeds the default categories, then loads the demo children and milestones.
    print(asyncio.run(demo.run(config, count=events)), flush=True)
    print(f"Timelife e2e server on http://{HOST}:{port}", flush=True)
    uvicorn.run(create_app(config), host=HOST, port=port, log_level="warning", access_log=False)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python scripts/e2e_server.py",
        description="Serve Timelife with fresh demo data for the end-to-end tests.",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--events", type=int, default=DEFAULT_EVENTS, help="demo milestones to load (min 1)"
    )
    parser.add_argument(
        "--keep",
        action="store_true",
        help="keep the data folder after the server stops (until the next start)",
    )
    # Internal: the Windows clean-up helper (see remove_after_exit).
    parser.add_argument("--spawn-cleanup", nargs=2, metavar=("PID", "DIR"), help=argparse.SUPPRESS)
    parser.add_argument("--cleanup", nargs=2, metavar=("PID", "DIR"), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.spawn_cleanup:
        spawn_cleanup(*args.spawn_cleanup)
        return 0
    if args.cleanup:
        cleanup(*args.cleanup)
        return 0
    if args.events < 1:
        parser.error("--events must be at least 1")

    # frontend/dist is served relative to the working directory.
    os.chdir(ROOT)
    if not (ROOT / "frontend" / "dist" / "index.html").is_file():
        print("frontend/dist is missing: run 'npm run build' in frontend/ first.", file=sys.stderr)
        return 1
    if in_use(args.port):
        print(f"Port {args.port} is already in use.", file=sys.stderr)
        return 1
    # Nothing serves this port: folders of earlier servers on it are leftovers.
    for stale in DATA_ROOT.glob(f"{args.port}-*"):
        remove(stale)
    data_dir = DATA_ROOT / f"{args.port}-{os.getpid()}"
    data_dir.mkdir(parents=True)
    if not args.keep:
        remove_after_exit(data_dir)
    configure(args.port, data_dir)
    try:
        serve(args.port, args.events)
    finally:
        if not args.keep:
            remove(data_dir, attempts=10)
    return 0


if __name__ == "__main__":
    sys.exit(main())
