"""User administration (``/api/admin/users``): access control, listing, new users and their
temporary passwords, role and state changes with their guards and session revocation, password
resets, and deletion."""

import asyncio
import uuid
from collections.abc import Awaitable, Callable, Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from timelife import users
from timelife.auth import SESSION_COOKIE, revoke_user_sessions
from timelife.config import Settings
from timelife.contracts import Role
from timelife.db import Event, Image, PasswordReset, User, UserSession, utcnow
from timelife.passwords import verify_password_now

from .conftest import TEST_ORIGIN, app_client, cookie_domain, csrf_headers, login_as, run_db

USERS = "/api/admin/users"
ANONYMOUS = {"authenticated": False, "user": None}
PASSWORD = "temporal-1234"
GOOGLE_ORIGIN = "https://timelife.example.com"
Body = dict[str, Any] | None
REMOVALS: list[tuple[str, Body]] = [
    ("PATCH", {"role": "viewer"}),
    ("PATCH", {"disabled": True}),
    ("DELETE", None),
]
LONG_DOMAIN = ".".join(["a" * 63, "b" * 63, "c" * 63]) + ".com"


def address(length: int) -> str:
    """An e-mail address of exactly ``length`` characters (254 at most fit ``users.email``)."""
    return "x" * (length - len(LONG_DOMAIN) - 1) + "@" + LONG_DOMAIN


def add_user(client: TestClient, email: str, role: Role = "viewer", **values: Any) -> int:
    """Insert a user directly in the database and return its id."""

    async def create(db: AsyncSession) -> int:
        user = User(email=email, role=role, **values)
        db.add(user)
        await db.commit()
        return user.id

    return run_db(client, create)


def stored_user(client: TestClient, user_id: int) -> User | None:
    return run_db(client, lambda db: db.get(User, user_id))


def session_count(client: TestClient, user_id: int) -> int:
    async def count(db: AsyncSession) -> int:
        query = select(func.count()).where(UserSession.user_id == user_id)
        return await db.scalar(query) or 0

    return run_db(client, count)


async def emails(db: AsyncSession) -> list[str]:
    return list(await db.scalars(select(User.email).order_by(User.email)))


def session_token(client: TestClient) -> str:
    """The ``timelife_session`` cookie ``client`` sends now."""
    token = client.cookies.get(SESSION_COOKIE)
    assert token
    return token


def use_session(client: TestClient, token: str) -> None:
    client.cookies.set(SESSION_COOKIE, token, domain=cookie_domain(client), path="/api")


def session_valid(client: TestClient, token: str) -> bool:
    """Switch ``client`` to the session ``token`` and tell whether it is still signed in."""
    use_session(client, token)
    return client.get("/api/auth/session").json() != ANONYMOUS


@pytest.fixture
def with_google(config_factory: Callable[..., Settings]) -> Iterator[TestClient]:
    """Application with Google sign-in configured (HTTPS origin), signed in as admin@."""
    config = config_factory(
        public_origin=GOOGLE_ORIGIN,
        auth_cookie_secure=True,
        google_client_id="1234-abc.apps.googleusercontent.com",
        google_client_secret="client-secret",
    )
    with app_client(config) as client:
        login_as(client, "admin")
        yield client


# Access


def test_every_endpoint_requires_an_administrator(client: TestClient) -> None:
    endpoints: list[tuple[str, str, Body]] = [
        ("GET", USERS, None),
        ("POST", USERS, {"email": "nuevo@example.com", "password": PASSWORD}),
        ("PATCH", f"{USERS}/1", {"role": "admin"}),
        ("PUT", f"{USERS}/1/password", {"password": PASSWORD}),
        ("DELETE", f"{USERS}/1", None),
    ]
    for method, path, body in endpoints:
        response = client.request(method, path, json=body)
        assert response.status_code == 401, method
        assert response.json() == {"code": "authentication_required"}

    viewer = login_as(client, "viewer")
    for method, path, body in endpoints:
        response = client.request(method, path, json=body)
        assert response.status_code == 403, method
        assert response.json() == {"code": "admin_required"}

    assert run_db(client, emails) == ["viewer@example.com"]
    user = stored_user(client, viewer)
    assert user is not None and user.role == "viewer"


def test_mutations_need_the_same_origin_csrf_header(admin: TestClient) -> None:
    ana = add_user(admin, "ana@example.com")
    mutations: list[tuple[str, str, Body]] = [
        ("POST", USERS, {"email": "nuevo@example.com", "password": PASSWORD}),
        ("PATCH", f"{USERS}/{ana}", {"role": "admin"}),
        ("PUT", f"{USERS}/{ana}/password", {"password": PASSWORD}),
        ("DELETE", f"{USERS}/{ana}", None),
    ]
    for method, path, body in mutations:
        foreign = admin.request(
            method, path, json=body, headers=csrf_headers("https://evil.example")
        )
        assert foreign.status_code == 403, method
        assert foreign.json() == {"code": "invalid_origin"}

    del admin.headers["x-timelife-request"]
    for method, path, body in mutations:
        missing = admin.request(method, path, json=body)
        assert missing.status_code == 403, method
        assert missing.json() == {"code": "invalid_origin"}

    assert admin.get(USERS).status_code == 200  # reads need no CSRF header
    assert run_db(admin, emails) == ["admin@example.com", "ana@example.com"]
    user = stored_user(admin, ana)
    assert user is not None and (user.role, user.password_hash) == ("viewer", None)


# Listing


def test_list_puts_admins_first_then_sorts_by_email(admin: TestClient) -> None:
    me = login_as(admin, "admin")
    zoe = add_user(
        admin,
        "zoe@example.com",
        "admin",
        name="Zoe",
        disabled=True,
        google_subject="google-zoe",
        invited_by_id=me,
        created_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC),
        last_login_at=datetime(2026, 2, 3, 4, 5, 6, tzinfo=UTC),
    )
    add_user(admin, "carlos@example.com", "admin", password_hash="scrypt$…")
    # Code-point order, whatever the database collation (which may ignore punctuation).
    for email in ("ab@example.com", "a.b@example.com", "a-c@example.com"):
        add_user(admin, email)
    add_user(
        admin, "aitor@example.com", google_subject="google-aitor", password_hash="scrypt$…",
        must_change_password=True,
    )

    response = admin.get(USERS)
    assert response.status_code == 200
    listed = response.json()
    assert [
        (user["email"], user["role"], user["google_linked"], user["has_password"])
        for user in listed
    ] == [
        ("admin@example.com", "admin", False, False),
        ("carlos@example.com", "admin", False, True),
        ("zoe@example.com", "admin", True, False),
        ("a-c@example.com", "viewer", False, False),
        ("a.b@example.com", "viewer", False, False),
        ("ab@example.com", "viewer", False, False),
        ("aitor@example.com", "viewer", True, True),
    ]
    assert [user["must_change_password"] for user in listed] == [False] * 6 + [True]
    assert listed[2] == {
        "id": zoe,
        "email": "zoe@example.com",
        "name": "Zoe",
        "role": "admin",
        "disabled": True,
        "google_linked": True,
        "has_password": False,
        "must_change_password": False,
        "created_at": "2026-01-02T03:04:05Z",
        "last_login_at": "2026-02-03T04:05:06Z",
    }
    assert listed[0]["id"] == me
    assert listed[0]["name"] is None and listed[0]["last_login_at"] is None
    assert "password_hash" not in response.text


# Invitations


def test_create_adds_a_user_with_a_temporary_password(admin: TestClient) -> None:
    me = login_as(admin, "admin")
    before = utcnow()
    response = admin.post(
        USERS,
        json={
            "email": "  Ana.Garcia@Example.COM ",
            "name": "  Ana \n García ",
            "role": "admin",
            "password": f" {PASSWORD} ",
        },
    )
    assert response.status_code == 201
    created = response.json()
    assert created == {
        "id": created["id"],
        "email": "ana.garcia@example.com",
        "name": "Ana García",
        "role": "admin",
        "disabled": False,
        "google_linked": False,
        "has_password": True,
        "must_change_password": True,
        "created_at": created["created_at"],
        "last_login_at": None,
    }
    assert before <= datetime.fromisoformat(created["created_at"]) <= utcnow()
    user = stored_user(admin, created["id"])
    assert user is not None
    assert (user.invited_by_id, user.auth_version, user.google_subject) == (me, 1, None)
    # Stored hashed, exactly as typed (spaces included).
    assert user.password_hash is not None and PASSWORD not in user.password_hash
    assert verify_password_now(f" {PASSWORD} ", user.password_hash)
    assert not verify_password_now(PASSWORD, user.password_hash)

    viewer = admin.post(
        USERS, json={"email": "luis@example.com", "name": "   ", "password": PASSWORD}
    )
    assert viewer.status_code == 201
    assert (viewer.json()["role"], viewer.json()["name"]) == ("viewer", None)
    longest = admin.post(USERS, json={"email": address(254), "password": PASSWORD})
    assert longest.status_code == 201
    assert [user["email"] for user in admin.get(USERS).json()] == [
        "admin@example.com",
        "ana.garcia@example.com",
        "luis@example.com",
        address(254),
    ]


def test_without_google_a_new_user_needs_a_password(admin: TestClient) -> None:
    for body in ({"email": "ana@example.com"}, {"email": "ana@example.com", "password": None}):
        response = admin.post(USERS, json=body)
        assert response.status_code == 422
        assert response.json() == {"code": "invalid_request", "fields": {"password": "missing"}}
    assert run_db(admin, emails) == ["admin@example.com"]


def test_with_google_the_password_is_optional(with_google: TestClient) -> None:
    google_only = with_google.post(USERS, json={"email": "ana@example.com"})
    assert google_only.status_code == 201
    assert (google_only.json()["has_password"], google_only.json()["must_change_password"]) == (
        False,
        False,
    )
    both = with_google.post(USERS, json={"email": "luis@example.com", "password": PASSWORD})
    assert both.status_code == 201
    assert (both.json()["has_password"], both.json()["must_change_password"]) == (True, True)


def test_create_rejects_existing_addresses_in_any_case(admin: TestClient) -> None:
    ana = add_user(admin, "ana@example.com", name="Ana")
    for email in ("ana@example.com", "ANA@Example.com", " ana@EXAMPLE.com ", "admin@example.com"):
        body = {"email": email, "role": "admin", "name": "Otra", "password": PASSWORD}
        response = admin.post(USERS, json=body)
        assert response.status_code == 409, email
        assert response.json() == {"code": "user_exists"}
    assert run_db(admin, emails) == ["admin@example.com", "ana@example.com"]
    user = stored_user(admin, ana)
    assert user is not None
    assert (user.role, user.name, user.password_hash) == ("viewer", "Ana", None)


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"email": "not-an-email"}, "email"),
        ({"email": "ana@"}, "email"),
        ({"email": "  "}, "email"),
        ({"email": address(255)}, "email"),
        ({}, "email"),
        ({"email": "ana@example.com", "role": "owner"}, "role"),
        ({"email": "ana@example.com", "name": "x" * 121}, "name"),
        ({"email": "ana@example.com", "name": "Ana\x00"}, "name"),
        ({"email": "ana@example.com", "disabled": True}, "disabled"),
        ({"email": "ana@example.com", "password": "corta12"}, "password"),
        ({"email": "ana@example.com", "password": "x" * 201}, "password"),
        ({"email": "ana@example.com", "password": " " * 12}, "password"),
        ({"email": "ana@example.com", "password": "contraseña\x00larga"}, "password"),
        ({"email": "ana@example.com", "password": 12345678}, "password"),
        (
            {"email": "ana@example.com", "password": PASSWORD, "must_change_password": False},
            "must_change_password",
        ),
    ],
)
def test_create_validates_the_body(admin: TestClient, body: dict[str, Any], field: str) -> None:
    response = admin.post(USERS, json=body)
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"
    assert field in response.json()["fields"]
    assert run_db(admin, emails) == ["admin@example.com"]


def test_an_invitation_losing_a_race_is_a_conflict(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    app: Any = admin.app
    email_taken = users.email_taken
    checks: list[str] = []

    async def invited_meanwhile(db: AsyncSession, email: str) -> bool:
        checks.append(email)
        taken = await email_taken(db, email)
        if len(checks) == 1:  # another administrator invites the address right after the check
            async with app.state.sessions() as other:
                other.add(User(email=email, role="admin", name="Otra"))
                await other.commit()
        return taken

    monkeypatch.setattr(users, "email_taken", invited_meanwhile)
    response = admin.post(USERS, json={"email": "Ana@Example.com", "password": PASSWORD})
    assert response.status_code == 409
    assert response.json() == {"code": "user_exists"}
    assert checks == ["ana@example.com", "ana@example.com"]
    assert [(user["email"], user["role"], user["name"]) for user in admin.get(USERS).json()] == [
        ("admin@example.com", "admin", None),
        ("ana@example.com", "admin", "Otra"),
    ]


def test_other_integrity_errors_are_not_reported_as_duplicates(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    app: Any = admin.app
    me = login_as(admin, "admin")
    email_taken = users.email_taken

    async def inviter_deleted_meanwhile(db: AsyncSession, email: str) -> bool:
        async with app.state.sessions() as other:
            await other.execute(delete(User).where(User.id == me))
            await other.commit()
        return await email_taken(db, email)

    monkeypatch.setattr(users, "email_taken", inviter_deleted_meanwhile)
    response = admin.post(USERS, json={"email": "ana@example.com", "password": PASSWORD})
    assert (response.status_code, response.json()) == (500, {"code": "internal_error"})


# Changes


def test_update_renames_anyone_including_yourself(admin: TestClient) -> None:
    me = login_as(admin, "admin")
    ana = add_user(admin, "ana@example.com", name="Ana")

    renamed = admin.patch(f"{USERS}/{me}", json={"name": "  Yo   Mismo "})
    assert renamed.status_code == 200
    assert (renamed.json()["id"], renamed.json()["name"]) == (me, "Yo Mismo")
    assert admin.get("/api/auth/session").json()["user"]["name"] == "Yo Mismo"

    cleared = admin.patch(f"{USERS}/{ana}", json={"name": ""})
    assert cleared.status_code == 200
    assert cleared.json()["name"] is None
    unchanged = admin.patch(f"{USERS}/{ana}", json={})
    assert unchanged.status_code == 200
    assert unchanged.json() == cleared.json()
    named = admin.patch(f"{USERS}/{ana}", json={"name": "Ana", "role": None, "disabled": None})
    assert named.json() == {**cleared.json(), "name": "Ana"}
    nulled = admin.patch(f"{USERS}/{ana}", json={"name": None})
    assert nulled.json()["name"] is None

    for user_id in (me, ana):
        user = stored_user(admin, user_id)
        assert user is not None and user.auth_version == 1


def test_role_and_state_changes_sign_the_user_out(admin: TestClient) -> None:
    ana = login_as(admin, "viewer", email="ana@example.com")
    phone = session_token(admin)
    login_as(admin, "viewer", email="ana@example.com")
    laptop = session_token(admin)
    login_as(admin, "admin")

    promoted = admin.patch(f"{USERS}/{ana}", json={"role": "admin"})
    assert promoted.status_code == 200
    assert (promoted.json()["role"], promoted.json()["disabled"]) == ("admin", False)
    assert admin.get(USERS).status_code == 200  # the acting administrator stays signed in
    assert session_count(admin, ana) == 0
    assert not session_valid(admin, phone)
    assert not session_valid(admin, laptop)

    login_as(admin, "admin", email="ana@example.com")  # signing in again picks up the new role
    assert admin.get(USERS).status_code == 200
    as_admin = session_token(admin)

    login_as(admin, "admin")
    disabled = admin.patch(f"{USERS}/{ana}", json={"disabled": True})
    assert disabled.status_code == 200
    assert (disabled.json()["role"], disabled.json()["disabled"]) == ("admin", True)
    use_session(admin, as_admin)
    response = admin.get(USERS)
    assert response.status_code == 401
    assert response.json() == {"code": "authentication_required"}
    login_as(admin, "admin", email="ana@example.com")
    assert admin.get("/api/auth/session").json() == ANONYMOUS  # disabled users cannot sign in

    login_as(admin, "admin")
    restored = admin.patch(f"{USERS}/{ana}", json={"role": "viewer", "disabled": False})
    assert restored.status_code == 200
    assert (restored.json()["role"], restored.json()["disabled"]) == ("viewer", False)
    user = stored_user(admin, ana)
    assert user is not None and user.auth_version == 4
    login_as(admin, "viewer", email="ana@example.com")
    assert admin.get("/api/auth/session").json()["user"]["role"] == "viewer"


def test_unchanged_role_and_state_keep_sessions(admin: TestClient) -> None:
    ana = login_as(admin, "viewer", email="ana@example.com", name="Ana")
    token = session_token(admin)
    login_as(admin, "admin")

    response = admin.patch(f"{USERS}/{ana}", json={"role": "viewer", "disabled": False})
    assert response.status_code == 200
    user = stored_user(admin, ana)
    assert user is not None and user.auth_version == 1
    assert session_valid(admin, token)


@pytest.mark.parametrize(
    "body",
    [
        {"role": "owner"},
        {"disabled": "maybe"},
        {"name": "x" * 121},
        {"name": "Ana\x07"},
        {"email": "nuevo@example.com"},
        {"auth_version": 9},
    ],
)
def test_update_validates_the_body(admin: TestClient, body: dict[str, Any]) -> None:
    ana = add_user(admin, "ana@example.com", name="Ana")
    response = admin.patch(f"{USERS}/{ana}", json=body)
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"
    user = stored_user(admin, ana)
    assert user is not None and (user.email, user.name, user.role) == (
        "ana@example.com",
        "Ana",
        "viewer",
    )


def test_unknown_users_and_invalid_ids(admin: TestClient) -> None:
    for method, path, body in [
        ("PATCH", "", {"name": "X"}),
        ("PUT", "/password", {"password": PASSWORD}),
        *((method, "", body) for method, body in REMOVALS),
    ]:
        response = admin.request(method, f"{USERS}/999999{path}", json=body)
        assert response.status_code == 404, (method, body)
        assert response.json() == {"code": "user_not_found"}
    for user_id in ("0", "-1", "abc", "2147483648"):
        for method, path, body in (
            ("PATCH", "", {}),
            ("PUT", "/password", {"password": PASSWORD}),
            ("DELETE", "", None),
        ):
            response = admin.request(method, f"{USERS}/{user_id}{path}", json=body)
            assert response.status_code == 422, (method, user_id)
            assert response.json()["code"] == "invalid_request"


# Guards


def test_nobody_changes_their_own_access_or_deletes_themselves(admin: TestClient) -> None:
    me = login_as(admin, "admin")
    add_user(admin, "ana@example.com", "admin")  # not the last admin: only the self rule applies
    for method, body in [*REMOVALS, ("PATCH", {"role": "viewer", "name": "Yo"})]:
        response = admin.request(method, f"{USERS}/{me}", json=body)
        assert response.status_code == 409, (method, body)
        assert response.json() == {"code": "cannot_modify_self"}
    # Your own password changes from your menu (it asks for the current one).
    own = admin.put(f"{USERS}/{me}/password", json={"password": PASSWORD})
    assert (own.status_code, own.json()) == (409, {"code": "cannot_modify_self"})

    same = admin.patch(f"{USERS}/{me}", json={"role": "admin", "disabled": False})
    assert same.status_code == 200
    user = stored_user(admin, me)
    assert user is not None
    assert (user.role, user.disabled, user.name, user.auth_version) == ("admin", False, None, 1)
    assert user.password_hash is None
    assert admin.get(USERS).status_code == 200


def test_an_admin_can_remove_another_admin(admin: TestClient) -> None:
    ana = login_as(admin, "admin", email="ana@example.com")
    token = session_token(admin)
    me = login_as(admin, "admin")

    demoted = admin.patch(f"{USERS}/{ana}", json={"role": "viewer"})
    assert demoted.status_code == 200  # two enabled admins: one of them may go
    assert not session_valid(admin, token)
    login_as(admin, "admin")
    restored = admin.patch(f"{USERS}/{ana}", json={"role": "admin"})
    assert restored.status_code == 200
    assert admin.delete(f"{USERS}/{ana}").status_code == 204
    assert [user["id"] for user in admin.get(USERS).json()] == [me]


@pytest.mark.parametrize(("method", "body"), REMOVALS)
def test_the_last_enabled_admin_survives_a_lost_race(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch, method: str, body: Body
) -> None:
    """admin@ and ana@, the two enabled admins, remove each other at the same time. ana's request
    commits first, so admin@'s request (authenticated while both were admins) must find its
    target the last enabled admin."""
    app: Any = admin.app
    me = login_as(admin, "admin")
    ana = add_user(admin, "ana@example.com", "admin")
    add_user(admin, "beto@example.com", "admin", disabled=True)  # disabled admins do not count
    lock_users = users.lock_users

    async def removed_meanwhile(
        db: AsyncSession, user_id: int, *, admins: bool
    ) -> tuple[User, int]:
        async with app.state.sessions() as other:
            user = await other.get(User, me)
            assert user is not None
            user.role = "viewer"
            await revoke_user_sessions(other, user)
            await other.commit()
        return await lock_users(db, user_id, admins=admins)

    monkeypatch.setattr(users, "lock_users", removed_meanwhile)
    response = admin.request(method, f"{USERS}/{ana}", json=body)
    assert response.status_code == 409
    assert response.json() == {"code": "last_admin"}
    survivor = stored_user(admin, ana)
    assert survivor is not None
    assert (survivor.role, survivor.disabled, survivor.auth_version) == ("admin", False, 1)


def test_concurrent_mutual_demotions_keep_one_admin(
    admin: TestClient, config: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    if make_url(config.database_url).get_backend_name() != "postgresql":
        pytest.skip("needs PostgreSQL row locks (set TEST_DATABASE_URL)")
    app: Any = admin.app
    me = login_as(admin, "admin")
    mine = session_token(admin)
    ana = login_as(admin, "admin", email="ana@example.com")
    anas = session_token(admin)
    lock_users = users.lock_users
    authenticated = asyncio.Barrier(2)

    async def together(db: AsyncSession, user_id: int, *, admins: bool) -> tuple[User, int]:
        async with asyncio.timeout(10):
            await authenticated.wait()  # both requests passed authentication before locking
        return await lock_users(db, user_id, admins=admins)

    monkeypatch.setattr(users, "lock_users", together)

    async def demote_each_other() -> list[httpx.Response]:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url=TEST_ORIGIN) as http:

            def demote(user_id: int, token: str) -> Awaitable[httpx.Response]:
                headers = {**csrf_headers(), "cookie": f"{SESSION_COOKIE}={token}"}
                return http.patch(f"{USERS}/{user_id}", json={"role": "viewer"}, headers=headers)

            return list(await asyncio.gather(demote(ana, mine), demote(me, anas)))

    assert admin.portal is not None
    responses = admin.portal.call(demote_each_other)
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert [r.json() for r in responses if r.status_code == 409] == [{"code": "last_admin"}]

    async def enabled_admins(db: AsyncSession) -> list[int]:
        query = select(User.id).where(User.role == "admin", User.disabled.is_(False))
        return list(await db.scalars(query))

    assert len(run_db(admin, enabled_admins)) == 1


# Passwords


async def reset_links(db: AsyncSession) -> list[int]:
    return list(await db.scalars(select(PasswordReset.user_id)))


def test_reset_gives_a_temporary_password_and_signs_the_user_out(admin: TestClient) -> None:
    ana = login_as(admin, "viewer", email="ana@example.com")
    phone = session_token(admin)

    async def add_reset_link(db: AsyncSession) -> None:
        expires = utcnow() + timedelta(hours=1)
        db.add(PasswordReset(token_hash="c" * 64, user_id=ana, expires_at=expires))
        await db.commit()

    run_db(admin, add_reset_link)
    login_as(admin, "admin")
    response = admin.put(f"{USERS}/{ana}/password", json={"password": PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert (body["id"], body["has_password"], body["must_change_password"]) == (ana, True, True)
    user = stored_user(admin, ana)
    assert user is not None and user.password_hash is not None
    assert user.auth_version == 2
    assert verify_password_now(PASSWORD, user.password_hash)
    assert session_count(admin, ana) == 0
    assert not session_valid(admin, phone)
    # Pending "forgot password" links stop working.
    assert run_db(admin, reset_links) == []

    login_as(admin, "admin")
    again = admin.put(f"{USERS}/{ana}/password", json={"password": "otra-temporal-9"})
    assert again.status_code == 200
    user = stored_user(admin, ana)
    assert user is not None and user.password_hash is not None
    assert verify_password_now("otra-temporal-9", user.password_hash)
    assert not verify_password_now(PASSWORD, user.password_hash)
    assert admin.get(USERS).status_code == 200  # the acting administrator stays signed in


def test_reset_works_for_disabled_users_and_other_admins(admin: TestClient) -> None:
    eva = add_user(admin, "eva@example.com", disabled=True)
    ana = add_user(admin, "ana@example.com", "admin", google_subject="google-ana")
    for user_id in (eva, ana):
        response = admin.put(f"{USERS}/{user_id}/password", json={"password": PASSWORD})
        assert response.status_code == 200
        assert response.json()["must_change_password"] is True
    listed = {user["email"]: user for user in admin.get(USERS).json()}
    assert listed["eva@example.com"]["disabled"] is True
    assert (listed["ana@example.com"]["role"], listed["ana@example.com"]["google_linked"]) == (
        "admin",
        True,
    )


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"password": None},
        {"password": "corta12"},
        {"password": " " * 12},
        {"password": "x" * 201},
        {"password": PASSWORD, "temporary": False},
    ],
)
def test_reset_validates_the_body(admin: TestClient, body: dict[str, Any]) -> None:
    ana = add_user(admin, "ana@example.com")
    response = admin.put(f"{USERS}/{ana}/password", json=body)
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"
    user = stored_user(admin, ana)
    assert user is not None and (user.password_hash, user.auth_version) == (None, 1)


# Deletion


def test_delete_removes_the_user_and_their_sessions_but_keeps_history(
    admin: TestClient,
) -> None:
    ana = login_as(admin, "admin", email="ana@example.com")
    token = session_token(admin)
    me = login_as(admin, "admin")
    luis = add_user(admin, "luis@example.com", invited_by_id=ana)

    async def add_history(db: AsyncSession) -> tuple[int, uuid.UUID]:
        event = Event(
            title="Primer diente",
            title_search="primer diente",
            date=date(2026, 3, 12),
            created_by_id=ana,
            updated_by_id=ana,
            deleted_by_id=ana,
            deleted_at=utcnow(),
        )
        db.add(event)
        await db.flush()
        image = Image(
            purpose="event",
            event_id=event.id,
            name="diente",
            original_filename="diente.jpg",
            original_ext="jpg",
            content_type="image/jpeg",
            byte_size=1,
            width=1,
            height=1,
            dominant_color="#ffffff",
            uploaded_by_id=ana,
        )
        db.add(image)
        db.add(PasswordReset(token_hash="d" * 64, user_id=ana, expires_at=utcnow()))
        await db.commit()
        return event.id, image.id

    event_id, image_id = run_db(admin, add_history)
    response = admin.delete(f"{USERS}/{ana}")
    assert response.status_code == 204
    assert response.content == b""

    async def references(db: AsyncSession) -> list[int | None]:
        event = await db.get(Event, event_id)
        image = await db.get(Image, image_id)
        invited = await db.get(User, luis)
        assert event is not None and image is not None and invited is not None
        return [
            event.created_by_id,
            event.updated_by_id,
            event.deleted_by_id,
            image.uploaded_by_id,
            invited.invited_by_id,
        ]

    assert run_db(admin, references) == [None] * 5
    assert stored_user(admin, ana) is None
    assert session_count(admin, ana) == 0
    assert run_db(admin, reset_links) == []
    assert [user["id"] for user in admin.get(USERS).json()] == [me, luis]
    assert not session_valid(admin, token)

    login_as(admin, "admin")
    again = admin.delete(f"{USERS}/{ana}")
    assert again.status_code == 404
    assert again.json() == {"code": "user_not_found"}
    assert admin.delete(f"{USERS}/{luis}").status_code == 204
    assert run_db(admin, emails) == ["admin@example.com"]
