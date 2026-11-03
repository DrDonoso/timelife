"""E-mail and password sign-in (``/api/auth/login``), password changes (``/api/auth/password``)
and "forgot password" links (``/api/auth/password/forgot`` and ``/reset``)."""

import logging
import re
from collections.abc import Callable, Iterator
from datetime import timedelta
from email.message import EmailMessage
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from timelife import password_auth, passwords
from timelife.auth import SESSION_COOKIE, access_hash, purge_expired
from timelife.config import Settings
from timelife.db import PasswordReset, User, UserSession, aware, utcnow
from timelife.passwords import hash_password_now, verify_password_now

from .conftest import TEST_ORIGIN, app_client, cookie_domain, login_as, run_db, set_cookies

PASSWORD = "contraseña de Ana"
NEW_PASSWORD = "una clave nueva"
ANONYMOUS = {"authenticated": False, "user": None}
LINK = re.compile(rf"{TEST_ORIGIN}/reset-password#([0-9a-f]{{64}})\n")


class FakeMailer:
    """Stands in for ``app.state.mailer``: keeps the messages."""

    def __init__(self) -> None:
        self.sent: list[EmailMessage] = []
        self.error: Exception | None = None

    async def send(self, message: EmailMessage) -> None:
        if self.error is not None:
            raise self.error
        self.sent.append(message)

    def token(self) -> str:
        match = LINK.search(self.sent[-1].get_content())
        assert match is not None
        return match[1]


@pytest.fixture
def mailer() -> FakeMailer:
    return FakeMailer()


@pytest.fixture
def smtp_config(config_factory: Callable[..., Settings]) -> Settings:
    return config_factory(smtp_host="smtp.example.com", smtp_from="Timelife <hola@example.com>")


@pytest.fixture
def smtp(smtp_config: Settings, mailer: FakeMailer) -> Iterator[TestClient]:
    with app_client(smtp_config) as client:
        client.app.state.mailer = mailer  # type: ignore[attr-defined]
        yield client


def add_user(
    client: TestClient,
    email: str = "ana@example.com",
    password: str | None = PASSWORD,
    *,
    role: str = "viewer",
    temporary: bool = False,
    **values: Any,
) -> int:
    async def create(db: AsyncSession) -> int:
        user = User(
            email=email,
            role=role,
            password_hash=None if password is None else hash_password_now(password),
            must_change_password=temporary,
            **values,
        )
        db.add(user)
        await db.commit()
        return user.id

    return run_db(client, create)


def stored(client: TestClient, user_id: int) -> User:
    user = run_db(client, lambda db: db.get(User, user_id))
    assert user is not None
    return user


def login(client: TestClient, email: str, password: str, **extra: Any) -> httpx.Response:
    return client.post("/api/auth/login", json={"email": email, "password": password, **extra})


def signed_in(client: TestClient, token: str | None = None) -> bool:
    """Whether ``client`` (switched to the session ``token`` when given) is signed in."""
    if token is not None:
        client.cookies.set(SESSION_COOKIE, token, domain=cookie_domain(client), path="/api")
    return client.get("/api/auth/session").json() != ANONYMOUS


def session_token(client: TestClient) -> str:
    token = client.cookies.get(SESSION_COOKIE)
    assert token
    return token


def count(client: TestClient, model: Any) -> int:
    async def total(db: AsyncSession) -> int:
        return await db.scalar(select(func.count()).select_from(model)) or 0

    return run_db(client, total)


# Signing in


def test_the_password_signs_in(client: TestClient) -> None:
    ana = add_user(client, name="Ana")
    response = login(client, " ANA@Example.com ", PASSWORD)
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "authenticated": True,
        "user": {
            "id": ana,
            "email": "ana@example.com",
            "name": "Ana",
            "role": "viewer",
            "has_password": True,
        },
    }
    cookie = set_cookies(response)[SESSION_COOKIE]
    assert cookie["httponly"] is True and cookie["samesite"].lower() == "strict"
    assert client.get("/api/auth/session").json() == body
    assert stored(client, ana).last_login_at is not None


def test_wrong_credentials_all_look_the_same(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_user(client)
    add_user(client, "luis@example.com", None, google_subject="google-luis")  # Google only
    checked: list[bool] = []
    verify = password_auth.verify_password

    async def spy(password: str, stored_hash: str | None) -> bool:
        checked.append(stored_hash is not None)
        return await verify(password, stored_hash)

    monkeypatch.setattr(password_auth, "verify_password", spy)
    for email, password in [
        ("ana@example.com", "no es esta"),
        ("ana@example.com", PASSWORD.upper()),
        ("nadie@example.com", PASSWORD),
        ("luis@example.com", PASSWORD),
    ]:
        response = login(client, email, password)
        assert (response.status_code, response.json()) == (401, {"code": "invalid_credentials"})
        assert SESSION_COOKIE not in set_cookies(response)
    # Unknown addresses and accounts without a password are checked against a dummy hash, so
    # they take as long as a wrong password.
    assert checked == [True, True, False, False]
    assert count(client, UserSession) == 0


def test_disabled_accounts_are_told_only_with_the_right_password(client: TestClient) -> None:
    add_user(client, disabled=True)
    right = login(client, "ana@example.com", PASSWORD)
    assert (right.status_code, right.json()) == (403, {"code": "account_disabled"})
    wrong = login(client, "ana@example.com", "no es esta")
    assert (wrong.status_code, wrong.json()) == (401, {"code": "invalid_credentials"})
    assert count(client, UserSession) == 0


def test_failed_sign_ins_are_throttled_per_address_and_client(client: TestClient) -> None:
    add_user(client)
    add_user(client, "luis@example.com")
    for _ in range(password_auth.LOGIN_LIMIT):
        assert login(client, "ana@example.com", "no es esta").status_code == 401
    blocked = login(client, "ana@example.com", PASSWORD)
    assert (blocked.status_code, blocked.json()) == (429, {"code": "login_throttled"})
    assert blocked.headers["retry-after"] == "300"
    # Another address is not blocked, and successful sign-ins never count.
    for _ in range(password_auth.LOGIN_LIMIT + 2):
        assert login(client, "luis@example.com", PASSWORD).status_code == 200

    for index in range(password_auth.LOGIN_IP_LIMIT - password_auth.LOGIN_LIMIT):
        assert login(client, f"nadie{index}@example.com", "x").status_code == 401
    everyone = login(client, "luis@example.com", PASSWORD)
    assert (everyone.status_code, everyone.json()) == (429, {"code": "login_throttled"})


def test_a_temporary_password_must_be_replaced_first(client: TestClient) -> None:
    ana = add_user(client, temporary=True)
    login_as(client, "viewer", email="ana@example.com")
    phone = session_token(client)
    client.cookies.clear()

    required = login(client, "ana@example.com", PASSWORD)
    assert (required.status_code, required.json()) == (403, {"code": "password_change_required"})
    assert SESSION_COOKIE not in set_cookies(required)
    # A wrong password reveals nothing, even with a new one.
    wrong = login(client, "ana@example.com", "no es esta", new_password=NEW_PASSWORD)
    assert (wrong.status_code, wrong.json()) == (401, {"code": "invalid_credentials"})
    same = login(client, "ana@example.com", PASSWORD, new_password=PASSWORD)
    assert (same.status_code, same.json()) == (422, {"code": "password_unchanged"})
    short = login(client, "ana@example.com", PASSWORD, new_password="corta")
    assert short.status_code == 422
    assert short.json()["fields"] == {"new_password": "string_too_short"}

    changed = login(client, "ana@example.com", PASSWORD, new_password=NEW_PASSWORD)
    assert changed.status_code == 200
    assert changed.json()["user"]["has_password"] is True
    assert signed_in(client)
    user = stored(client, ana)
    assert user.must_change_password is False
    assert user.password_hash is not None and verify_password_now(NEW_PASSWORD, user.password_hash)
    # Signed out everywhere else; the temporary password is gone.
    assert not signed_in(client, phone)
    assert login(client, "ana@example.com", PASSWORD).status_code == 401
    assert login(client, "ana@example.com", NEW_PASSWORD).status_code == 200


def test_a_new_password_is_ignored_unless_one_is_required(client: TestClient) -> None:
    ana = add_user(client)
    response = login(client, "ana@example.com", PASSWORD, new_password=NEW_PASSWORD)
    assert response.status_code == 200
    user = stored(client, ana)
    assert user.password_hash is not None and verify_password_now(PASSWORD, user.password_hash)


def test_signing_in_upgrades_old_hashes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(passwords, "COST", 2**3)
    ana = add_user(client)
    old = stored(client, ana).password_hash
    monkeypatch.setattr(passwords, "COST", 2**4)
    assert login(client, "ana@example.com", PASSWORD).status_code == 200
    new = stored(client, ana).password_hash
    assert old is not None and old.startswith("scrypt$8$")
    assert new is not None and new.startswith("scrypt$16$")
    assert verify_password_now(PASSWORD, new)


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"email": "ana@example.com"},
        {"password": PASSWORD},
        {"email": "ana", "password": PASSWORD},
        {"email": "ana@example.com", "password": ""},
        {"email": "ana@example.com", "password": "x" * 201},
        {"email": "ana@example.com", "password": PASSWORD, "remember": True},
    ],
)
def test_login_validates_the_body(client: TestClient, body: dict[str, Any]) -> None:
    add_user(client)
    response = client.post("/api/auth/login", json=body)
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"


# Changing your password


def test_changing_the_password_keeps_this_session_and_ends_the_others(
    client: TestClient,
) -> None:
    ana = add_user(client)
    login_as(client, "viewer", email="ana@example.com")
    phone = session_token(client)
    assert login(client, "ana@example.com", PASSWORD).status_code == 200
    laptop = session_token(client)

    async def add_link(db: AsyncSession) -> None:
        expires = utcnow() + timedelta(hours=1)
        db.add(PasswordReset(token_hash="f" * 64, user_id=ana, expires_at=expires))
        await db.commit()

    run_db(client, add_link)
    response = client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "ana@example.com"
    current = set_cookies(response)[SESSION_COOKIE].value
    assert current not in (phone, laptop)
    assert signed_in(client)
    assert not signed_in(client, phone)
    assert not signed_in(client, laptop)
    assert signed_in(client, current)
    user = stored(client, ana)
    assert user.password_hash is not None and verify_password_now(NEW_PASSWORD, user.password_hash)
    assert count(client, PasswordReset) == 0


def test_changing_the_password_checks_the_current_one(client: TestClient) -> None:
    body = {"current_password": PASSWORD, "new_password": NEW_PASSWORD}
    anonymous = client.post("/api/auth/password", json=body)
    assert (anonymous.status_code, anonymous.json()) == (401, {"code": "authentication_required"})

    ana = add_user(client)
    login_as(client, "viewer", email="ana@example.com")
    for payload, status, code in [
        ({**body, "current_password": "no es esta"}, 422, "current_password_invalid"),
        ({**body, "new_password": PASSWORD}, 422, "password_unchanged"),
    ]:
        response = client.post("/api/auth/password", json=payload)
        assert (response.status_code, response.json()["code"]) == (status, code)
    short = client.post("/api/auth/password", json={**body, "new_password": "corta"})
    assert (short.status_code, short.json()["code"]) == (422, "invalid_request")
    assert short.json()["fields"] == {"new_password": "string_too_short"}
    user = stored(client, ana)
    assert user.password_hash is not None and verify_password_now(PASSWORD, user.password_hash)

    login_as(client, "viewer", email="luis@example.com")  # signed in with Google, no password
    none = client.post("/api/auth/password", json=body)
    assert (none.status_code, none.json()) == (409, {"code": "password_not_set"})


def test_wrong_current_passwords_are_throttled(client: TestClient) -> None:
    add_user(client)
    login_as(client, "viewer", email="ana@example.com")
    body = {"current_password": "no es esta", "new_password": NEW_PASSWORD}
    for _ in range(password_auth.LOGIN_LIMIT):
        assert client.post("/api/auth/password", json=body).status_code == 422
    blocked = client.post("/api/auth/password", json={**body, "current_password": PASSWORD})
    assert (blocked.status_code, blocked.json()) == (429, {"code": "login_throttled"})


# Forgot password


def forgot(client: TestClient, email: str, locale: str | None = None) -> httpx.Response:
    body = {"email": email} if locale is None else {"email": email, "locale": locale}
    return client.post("/api/auth/password/forgot", json=body)


def reset(client: TestClient, token: str, password: str = NEW_PASSWORD) -> httpx.Response:
    return client.post("/api/auth/password/reset", json={"token": token, "new_password": password})


def test_without_smtp_there_is_no_forgot_password(client: TestClient) -> None:
    for body in ({"email": "ana@example.com"}, {"nothing": True}):
        response = client.post("/api/auth/password/forgot", json=body)
        assert (response.status_code, response.json()) == (404, {"code": "not_found"})
    assert client.get("/api/auth/config").json()["password_reset_enabled"] is False


def test_a_forgot_password_link_sets_a_new_password_once(
    smtp: TestClient, smtp_config: Settings, mailer: FakeMailer
) -> None:
    assert smtp.get("/api/auth/config").json()["password_reset_enabled"] is True
    ana = add_user(smtp, name="Ana", temporary=True)
    login_as(smtp, "viewer", email="ana@example.com")
    phone = session_token(smtp)
    smtp.cookies.clear()

    response = forgot(smtp, " Ana@Example.com ", "en")
    assert response.status_code == 204 and response.content == b""
    [message] = mailer.sent
    assert (message["To"], message["From"]) == ("ana@example.com", "Timelife <hola@example.com>")
    assert message["Subject"] == "Choose a new Timelife password"
    first = mailer.token()

    async def links(db: AsyncSession) -> list[PasswordReset]:
        return list(await db.scalars(select(PasswordReset)))

    [row] = run_db(smtp, links)
    assert row.token_hash == access_hash(smtp_config, "password-reset", first) != first
    assert row.user_id == ana
    lifetime = aware(row.expires_at) - utcnow()
    assert timedelta(minutes=59) < lifetime <= timedelta(hours=1)

    # Asking again replaces the link (the Spanish e-mail is the default).
    assert forgot(smtp, "ana@example.com").status_code == 204
    assert mailer.sent[-1]["Subject"] == "Elige una contraseña nueva para Timelife"
    second = mailer.token()
    assert len(run_db(smtp, links)) == 1
    assert (reset(smtp, first).status_code, reset(smtp, first).json()) == (
        400,
        {"code": "password_reset_invalid"},
    )

    done = reset(smtp, second)
    assert done.status_code == 200
    assert done.json()["user"] == {
        "id": ana,
        "email": "ana@example.com",
        "name": "Ana",
        "role": "viewer",
        "has_password": True,
    }
    assert SESSION_COOKIE in set_cookies(done) and signed_in(smtp)
    user = stored(smtp, ana)
    assert user.must_change_password is False  # chosen by the user
    assert user.password_hash is not None and verify_password_now(NEW_PASSWORD, user.password_hash)
    assert not signed_in(smtp, phone)
    assert run_db(smtp, links) == []
    again = reset(smtp, second, "otra clave más")
    assert (again.status_code, again.json()) == (400, {"code": "password_reset_invalid"})
    assert login(smtp, "ana@example.com", NEW_PASSWORD).status_code == 200


def test_google_only_users_can_get_a_password(smtp: TestClient, mailer: FakeMailer) -> None:
    luis = add_user(smtp, "luis@example.com", None, google_subject="google-luis")
    assert forgot(smtp, "luis@example.com").status_code == 204
    assert reset(smtp, mailer.token()).status_code == 200
    assert stored(smtp, luis).password_hash is not None
    assert login(smtp, "luis@example.com", NEW_PASSWORD).status_code == 200


def test_forgot_password_e_mails_in_portuguese(smtp: TestClient, mailer: FakeMailer) -> None:
    add_user(smtp, name="Ana")
    assert forgot(smtp, "ana@example.com", "pt").status_code == 204
    [message] = mailer.sent
    assert message["Subject"] == "Escolhe uma nova palavra-passe para o Timelife"
    body = message.get_content()
    assert body.startswith("Olá Ana,\n") and "ana@example.com" in body
    assert reset(smtp, mailer.token()).status_code == 200
    assert login(smtp, "ana@example.com", NEW_PASSWORD).status_code == 200


def test_forgot_password_languages_are_validated(smtp: TestClient, mailer: FakeMailer) -> None:
    add_user(smtp)
    for locale in ("fr", "pt-BR", "PT"):
        response = forgot(smtp, "ana@example.com", locale)
        assert response.status_code == 422, locale
        assert response.json() == {"code": "invalid_request", "fields": {"locale": "literal_error"}}
    assert mailer.sent == []


def test_forgot_password_does_not_reveal_who_has_an_account(
    smtp: TestClient, mailer: FakeMailer
) -> None:
    add_user(smtp, "eva@example.com", disabled=True)
    for email in ("nadie@example.com", "eva@example.com"):
        response = forgot(smtp, email)
        assert (response.status_code, response.content) == (204, b"")
    assert mailer.sent == []
    assert count(smtp, PasswordReset) == 0


def test_forgot_password_is_throttled(smtp: TestClient, mailer: FakeMailer) -> None:
    add_user(smtp)
    for _ in range(password_auth.FORGOT_LIMIT):
        assert forgot(smtp, "ana@example.com").status_code == 204
    blocked = forgot(smtp, "ana@example.com")
    assert (blocked.status_code, blocked.json()) == (429, {"code": "request_throttled"})
    assert blocked.headers["retry-after"] == str(password_auth.FORGOT_SECONDS)
    assert len(mailer.sent) == password_auth.FORGOT_LIMIT
    # The refused request counted too.
    remaining = password_auth.FORGOT_IP_LIMIT - password_auth.FORGOT_LIMIT - 1
    for index in range(remaining):
        assert forgot(smtp, f"nadie{index}@example.com").status_code == 204
    assert forgot(smtp, "otra@example.com").status_code == 429


def test_an_e_mail_failure_is_only_logged(
    smtp: TestClient, mailer: FakeMailer, caplog: pytest.LogCaptureFixture
) -> None:
    add_user(smtp)
    mailer.error = OSError("SMTP server down")
    with caplog.at_level(logging.WARNING, logger="timelife.mail"):
        response = forgot(smtp, "ana@example.com")
    assert response.status_code == 204
    assert "E-mail not sent (password reset: OSError)" in caplog.messages
    assert "ana@example.com" not in caplog.text


def test_unknown_expired_and_malformed_links(smtp: TestClient, smtp_config: Settings) -> None:
    ana = add_user(smtp)
    expired = "e" * 64

    async def add_expired(db: AsyncSession) -> None:
        token_hash = access_hash(smtp_config, "password-reset", expired)
        when = utcnow() - timedelta(seconds=1)
        db.add(PasswordReset(token_hash=token_hash, user_id=ana, expires_at=when))
        await db.commit()

    run_db(smtp, add_expired)
    for token in (expired, "a" * 64):
        response = reset(smtp, token)
        assert (response.status_code, response.json()) == (400, {"code": "password_reset_invalid"})
    for body in (
        {"token": "A" * 64, "new_password": NEW_PASSWORD},
        {"token": "a" * 63, "new_password": NEW_PASSWORD},
        {"token": "a" * 64, "new_password": "corta"},
        {"token": "a" * 64},
    ):
        response = smtp.post("/api/auth/password/reset", json=body)
        assert (response.status_code, response.json()["code"]) == (422, "invalid_request")
    user = stored(smtp, ana)
    assert user.password_hash is not None and verify_password_now(PASSWORD, user.password_hash)

    run_db(smtp, purge_expired)
    assert count(smtp, PasswordReset) == 0


def test_a_disabled_account_cannot_use_its_link(smtp: TestClient, mailer: FakeMailer) -> None:
    ana = add_user(smtp)
    assert forgot(smtp, "ana@example.com").status_code == 204
    token = mailer.token()

    async def disable(db: AsyncSession, value: bool) -> None:
        user = await db.get(User, ana)
        assert user is not None
        user.disabled = value
        await db.commit()

    run_db(smtp, lambda db: disable(db, True))
    refused = reset(smtp, token)
    assert (refused.status_code, refused.json()) == (403, {"code": "account_disabled"})
    run_db(smtp, lambda db: disable(db, False))
    assert reset(smtp, token).status_code == 200  # the link was not used up


def test_reset_attempts_are_throttled_per_client(smtp: TestClient) -> None:
    for _ in range(password_auth.RESET_IP_LIMIT):
        assert reset(smtp, "b" * 64).status_code == 400
    blocked = reset(smtp, "b" * 64)
    assert (blocked.status_code, blocked.json()) == (429, {"code": "request_throttled"})
