"""Shared fixtures.

* ``config``: settings for a freshly migrated and seeded database (SQLite file per test, or the
  PostgreSQL database named ``timelife_test`` given by ``TEST_DATABASE_URL``, emptied per test).
* ``config_factory(**overrides)``: variants of ``config`` on the same database and media folder.
* ``client``: ``TestClient`` running the app lifespan, sending the same-origin CSRF headers.
* ``admin`` / ``viewer``: ``client`` already signed in as ``admin@example.com`` (role admin) /
  ``viewer@example.com`` (role viewer). Both are the same ``client`` object: request one of them,
  or switch identity with ``login_as(client, ...)``.
* ``sessions``: async sessionmaker on the test database for direct checks in ``async`` tests.
* ``database_url``: migrated but unseeded database; ``make_settings(...)``/``migrate(...)`` helpers.
* ``fast_passwords`` (automatic): cheap scrypt parameters (``PASSWORD_PARAMETERS``: the real ones).

Helpers for started clients (inside ``with``), usable from sync and async tests:
``login_as(client, role="admin", *, email=None, name=None) -> user_id`` signs in directly (user +
session row + cookie); ``run_db(client, action)`` awaits ``action(db)`` with the app's own
sessionmaker; ``app_client(config, origin=None)`` builds a client for another origin (e.g.
``http://localhost`` for dev login or an HTTPS origin for Google sign-in); ``csrf_headers(origin)``
and ``set_cookies(response)`` (parsed ``Set-Cookie`` attributes).
"""

import asyncio
import os
import secrets
import shutil
import subprocess
import sys
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from dataclasses import dataclass
from datetime import timedelta
from http.cookies import Morsel, SimpleCookie
from pathlib import Path
from typing import Any, TypeVar

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from timelife import passwords
from timelife.app import create_app
from timelife.auth import SESSION_COOKIE, SESSION_COOKIE_PATH, access_hash
from timelife.config import Settings
from timelife.contracts import Role
from timelife.db import Base, User, UserSession, create_db_engine, utcnow
from timelife.seed import seed

ROOT = Path(__file__).resolve().parents[1]
TEST_ORIGIN = "http://testserver"
TEST_HEADERS = {"origin": TEST_ORIGIN, "x-timelife-request": "1"}
POSTGRES_TEST_DATABASE = "timelife_test"
# The real scrypt parameters (tests run with cheap ones, see ``fast_passwords``).
PASSWORD_PARAMETERS = (passwords.COST, passwords.BLOCK_SIZE, passwords.PARALLELISM)
T = TypeVar("T")


@pytest.fixture(autouse=True)
def fast_passwords(monkeypatch: pytest.MonkeyPatch) -> None:
    """Cheap scrypt parameters: a hash with the real ones takes a large fraction of a second."""
    monkeypatch.setattr(passwords, "COST", 2**4)
    monkeypatch.setattr(passwords, "PARALLELISM", 1)


def sqlite_url(path: Path) -> str:
    return "sqlite+aiosqlite:///" + path.as_posix()


def make_settings(database_url: str, media_dir: Path, **overrides: Any) -> Settings:
    """Test settings that never read ``.env``; keyword overrides replace any value."""
    values: dict[str, Any] = {
        "database_url": database_url,
        "auth_secret": secrets.token_urlsafe(32),
        "public_origin": TEST_ORIGIN,
        "auth_cookie_secure": False,
        "session_days": 30,
        "google_client_id": "",
        "google_client_secret": "",
        "smtp_host": "",
        "smtp_port": None,
        "smtp_security": "starttls",
        "smtp_username": "",
        "smtp_password": "",
        "smtp_from": "",
        "allow_insecure_local_login": False,
        "local_login_password": "admin",
        "media_dir": media_dir,
        "max_upload_mb": 30,
        "image_tag": "test",
        "build_date": "2026-01-01",
        "tz": "Europe/Madrid",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def migrate(url: str, revision: str = "head", *, command: str = "upgrade") -> None:
    """Run Alembic in a subprocess, exactly like the container entrypoint does."""
    result = subprocess.run(
        [sys.executable, "-m", "alembic", command, revision],
        cwd=ROOT,
        env={**os.environ, "DATABASE_URL": url},
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"alembic {command} {revision} failed:\n{result.stderr}")


async def drop_everything(url: str) -> None:
    engine = create_db_engine(url, foreign_keys=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.execute(text("DROP TABLE IF EXISTS alembic_version"))
    finally:
        await engine.dispose()


async def empty_tables(url: str) -> None:
    engine = create_db_engine(url)
    try:
        async with engine.begin() as connection:
            tables = Base.metadata.sorted_tables
            if connection.dialect.name == "postgresql":
                names = ", ".join(table.name for table in tables)
                await connection.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
            else:
                for table in reversed(tables):
                    await connection.execute(table.delete())
    finally:
        await engine.dispose()


async def seed_database(url: str) -> None:
    engine = create_db_engine(url)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            await seed(db)
    finally:
        await engine.dispose()


@dataclass(frozen=True)
class MigratedDatabase:
    shared_url: str | None = None  # TEST_DATABASE_URL, emptied before each test
    template: Path | None = None  # migrated SQLite file, copied for each test


@pytest.fixture(scope="session")
def migrated_database(tmp_path_factory: pytest.TempPathFactory) -> MigratedDatabase:
    url = os.environ.get("TEST_DATABASE_URL", "").strip()
    if url:
        if url.startswith("postgresql") and make_url(url).database != POSTGRES_TEST_DATABASE:
            raise RuntimeError(
                "TEST_DATABASE_URL must point to a dedicated database named "
                + POSTGRES_TEST_DATABASE
            )
        asyncio.run(drop_everything(url))
        migrate(url)
        return MigratedDatabase(shared_url=url)
    template = tmp_path_factory.mktemp("database") / "template.db"
    migrate(sqlite_url(template))
    return MigratedDatabase(template=template)


@pytest.fixture
def database_url(migrated_database: MigratedDatabase, tmp_path: Path) -> str:
    """URL of a migrated, empty (unseeded) database for this test."""
    if migrated_database.template is not None:
        path = tmp_path / "test.db"
        shutil.copyfile(migrated_database.template, path)
        return sqlite_url(path)
    assert migrated_database.shared_url is not None
    asyncio.run(empty_tables(migrated_database.shared_url))
    return migrated_database.shared_url


@pytest.fixture
def config(database_url: str, tmp_path: Path) -> Settings:
    asyncio.run(seed_database(database_url))
    return make_settings(database_url, tmp_path / "media")


@pytest.fixture
def config_factory(config: Settings) -> Callable[..., Settings]:
    """Variants of ``config`` on the same database and media folder, e.g. with dev login:
    ``config_factory(public_origin="http://localhost", allow_insecure_local_login=True)``."""

    def factory(**overrides: Any) -> Settings:
        return make_settings(config.database_url, config.media_dir, **overrides)

    return factory


@pytest.fixture
def client(config: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(config)) as test_client:
        test_client.headers.update(TEST_HEADERS)
        yield test_client


@pytest.fixture
async def sessions(config: Settings) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_db_engine(config.database_url)
    try:
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()


def csrf_headers(origin: str = TEST_ORIGIN) -> dict[str, str]:
    """Headers every mutation needs: the page's ``Origin`` and ``X-Timelife-Request: 1``."""
    return {"origin": origin, "x-timelife-request": "1"}


def set_cookies(response: httpx.Response) -> dict[str, Morsel[str]]:
    """Cookies set (or cleared: ``max-age`` "0") by a response, with their attributes."""
    cookies: dict[str, Morsel[str]] = {}
    for header in response.headers.get_list("set-cookie"):
        parsed: SimpleCookie = SimpleCookie()
        parsed.load(header)
        cookies.update(parsed)
    return cookies


def app_client(config: Settings, *, origin: str | None = None, **options: Any) -> TestClient:
    """Unstarted ``TestClient`` (use ``with``) whose base URL and CSRF headers are ``origin``
    (default: the first public origin of ``config``)."""
    origin = origin or config.public_origins[0]
    client = TestClient(create_app(config), base_url=origin, **options)
    client.headers.update(csrf_headers(origin))
    return client


def cookie_domain(client: TestClient) -> str:
    """Jar domain of host-only cookies: ``http.cookiejar`` files dot-less hosts (``testserver``,
    ``localhost``) under ``<host>.local``; matching it lets server-sent cookies replace ours."""
    host = client.base_url.host
    return host if "." in host else f"{host}.local"


def run_db(client: TestClient, action: Callable[[AsyncSession], Awaitable[T]]) -> T:
    """``await action(db)`` with the app's own sessionmaker, inside the started client's event
    loop (works in sync and async tests). Commit inside ``action`` to persist changes."""
    portal = client.portal
    if portal is None:
        raise RuntimeError("run_db/login_as need a started TestClient (inside `with`)")
    app: Any = client.app

    async def call() -> T:
        async with app.state.sessions() as db:
            return await action(db)

    return portal.call(call)


def login_as(
    client: TestClient,
    role: Role = "admin",
    *,
    email: str | None = None,
    name: str | None = None,
) -> int:
    """Sign ``client`` in as ``email`` (default ``<role>@example.com``): creates the user with
    ``role``/``name`` if missing (an existing user is reused unchanged), adds a session row and
    sets the ``timelife_session`` cookie, replacing any previous one. Returns the user id."""
    address = (email or f"{role}@example.com").strip().lower()
    token = secrets.token_hex(32)
    app: Any = client.app
    config: Settings = app.state.settings

    async def sign_in(db: AsyncSession) -> int:
        user = await db.scalar(select(User).where(User.email == address))
        if user is None:
            user = User(email=address, name=name, role=role, disabled=False, auth_version=1)
            db.add(user)
            await db.flush()
        db.add(
            UserSession(
                token_hash=access_hash(config, "session", token),
                user_id=user.id,
                auth_version=user.auth_version,
                expires_at=utcnow() + timedelta(days=config.session_days),
            )
        )
        await db.commit()
        return user.id

    user_id = run_db(client, sign_in)
    domain = cookie_domain(client)
    client.cookies.set(SESSION_COOKIE, token, domain=domain, path=SESSION_COOKIE_PATH)
    return user_id


@pytest.fixture
def admin(client: TestClient) -> TestClient:
    """``client`` signed in as ``admin@example.com`` (role admin)."""
    login_as(client, "admin")
    return client


@pytest.fixture
def viewer(client: TestClient) -> TestClient:
    """``client`` signed in as ``viewer@example.com`` (role viewer)."""
    login_as(client, "viewer")
    return client
