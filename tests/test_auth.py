"""Cookie sessions, the authentication dependencies, logout, dev login and throttling."""

import hashlib
import hmac
import re
import secrets
from collections.abc import Iterator
from datetime import timedelta
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.requests import Request

from timelife.app import create_app
from timelife.auth import (
    GOOGLE_COOKIE,
    SESSION_COOKIE,
    AdminUser,
    CurrentUser,
    access_hash,
    revoke_user_sessions,
    throttle,
    throttled,
)
from timelife.config import Settings
from timelife.db import AuthLimit, GoogleAuthFlow, User, UserSession, aware, utcnow
from timelife.errors import AppError

from .conftest import (
    TEST_ORIGIN,
    app_client,
    cookie_domain,
    csrf_headers,
    login_as,
    run_db,
    set_cookies,
)

Sessions = async_sessionmaker[AsyncSession]
LOCAL_ORIGIN = "http://localhost"
DEV_PASSWORD = "local dev password"
ANONYMOUS = {"authenticated": False, "user": None}


def probe_app(config: Settings) -> FastAPI:
    """The application plus two routes guarded by ``CurrentUser`` and ``AdminUser``."""
    application = create_app(config)

    async def whoami(user: CurrentUser) -> dict[str, Any]:
        return {"id": user.id, "email": user.email, "role": user.role}

    async def admin_only(user: AdminUser) -> dict[str, Any]:
        return {"id": user.id}

    application.add_api_route("/api/probe/user", whoami, methods=["GET"])
    application.add_api_route("/api/admin/probe", admin_only, methods=["GET"])
    routes = application.router.routes
    routes[:] = routes[-2:] + routes[:-2]  # ahead of the GET-only SPA catch-all
    return application


@pytest.fixture
def probe(config: Settings) -> Iterator[TestClient]:
    with TestClient(probe_app(config)) as client:
        client.headers.update(csrf_headers())
        yield client


@pytest.fixture
def local_config(config_factory: Any) -> Settings:
    return config_factory(
        public_origin=LOCAL_ORIGIN,
        allow_insecure_local_login=True,
        local_login_password=DEV_PASSWORD,
    )


@pytest.fixture
def local(local_config: Settings) -> Iterator[TestClient]:
    with app_client(local_config) as client:
        yield client


def dev_login(
    client: TestClient, username: str = "admin", password: str = DEV_PASSWORD
) -> httpx.Response:
    return client.post("/api/auth/dev-login", json={"username": username, "password": password})


async def session_hashes(db: AsyncSession) -> list[str]:
    return list(await db.scalars(select(UserSession.token_hash).order_by(UserSession.token_hash)))


def test_dev_login_issues_a_hashed_strict_session_cookie(
    local: TestClient, local_config: Settings
) -> None:
    response = dev_login(local)

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "authenticated": True,
        "user": {
            "id": body["user"]["id"],
            "email": "dev-admin@example.com",
            "name": None,
            "role": "admin",
            "has_password": False,
        },
    }
    cookie = set_cookies(response)[SESSION_COOKIE]
    token = cookie.value
    assert re.fullmatch(r"[0-9a-f]{64}", token)
    assert cookie["httponly"] is True
    assert cookie["samesite"].lower() == "strict"
    assert cookie["path"] == "/api"
    assert cookie["max-age"] == str(30 * 86400)
    assert not cookie["secure"]

    expected = hmac.new(
        local_config.auth_secret.get_secret_value().encode(),
        b"session\0" + token.encode(),
        hashlib.sha256,
    ).hexdigest()

    async def stored(db: AsyncSession) -> tuple[list[UserSession], User | None]:
        rows = list(await db.scalars(select(UserSession)))
        user = await db.scalar(select(User).where(User.email == "dev-admin@example.com"))
        return rows, user

    rows, user = run_db(local, stored)
    assert [row.token_hash for row in rows] == [expected]
    assert user is not None and user.last_login_at is not None
    lifetime = aware(rows[0].expires_at) - utcnow()
    assert timedelta(days=29, hours=23) < lifetime <= timedelta(days=30)

    assert local.get("/api/auth/session").json() == body
    assert local.get("/api/auth/config").json() == {
        "google_enabled": False,
        "dev_login_enabled": True,
        "password_reset_enabled": False,
        "setup_required": False,  # the development administrator exists now
    }


def test_session_cookie_is_secure_when_configured(config_factory: Any) -> None:
    config = config_factory(
        public_origin=LOCAL_ORIGIN, allow_insecure_local_login=True, auth_cookie_secure=True
    )
    with app_client(config) as client:
        response = dev_login(client, password="admin")
    assert response.status_code == 200
    assert set_cookies(response)[SESSION_COOKIE]["secure"] is True


def test_a_new_sign_in_replaces_the_presented_session(local: TestClient) -> None:
    assert dev_login(local, "viewer").status_code == 200
    first = run_db(local, session_hashes)
    assert dev_login(local, "admin").status_code == 200
    second = run_db(local, session_hashes)
    assert len(first) == len(second) == 1
    assert first != second
    assert local.get("/api/auth/session").json()["user"]["role"] == "admin"


async def expire_sessions(db: AsyncSession) -> None:
    await db.execute(update(UserSession).values(expires_at=utcnow() - timedelta(seconds=1)))


async def disable_user(db: AsyncSession) -> None:
    await db.execute(update(User).where(User.email == "viewer@example.com").values(disabled=True))


async def bump_auth_version(db: AsyncSession) -> None:
    await db.execute(
        update(User)
        .where(User.email == "viewer@example.com")
        .values(auth_version=User.auth_version + 1)
    )


async def delete_user(db: AsyncSession) -> None:
    await db.execute(delete(User).where(User.email == "viewer@example.com"))


async def revoke(db: AsyncSession) -> None:
    user = await db.scalar(select(User).where(User.email == "viewer@example.com"))
    assert user is not None
    await revoke_user_sessions(db, user)


@pytest.mark.parametrize(
    "invalidate", [expire_sessions, disable_user, bump_auth_version, delete_user, revoke]
)
def test_sessions_must_be_unexpired_enabled_and_current(
    probe: TestClient, invalidate: Any
) -> None:
    user_id = login_as(probe, "viewer", name="Vera")
    assert probe.get("/api/probe/user").json() == {
        "id": user_id,
        "email": "viewer@example.com",
        "role": "viewer",
    }
    assert probe.get("/api/auth/session").json() == {
        "authenticated": True,
        "user": {
            "id": user_id,
            "email": "viewer@example.com",
            "name": "Vera",
            "role": "viewer",
            "has_password": False,
        },
    }

    async def apply(db: AsyncSession) -> None:
        await invalidate(db)
        await db.commit()

    run_db(probe, apply)
    response = probe.get("/api/probe/user")
    assert response.status_code == 401
    assert response.json() == {"code": "authentication_required"}
    assert probe.get("/api/auth/session").json() == ANONYMOUS


@pytest.mark.parametrize(
    "value", ["", "abc", "A" * 64, "g" * 64, "0" * 63, "0" * 65, secrets.token_hex(32)]
)
def test_unknown_or_malformed_session_cookies_are_anonymous(probe: TestClient, value: str) -> None:
    probe.cookies.set(SESSION_COOKIE, value, domain=cookie_domain(probe), path="/api")
    assert probe.get("/api/probe/user").status_code == 401
    assert probe.get("/api/auth/session").json() == ANONYMOUS


def test_the_stored_hash_is_not_a_usable_token(probe: TestClient, config: Settings) -> None:
    login_as(probe, "admin")
    [stored] = run_db(probe, session_hashes)
    probe.cookies.set(SESSION_COOKIE, stored, domain=cookie_domain(probe), path="/api")
    assert probe.get("/api/auth/session").json() == ANONYMOUS


def test_revoking_signs_out_every_session_of_that_user_only(probe: TestClient) -> None:
    ana = login_as(probe, "viewer", email="ana@example.com")
    login_as(probe, "viewer", email="ana@example.com")
    luis = login_as(probe, "viewer", email="luis@example.com")

    async def revoke_ana(db: AsyncSession) -> tuple[int, list[int]]:
        user = await db.get(User, ana)
        assert user is not None
        await revoke_user_sessions(db, user)
        await db.commit()
        return user.auth_version, list(await db.scalars(select(UserSession.user_id)))

    version, owners = run_db(probe, revoke_ana)
    assert version == 2
    assert owners == [luis]
    assert probe.get("/api/auth/session").json()["user"]["id"] == luis


def test_admin_routes_require_the_admin_role(probe: TestClient) -> None:
    anonymous = probe.get("/api/admin/probe")
    assert anonymous.status_code == 401
    assert anonymous.json() == {"code": "authentication_required"}

    login_as(probe, "viewer")
    for path in ("/api/admin/probe", "/api/admin/users"):
        response = probe.get(path)
        assert response.status_code == 403, path
        assert response.json() == {"code": "admin_required"}
    assert probe.get("/api/probe/user").status_code == 200

    admin_id = login_as(probe, "admin")
    assert probe.get("/api/admin/probe").json() == {"id": admin_id}


def test_admin_and_viewer_fixtures(admin: TestClient) -> None:
    user = admin.get("/api/auth/session").json()["user"]
    assert (user["email"], user["role"]) == ("admin@example.com", "admin")
    login_as(admin, "viewer")
    assert admin.get("/api/auth/session").json()["user"]["role"] == "viewer"


def test_viewer_fixture(viewer: TestClient) -> None:
    user = viewer.get("/api/auth/session").json()["user"]
    assert (user["email"], user["role"]) == ("viewer@example.com", "viewer")
    assert viewer.get("/api/admin/users").json() == {"code": "admin_required"}


def test_logout_deletes_the_session_and_clears_cookies(probe: TestClient) -> None:
    login_as(probe, "admin")
    login_as(probe, "admin")  # a second session (another device) survives

    response = probe.post("/api/auth/logout")
    assert response.status_code == 204
    assert response.content == b""
    cookies = set_cookies(response)
    assert (cookies[SESSION_COOKIE]["max-age"], cookies[SESSION_COOKIE]["path"]) == ("0", "/api")
    assert (cookies[GOOGLE_COOKIE]["max-age"], cookies[GOOGLE_COOKIE]["path"]) == (
        "0",
        "/api/auth",
    )
    assert len(run_db(probe, session_hashes)) == 1
    assert probe.get("/api/auth/session").json() == ANONYMOUS

    assert probe.post("/api/auth/logout").status_code == 204
    probe.cookies.clear()
    assert probe.post("/api/auth/logout").status_code == 204
    forged = probe.post("/api/auth/logout", headers={"x-timelife-request": "0"})
    assert forged.status_code == 403
    assert forged.json() == {"code": "invalid_origin"}


def test_logout_abandons_the_browser_google_flow(probe: TestClient, config: Settings) -> None:
    browser = secrets.token_hex(32)
    expires = utcnow() + timedelta(minutes=10)

    async def add_flows(db: AsyncSession) -> None:
        for state, binding in (("a" * 64, access_hash(config, "google-browser", browser)),
                               ("b" * 64, "c" * 64)):
            db.add(
                GoogleAuthFlow(
                    state_hash=state,
                    browser_hash=binding,
                    origin=TEST_ORIGIN,
                    return_path="/",
                    expires_at=expires,
                )
            )
        await db.commit()

    async def flows(db: AsyncSession) -> list[str]:
        return list(await db.scalars(select(GoogleAuthFlow.state_hash)))

    run_db(probe, add_flows)
    probe.cookies.set(GOOGLE_COOKIE, browser, domain=cookie_domain(probe), path="/api/auth")
    assert probe.post("/api/auth/logout").status_code == 204
    assert run_db(probe, flows) == ["b" * 64]


def test_dev_login_is_not_found_unless_enabled(client: TestClient) -> None:
    assert client.get("/api/auth/config").json()["dev_login_enabled"] is False
    for body in ({"username": "admin", "password": "admin"}, {"username": "root"}, None):
        response = client.post("/api/auth/dev-login", json=body)
        assert response.status_code == 404, body
        assert response.json() == {"code": "not_found"}


def test_dev_login_is_refused_on_non_loopback_origins(config: Settings) -> None:
    # Settings validation forbids this combination; a hand-built object must still not expose it.
    unsafe = config.model_copy(update={"allow_insecure_local_login": True})
    assert unsafe.dev_login_enabled
    with app_client(unsafe) as client:
        assert client.get("/api/auth/config").json()["dev_login_enabled"] is False
        response = client.post(
            "/api/auth/dev-login", json={"username": "admin", "password": "admin"}
        )
    assert response.status_code == 404
    assert response.json() == {"code": "not_found"}


def test_dev_login_creates_and_restores_the_dev_accounts(local: TestClient) -> None:
    future, past = utcnow() + timedelta(days=1), utcnow() - timedelta(days=1)

    async def prepare(db: AsyncSession) -> int:
        demoted = User(
            email="dev-viewer@example.com", role="admin", disabled=True, auth_version=2
        )
        stranger = User(email="old@example.com", role="viewer")
        db.add_all([demoted, stranger])
        await db.flush()
        db.add_all(
            [
                UserSession(
                    token_hash="f" * 64, user_id=demoted.id, auth_version=2, expires_at=future
                ),
                UserSession(
                    token_hash="e" * 64, user_id=stranger.id, auth_version=1, expires_at=past
                ),
            ]
        )
        await db.commit()
        return demoted.id

    viewer_id = run_db(local, prepare)
    response = dev_login(local, "viewer")
    assert response.status_code == 200
    assert response.json()["user"] == {
        "id": viewer_id,
        "email": "dev-viewer@example.com",
        "name": None,
        "role": "viewer",
        "has_password": False,
    }

    async def state(db: AsyncSession) -> tuple[str, bool, int, list[str]]:
        user = await db.get(User, viewer_id)
        assert user is not None
        return user.role, user.disabled, user.auth_version, await session_hashes(db)

    role, disabled, version, hashes = run_db(local, state)
    assert (role, disabled, version) == ("viewer", False, 3)
    # The live session predating the role change and the expired one are both gone.
    assert len(hashes) == 1 and not {"f" * 64, "e" * 64} & set(hashes)

    admin = dev_login(local, "admin")
    assert admin.json()["user"]["email"] == "dev-admin@example.com"
    assert admin.json()["user"]["role"] == "admin"


@pytest.mark.parametrize(
    "body",
    [
        {"username": "root", "password": DEV_PASSWORD},
        {"username": "admin", "password": ""},
        {"username": "admin", "password": "x" * 201},
        {"username": "admin"},
        {"username": "admin", "password": DEV_PASSWORD, "extra": 1},
    ],
)
def test_dev_login_validates_its_body(local: TestClient, body: dict[str, Any]) -> None:
    response = local.post("/api/auth/dev-login", json=body)
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"


def test_dev_login_throttles_failed_attempts(local: TestClient) -> None:
    for attempt in range(10):
        response = dev_login(local, "admin", "wrong password")
        assert response.status_code == 401, attempt
        assert response.json() == {"code": "invalid_credentials"}
        assert "set-cookie" not in response.headers

    blocked = dev_login(local, "admin")
    assert blocked.status_code == 429
    assert blocked.json() == {"code": "login_throttled"}
    assert blocked.headers["retry-after"] == "300"
    assert "set-cookie" not in blocked.headers

    # Per identity, and successful sign-ins never count.
    for _ in range(12):
        assert dev_login(local, "viewer").status_code == 200

    async def expire_windows(db: AsyncSession) -> None:
        await db.execute(update(AuthLimit).values(expires_at=utcnow() - timedelta(seconds=1)))
        await db.commit()

    run_db(local, expire_windows)
    assert dev_login(local, "admin").status_code == 200


def fake_request(config: Settings, host: str = "203.0.113.5") -> Request:
    app = SimpleNamespace(state=SimpleNamespace(settings=config))
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [],
            "query_string": b"",
            "client": (host, 4321),
            "app": app,
        }
    )


async def test_throttle_counts_per_ip_and_per_identity(
    sessions: Sessions, config: Settings
) -> None:
    request = fake_request(config)
    limits = {"limit": 2, "ip_limit": 3}
    async with sessions() as db:
        await throttle(db, request, "probe", "ana", **limits)
        await throttle(db, request, "probe", "ana", **limits)
        assert await throttled(db, request, "probe", "ana", **limits)
        with pytest.raises(AppError) as error:
            await throttle(db, request, "probe", "ana", **limits)
        assert (error.value.code, error.value.status) == ("request_throttled", 429)
        assert error.value.headers == {"Retry-After": "300"}

        # A fourth attempt from that IP exceeds the IP limit whatever the identity.
        with pytest.raises(AppError):
            await throttle(db, request, "probe", "luis", **limits)
        await throttle(db, fake_request(config, "198.51.100.7"), "probe", "luis", **limits)
        await throttle(db, request, "other-scope", "ana", **limits)
        with pytest.raises(AppError) as custom:
            await throttle(db, request, "solo", limit=1, ip_limit=0, code="login_throttled")
        assert custom.value.code == "login_throttled"

        keys = list(await db.scalars(select(AuthLimit.key)))
        assert keys and all(re.fullmatch(r"[0-9a-f]{64}", key) for key in keys)

        await db.execute(update(AuthLimit).values(expires_at=utcnow() - timedelta(seconds=1)))
        await db.commit()
        assert not await throttled(db, request, "probe", "ana", **limits)
        await throttle(db, request, "probe", "ana", **limits)
        assert await db.scalar(select(func.max(AuthLimit.hits))) == 1


async def test_expired_rows_are_purged_at_startup(config: Settings, sessions: Sessions) -> None:
    past, future = utcnow() - timedelta(minutes=1), utcnow() + timedelta(minutes=10)
    async with sessions() as db:
        user = User(email="ana@example.com", role="viewer")
        db.add(user)
        await db.flush()
        db.add_all(
            [
                UserSession(token_hash="1" * 64, user_id=user.id, auth_version=1, expires_at=past),
                UserSession(
                    token_hash="2" * 64, user_id=user.id, auth_version=1, expires_at=future
                ),
                AuthLimit(key="5" * 64, hits=3, expires_at=past),
                AuthLimit(key="6" * 64, hits=3, expires_at=future),
            ]
        )
        for state, expires in (("3" * 64, past), ("4" * 64, future)):
            db.add(
                GoogleAuthFlow(
                    state_hash=state,
                    browser_hash="9" * 64,
                    origin=TEST_ORIGIN,
                    return_path="/",
                    expires_at=expires,
                )
            )
        await db.commit()

    with TestClient(create_app(config)):
        pass

    async with sessions() as db:
        assert list(await db.scalars(select(UserSession.token_hash))) == ["2" * 64]
        assert list(await db.scalars(select(GoogleAuthFlow.state_hash))) == ["4" * 64]
        assert list(await db.scalars(select(AuthLimit.key))) == ["6" * 64]
