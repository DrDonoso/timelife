"""The first administrator (``POST /api/auth/setup`` while no enabled administrator exists) and
the recovery links printed by ``python -m timelife.setup``."""

import asyncio
import os
import re
import subprocess
import sys
from collections.abc import Awaitable
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from timelife import setup as admin_setup
from timelife.auth import SESSION_COOKIE
from timelife.config import Settings
from timelife.db import AppSetting, User, utcnow
from timelife.passwords import hash_password_now, verify_password_now

from .conftest import TEST_ORIGIN, cookie_domain, csrf_headers, login_as, run_db

PASSWORD = "clave de la administradora"
ANONYMOUS = {"authenticated": False, "user": None}


def setup(client: TestClient, email: str = "ana@example.com", **extra: Any) -> httpx.Response:
    return client.post("/api/auth/setup", json={"email": email, "password": PASSWORD, **extra})


def recovery_link(client: TestClient, minutes: int = 60) -> str:
    """Open a recovery link like the command does; returns its code."""
    config: Settings = client.app.state.settings  # type: ignore[attr-defined]
    assert client.portal is not None
    token, _ = client.portal.call(admin_setup.open_recovery, config, minutes)
    return token


def add_user(client: TestClient, email: str, role: str = "admin", **values: Any) -> int:
    async def create(db: AsyncSession) -> int:
        user = User(email=email, role=role, **values)
        db.add(user)
        await db.commit()
        return user.id

    return run_db(client, create)


def stored(client: TestClient, email: str) -> User:
    async def find(db: AsyncSession) -> User | None:
        return await db.scalar(select(User).where(User.email == email))

    user = run_db(client, find)
    assert user is not None
    return user


def signed_in_as(client: TestClient, token: str | None = None) -> str | None:
    if token is not None:
        client.cookies.set(SESSION_COOKIE, token, domain=cookie_domain(client), path="/api")
    session = client.get("/api/auth/session").json()
    return None if session == ANONYMOUS else session["user"]["email"]


def setup_required(client: TestClient) -> bool:
    return bool(client.get("/api/auth/config").json()["setup_required"])


def test_a_new_installation_creates_its_first_administrator(client: TestClient) -> None:
    assert setup_required(client)
    response = setup(client, " Ana@Example.com ", name="  Ana  ")
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "authenticated": True,
        "user": {
            "id": body["user"]["id"],
            "email": "ana@example.com",
            "name": "Ana",
            "role": "admin",
            "has_password": True,
        },
    }
    assert signed_in_as(client) == "ana@example.com"
    assert client.get("/api/admin/users").status_code == 200
    assert not setup_required(client)
    ana = stored(client, "ana@example.com")
    assert (ana.disabled, ana.must_change_password) == (False, False)
    assert ana.password_hash is not None and verify_password_now(PASSWORD, ana.password_hash)

    # Closed from now on, for anybody.
    client.cookies.clear()
    for extra in ({}, {"token": "a" * 64}):
        closed = setup(client, "intruso@example.com", **extra)
        assert (closed.status_code, closed.json()) == (403, {"code": "setup_closed"})
    login = client.post(
        "/api/auth/login", json={"email": "ana@example.com", "password": PASSWORD}
    )
    assert login.status_code == 200


def test_without_an_enabled_administrator_an_existing_account_takes_over(
    client: TestClient,
) -> None:
    add_user(client, "jefa@example.com", disabled=True)  # a disabled admin does not count
    viewer = login_as(client, "viewer", email="luis@example.com")
    phone = client.cookies.get(SESSION_COOKIE)
    client.cookies.clear()
    assert setup_required(client)

    response = setup(client, "luis@example.com", name="Luis")
    assert response.status_code == 200
    assert response.json()["user"]["id"] == viewer
    luis = stored(client, "luis@example.com")
    assert (luis.role, luis.disabled, luis.name, luis.auth_version) == ("admin", False, "Luis", 2)
    assert signed_in_as(client, phone) is None
    assert not setup_required(client)


def test_a_recovery_link_works_once(client: TestClient) -> None:
    add_user(client, "ana@example.com", password_hash=hash_password_now("olvidada"))
    login_as(client, "admin", email="ana@example.com")
    laptop = client.cookies.get(SESSION_COOKIE)
    client.cookies.clear()
    assert not setup_required(client)
    closed = setup(client)
    assert (closed.status_code, closed.json()) == (403, {"code": "setup_closed"})

    token = recovery_link(client)
    wrong = setup(client, token="0" * 64)
    assert (wrong.status_code, wrong.json()) == (403, {"code": "setup_closed"})
    response = setup(client, token=token)
    assert response.status_code == 200
    assert signed_in_as(client) == "ana@example.com"
    ana = stored(client, "ana@example.com")
    assert ana.password_hash is not None and verify_password_now(PASSWORD, ana.password_hash)
    assert signed_in_as(client, laptop) is None  # signed out everywhere else

    async def marker(db: AsyncSession) -> AppSetting | None:
        return await db.get(AppSetting, admin_setup.SETUP_KEY)

    assert run_db(client, marker) is None
    client.cookies.clear()
    again = setup(client, "otra@example.com", token=token)
    assert (again.status_code, again.json()) == (403, {"code": "setup_closed"})


def test_a_recovery_link_can_add_an_administrator(client: TestClient) -> None:
    ana = add_user(client, "ana@example.com")
    token = recovery_link(client)
    response = setup(client, "eva@example.com", token=token)
    assert response.status_code == 200
    assert response.json()["user"]["role"] == "admin"
    assert stored(client, "ana@example.com").id == ana
    assert stored(client, "ana@example.com").auth_version == 1  # untouched


def test_recovery_links_expire_and_are_replaced(client: TestClient) -> None:
    add_user(client, "ana@example.com")
    first = recovery_link(client)
    second = recovery_link(client)
    assert first != second
    assert setup(client, token=first).status_code == 403

    async def expire(db: AsyncSession) -> None:
        marker = await db.get(AppSetting, admin_setup.SETUP_KEY)
        assert marker is not None
        past = (utcnow() - timedelta(seconds=1)).isoformat()
        marker.value = {**marker.value, "expires_at": past}
        await db.commit()

    run_db(client, expire)
    assert setup(client, token=second).status_code == 403
    assert setup(client, token=recovery_link(client, minutes=1)).status_code == 200


@pytest.mark.parametrize(
    "value",
    [
        None,
        "not a dict",
        {},
        {"token_hash": 1, "expires_at": "2999-01-01T00:00:00+00:00"},
        {"token_hash": "x", "expires_at": "not a date"},
        {"token_hash": "x", "expires_at": "2999-01-01T00:00:00"},  # no time zone
    ],
)
def test_malformed_recovery_markers_open_nothing(config: Settings, value: Any) -> None:
    marker = AppSetting(key=admin_setup.SETUP_KEY, value=value)
    assert not admin_setup.recovery_open(config, marker, "a" * 64)
    assert not admin_setup.recovery_open(config, None, "a" * 64)


@pytest.mark.parametrize(
    "body",
    [
        {"email": "ana@example.com"},
        {"email": "ana@example.com", "password": "corta"},
        {"email": "ana", "password": PASSWORD},
        {"email": "ana@example.com", "password": PASSWORD, "token": "A" * 64},
        {"email": "ana@example.com", "password": PASSWORD, "role": "admin"},
        {"email": "ana@example.com", "password": PASSWORD, "name": "x" * 121},
    ],
)
def test_setup_validates_the_body(client: TestClient, body: dict[str, Any]) -> None:
    response = client.post("/api/auth/setup", json=body)
    assert (response.status_code, response.json()["code"]) == (422, "invalid_request")
    assert setup_required(client)


def test_setup_attempts_are_throttled(client: TestClient) -> None:
    add_user(client, "ana@example.com")
    for _ in range(admin_setup.SETUP_IP_LIMIT):
        assert setup(client, token="c" * 64).status_code == 403
    blocked = setup(client, token=recovery_link(client))
    assert (blocked.status_code, blocked.json()) == (429, {"code": "request_throttled"})


def test_simultaneous_first_setups_create_one_administrator(
    client: TestClient, config: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    if make_url(config.database_url).get_backend_name() != "postgresql":
        pytest.skip("needs PostgreSQL advisory locks (set TEST_DATABASE_URL)")
    app: Any = client.app
    lock_setup = admin_setup.lock_setup
    arrived = asyncio.Barrier(2)

    async def together(db: AsyncSession) -> None:
        async with asyncio.timeout(10):
            await arrived.wait()  # both requests found no administrator before locking
        await lock_setup(db)

    monkeypatch.setattr(admin_setup, "lock_setup", together)

    async def race() -> list[httpx.Response]:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url=TEST_ORIGIN) as http:

            def create(email: str) -> Awaitable[httpx.Response]:
                body = {"email": email, "password": PASSWORD}
                return http.post("/api/auth/setup", json=body, headers=csrf_headers())

            return list(await asyncio.gather(create("ana@example.com"), create("eva@example.com")))

    assert client.portal is not None
    responses = client.portal.call(race)
    assert sorted(response.status_code for response in responses) == [200, 403]

    async def admins(db: AsyncSession) -> list[str]:
        return list(await db.scalars(select(User.email).where(User.role == "admin")))

    assert len(run_db(client, admins)) == 1


def run_command(config: Settings, cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """``python -m timelife.setup`` as in the container, outside the repository (no .env)."""
    env = {
        name: value
        for name, value in os.environ.items()
        if name.lower() not in Settings.model_fields
    }
    env.update(
        DATABASE_URL=config.database_url,
        AUTH_SECRET=config.auth_secret.get_secret_value(),
        PUBLIC_ORIGIN=f"{TEST_ORIGIN},https://timelife.example.com",
        AUTH_COOKIE_SECURE="false",
        TZ="UTC",
    )
    return subprocess.run(
        [sys.executable, "-m", "timelife.setup", *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_the_setup_command_prints_a_working_link(
    client: TestClient, config: Settings, tmp_path: Path
) -> None:
    add_user(client, "ana@example.com")
    result = run_command(config, tmp_path, "--minutes", "5")
    assert result.returncode == 0, result.stderr
    links = re.findall(r"^  (\S+)/setup#([0-9a-f]{64})$", result.stdout, re.MULTILINE)
    assert [origin for origin, _ in links] == [TEST_ORIGIN, "https://timelife.example.com"]
    assert len({token for _, token in links}) == 1
    assert re.search(r"It works once, until \d{4}-\d\d-\d\d \d\d:\d\d \(UTC\)\.", result.stdout)
    response = setup(client, token=links[0][1])
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "ana@example.com"


def test_the_setup_command_checks_its_arguments(config: Settings, tmp_path: Path) -> None:
    for minutes in ("0", "1441", "soon"):
        result = run_command(config, tmp_path, "--minutes", minutes)
        assert result.returncode == 2
        assert "--minutes" in result.stderr
