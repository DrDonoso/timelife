"""Google sign-in: start and callback (fake provider), ID-token verification and code exchange
(real provider against a mock Google with a locally generated RSA key)."""

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from timelife import google_auth
from timelife.auth import GOOGLE_COOKIE, SESSION_COOKIE
from timelife.config import Settings
from timelife.db import GoogleAuthFlow, User, aware, utcnow
from timelife.errors import AppError
from timelife.google_auth import (
    AUTHORIZATION_URL,
    JWKS_URL,
    TOKEN_URL,
    GoogleIdentity,
    GoogleProvider,
    claims_name,
    flow_nonce,
    pkce_verifier,
)

from .conftest import app_client, cookie_domain, make_settings, run_db, set_cookies

CLIENT_ID = "1234-abc.apps.googleusercontent.com"
ORIGIN = "https://timelife.example.com"
OTHER_ORIGIN = "https://fotos.example.com"
CALLBACK = "/api/auth/google/callback"
STATE = "ab" * 32
MISSING: Any = object()


class FakeGoogle:
    """Stands in for ``app.state.google_provider``: returns ``result`` (or raises it)."""

    def __init__(self) -> None:
        self.result: GoogleIdentity | Exception = GoogleIdentity(
            subject="google-sub-1", email="Ana@Example.com", name="Ana García"
        )
        self.calls: list[tuple[str, str, str]] = []

    async def exchange(self, code: str, state: str, origin: str) -> GoogleIdentity:
        self.calls.append((code, state, origin))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result

    async def close(self) -> None:
        return None


@pytest.fixture
def google_config(config_factory: Any) -> Settings:
    return config_factory(
        public_origin=f"{ORIGIN},{OTHER_ORIGIN}",
        auth_cookie_secure=True,
        google_client_id=CLIENT_ID,
        google_client_secret="client-secret",
    )


@pytest.fixture
def fake() -> FakeGoogle:
    return FakeGoogle()


@pytest.fixture
def google(google_config: Settings, fake: FakeGoogle) -> Iterator[TestClient]:
    with app_client(google_config) as client:
        client.app.state.google_provider = fake
        yield client


def start(
    client: TestClient, return_path: str | None = None, origin: str = ORIGIN
) -> tuple[httpx.Response, dict[str, str]]:
    body = {} if return_path is None else {"return_path": return_path}
    response = client.post("/api/auth/google/start", json=body, headers={"origin": origin})
    assert response.status_code == 200, response.text
    url = urlsplit(response.json()["authorization_url"])
    return response, {key: values[0] for key, values in parse_qs(url.query).items()}


def callback(client: TestClient, **params: Any) -> httpx.Response:
    return client.get(CALLBACK, params=params, follow_redirects=False)


def assert_redirect(response: httpx.Response, location: str) -> None:
    """303 to ``location`` that always clears the browser-binding cookie."""
    assert response.status_code == 303, response.text
    assert response.headers["location"] == location
    binding = set_cookies(response)[GOOGLE_COOKIE]
    assert (binding.value, binding["max-age"], binding["path"]) == ("", "0", "/api/auth")
    if location.startswith("/login?error="):
        assert SESSION_COOKIE not in set_cookies(response)


def set_binding(client: TestClient, value: str) -> None:
    client.cookies.set(GOOGLE_COOKIE, value, domain=cookie_domain(client), path="/api/auth")


def add_user(client: TestClient, **values: Any) -> int:
    async def create(db: AsyncSession) -> int:
        user = User(**{"role": "viewer", **values})
        db.add(user)
        await db.commit()
        return user.id

    return run_db(client, create)


def get_user(client: TestClient, user_id: int) -> User:
    async def load(db: AsyncSession) -> User:
        user = await db.get(User, user_id)
        assert user is not None
        return user

    return run_db(client, load)


def pending_flows(client: TestClient) -> int:
    async def count(db: AsyncSession) -> int:
        return await db.scalar(select(func.count()).select_from(GoogleAuthFlow)) or 0

    return run_db(client, count)


def test_google_sign_in_is_disabled_without_credentials(client: TestClient) -> None:
    assert client.get("/api/auth/config").json()["google_enabled"] is False
    for body in ({"return_path": "/"}, {"return_path": "//evil.example"}, None):
        response = client.post("/api/auth/google/start", json=body)
        assert response.status_code == 503
        assert response.json() == {"code": "google_disabled"}
    response = client.get(CALLBACK, params={"state": STATE, "code": "x"}, follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/login?error=google_disabled"


def test_start_returns_a_pkce_authorization_url(
    google: TestClient, google_config: Settings
) -> None:
    assert google.get("/api/auth/config").json() == {
        "google_enabled": True,
        "dev_login_enabled": False,
        "password_reset_enabled": False,
        "setup_required": True,
    }
    response, query = start(google, "/c/lucia/e/12?zoom=months")
    assert response.json()["authorization_url"].startswith(AUTHORIZATION_URL + "?")
    state = query["state"]
    assert re.fullmatch(r"[0-9a-f]{64}", state)
    secret = google_config.auth_secret.get_secret_value().encode()

    def mac(purpose: str, value: str) -> str:
        return hmac.new(secret, f"{purpose}\0{value}".encode(), hashlib.sha256).hexdigest()

    verifier = mac("google-pkce", state)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
    assert query == {
        "client_id": CLIENT_ID,
        "redirect_uri": ORIGIN + CALLBACK,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": mac("google-nonce", state),
        "code_challenge": challenge.decode().rstrip("="),
        "code_challenge_method": "S256",
        "prompt": "select_account",
        "access_type": "online",
    }
    binding = set_cookies(response)[GOOGLE_COOKIE]
    assert re.fullmatch(r"[0-9a-f]{64}", binding.value)
    assert binding["httponly"] is True and binding["secure"] is True
    assert binding["samesite"].lower() == "lax"
    assert (binding["path"], binding["max-age"]) == ("/api/auth", "600")

    async def flows(db: AsyncSession) -> list[GoogleAuthFlow]:
        return list(await db.scalars(select(GoogleAuthFlow)))

    [flow] = run_db(google, flows)
    assert flow.state_hash == mac("google-state", state)
    assert flow.browser_hash == mac("google-browser", binding.value)
    assert (flow.origin, flow.return_path) == (ORIGIN, "/c/lucia/e/12?zoom=months")
    assert timedelta(minutes=9) < aware(flow.expires_at) - utcnow() <= timedelta(minutes=10)

    # Restarting from the same browser abandons the previous flow.
    _, again = start(google)
    [replacement] = run_db(google, flows)
    assert replacement.state_hash == mac("google-state", again["state"])
    assert replacement.return_path == "/"


@pytest.mark.parametrize(
    "path",
    [
        "//evil.example",
        "https://evil.example",
        "/\\evil.example",
        "evil",
        "",
        "/" + "a" * 512,
        "/a\nb",
        "/a\x00b",
    ],
)
def test_start_validates_the_return_path(google: TestClient, path: str) -> None:
    response = google.post("/api/auth/google/start", json={"return_path": path})
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"
    assert set(response.json()["fields"]) == {"return_path"}
    assert pending_flows(google) == 0


def test_start_needs_a_public_origin_and_is_throttled(google: TestClient) -> None:
    foreign = google.post(
        "/api/auth/google/start", json={}, headers={"origin": "https://evil.example.com"}
    )
    assert (foreign.status_code, foreign.json()) == (403, {"code": "invalid_origin"})
    for _ in range(20):
        assert google.post("/api/auth/google/start", json={}).status_code == 200
    blocked = google.post("/api/auth/google/start", json={})
    assert (blocked.status_code, blocked.json()) == (429, {"code": "request_throttled"})
    assert blocked.headers["retry-after"] == "300"


def test_callback_binds_the_invited_user_by_email(google: TestClient, fake: FakeGoogle) -> None:
    user_id = add_user(google, email="ana@example.com")
    response, query = start(google, "/c/lucia")
    binding = set_cookies(response)[GOOGLE_COOKIE].value

    signed_in = callback(google, state=query["state"], code="auth-code")
    assert_redirect(signed_in, "/c/lucia")
    session = set_cookies(signed_in)[SESSION_COOKIE]
    assert re.fullmatch(r"[0-9a-f]{64}", session.value)
    assert session["httponly"] is True and session["secure"] is True
    assert (session["samesite"].lower(), session["path"]) == ("strict", "/api")
    assert fake.calls == [("auth-code", query["state"], ORIGIN)]

    user = get_user(google, user_id)
    assert (user.google_subject, user.name) == ("google-sub-1", "Ana García")
    assert user.last_login_at is not None
    assert pending_flows(google) == 0
    assert google.get("/api/auth/session").json() == {
        "authenticated": True,
        "user": {
            "id": user_id,
            "email": "ana@example.com",
            "name": "Ana García",
            "role": "viewer",
            "has_password": False,
        },
    }

    # A replayed callback finds no flow even with the binding cookie.
    set_binding(google, binding)
    assert_redirect(
        callback(google, state=query["state"], code="auth-code"),
        "/login?error=google_invalid_flow",
    )
    assert len(fake.calls) == 1


def test_callback_prefers_the_bound_google_subject(google: TestClient, fake: FakeGoogle) -> None:
    user_id = add_user(
        google,
        email="ana.old@example.com",
        name="Ana",
        role="admin",
        google_subject="google-sub-1",
    )
    add_user(google, email="ana@example.com")
    _, query = start(google)
    assert_redirect(callback(google, state=query["state"], code="c"), "/")
    assert get_user(google, user_id).name == "Ana"  # an existing name is kept
    assert google.get("/api/auth/session").json()["user"]["id"] == user_id


def test_callback_rejects_uninvited_accounts(google: TestClient, fake: FakeGoogle) -> None:
    taken = add_user(google, email="ana@example.com", google_subject="another-google-account")
    _, query = start(google)
    assert_redirect(
        callback(google, state=query["state"], code="c"), "/login?error=google_not_invited"
    )
    assert get_user(google, taken).google_subject == "another-google-account"

    fake.result = GoogleIdentity(subject="google-sub-2", email="nobody@example.com")
    _, query = start(google)
    assert_redirect(
        callback(google, state=query["state"], code="c"), "/login?error=google_not_invited"
    )
    assert pending_flows(google) == 0
    assert google.get("/api/auth/session").json()["authenticated"] is False


@pytest.mark.parametrize("bound", [False, True])
def test_callback_rejects_disabled_accounts(google: TestClient, bound: bool) -> None:
    subject = "google-sub-1" if bound else None
    user_id = add_user(google, email="ana@example.com", disabled=True, google_subject=subject)
    _, query = start(google)
    assert_redirect(
        callback(google, state=query["state"], code="c"), "/login?error=account_disabled"
    )
    user = get_user(google, user_id)
    assert (user.google_subject, user.last_login_at, user.name) == (subject, None, None)


def test_callback_reports_cancellation(google: TestClient, fake: FakeGoogle) -> None:
    add_user(google, email="ana@example.com")
    _, query = start(google)
    response = callback(google, state=query["state"], error="access_denied")
    assert_redirect(response, "/login?error=google_cancelled")
    assert fake.calls == [] and pending_flows(google) == 0


def test_callback_requires_the_flow_of_this_browser(google: TestClient, fake: FakeGoogle) -> None:
    add_user(google, email="ana@example.com")
    response, query = start(google)
    state = query["state"]
    binding = set_cookies(response)[GOOGLE_COOKIE].value
    invalid = "/login?error=google_invalid_flow"

    for params in (
        {"code": "c"},
        {"state": [state, state], "code": "c"},
        {"state": state.upper(), "code": "c"},
        {"state": secrets.token_hex(32), "code": "c"},
    ):
        set_binding(google, binding)
        assert_redirect(callback(google, **params), invalid)

    for cookie in (None, secrets.token_hex(32), "not-a-binding"):
        if cookie is not None:
            set_binding(google, cookie)
        assert_redirect(callback(google, state=state, code="c"), invalid)

    # Nothing was consumed: the browser that started the flow still completes it.
    assert fake.calls == [] and pending_flows(google) == 1
    set_binding(google, binding)
    assert_redirect(callback(google, state=state, code="c"), "/")


def test_callback_rejects_expired_flows(google: TestClient) -> None:
    add_user(google, email="ana@example.com")
    _, query = start(google)

    async def expire(db: AsyncSession) -> None:
        await db.execute(
            update(GoogleAuthFlow).values(expires_at=utcnow() - timedelta(seconds=1))
        )
        await db.commit()

    run_db(google, expire)
    assert_redirect(
        callback(google, state=query["state"], code="c"), "/login?error=google_invalid_flow"
    )


def test_callback_must_arrive_at_the_starting_origin(google: TestClient, fake: FakeGoogle) -> None:
    add_user(google, email="ana@example.com")
    _, query = start(google, origin=OTHER_ORIGIN)
    assert query["redirect_uri"] == OTHER_ORIGIN + CALLBACK
    assert_redirect(
        callback(google, state=query["state"], code="c"), "/login?error=google_invalid_flow"
    )
    assert fake.calls == []


@pytest.mark.parametrize("codes", [[], ["a", "b"], ["x" * 4097], [""]])
def test_callback_requires_one_authorization_code(
    google: TestClient, fake: FakeGoogle, codes: list[str]
) -> None:
    _, query = start(google)
    assert_redirect(
        callback(google, state=query["state"], code=codes), "/login?error=google_invalid_identity"
    )
    assert fake.calls == []


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (AppError("google_unavailable", 503), "google_unavailable"),
        (AppError("google_invalid_identity", 400), "google_invalid_identity"),
        (RuntimeError("classified detail"), "internal_error"),
    ],
)
def test_callback_reports_provider_failures(
    google: TestClient,
    fake: FakeGoogle,
    caplog: pytest.LogCaptureFixture,
    error: Exception,
    code: str,
) -> None:
    add_user(google, email="ana@example.com")
    fake.result = error
    _, query = start(google)
    with caplog.at_level(logging.INFO, logger="timelife.google_auth"):
        response = callback(google, state=query["state"], code="c")
    assert_redirect(response, f"/login?error={code}")
    assert "classified detail" not in caplog.text


# Real provider against a mock Google ------------------------------------------------------------


@pytest.fixture(scope="module")
def rsa_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def public_jwk(key: rsa.RSAPrivateKey, kid: str) -> dict[str, Any]:
    jwk = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    jwk.update(kid=kid, alg="RS256", use="sig")
    return jwk


class MockGoogle:
    """``httpx.MockTransport`` handler serving Google's JWKS and token endpoints."""

    def __init__(self, key: rsa.RSAPrivateKey) -> None:
        self.jwks: dict[str, Any] = {"keys": [public_jwk(key, "key-1")]}
        self.jwks_status = 200
        self.jwks_body: bytes | None = None
        self.jwks_requests = 0
        self.id_token = ""
        self.token_status = 200
        self.token_body: bytes | None = None
        self.token_forms: list[dict[str, str]] = []
        self.failure: Exception | None = None

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if self.failure is not None:
            raise self.failure
        if request.method == "GET" and str(request.url) == JWKS_URL:
            self.jwks_requests += 1
            body = self.jwks_body or json.dumps(self.jwks).encode()
            headers = {"cache-control": "public, max-age=600, must-revalidate"}
            return httpx.Response(self.jwks_status, content=body, headers=headers)
        if request.method == "POST" and str(request.url) == TOKEN_URL:
            form = parse_qs(request.content.decode())
            self.token_forms.append({key: values[0] for key, values in form.items()})
            body = self.token_body or json.dumps({"id_token": self.id_token}).encode()
            return httpx.Response(self.token_status, content=body)
        return httpx.Response(404)


@dataclass
class Oidc:
    config: Settings
    key: rsa.RSAPrivateKey
    server: MockGoogle
    provider: GoogleProvider

    def token(
        self,
        *,
        kid: str = "key-1",
        key: Any = None,
        algorithm: str = "RS256",
        state: str = STATE,
        **claims: Any,
    ) -> str:
        now = int(time.time())
        payload: dict[str, Any] = {
            "iss": "https://accounts.google.com",
            "aud": CLIENT_ID,
            "azp": CLIENT_ID,
            "sub": "google-sub-1",
            "email": "Ana@Example.com",
            "email_verified": True,
            "nonce": flow_nonce(self.config, state),
            "iat": now,
            "exp": now + 3600,
            "name": "Ana García",
        }
        payload.update(claims)
        payload = {name: value for name, value in payload.items() if value is not MISSING}
        headers = {"kid": kid} if kid else {}
        return jwt.encode(payload, key or self.key, algorithm=algorithm, headers=headers)


@pytest.fixture
def provider_config(tmp_path: Path) -> Settings:
    return make_settings(
        "sqlite+aiosqlite://",
        tmp_path / "media",
        public_origin=ORIGIN,
        auth_cookie_secure=True,
        google_client_id=CLIENT_ID,
        google_client_secret="client-secret",
    )


@pytest.fixture
async def oidc(provider_config: Settings, rsa_key: rsa.RSAPrivateKey) -> AsyncIterator[Oidc]:
    server = MockGoogle(rsa_key)
    provider = GoogleProvider(
        provider_config, httpx.AsyncClient(transport=httpx.MockTransport(server))
    )
    try:
        yield Oidc(provider_config, rsa_key, server, provider)
    finally:
        await provider.close()


def test_google_identity_normalises_its_fields() -> None:
    identity = GoogleIdentity(subject="123", email=" Ana@Example.COM ", name="  Ana \n García ")
    assert (identity.email, identity.name) == ("ana@example.com", "Ana García")
    for name in ("x" * 121, "Ana\u202eaicraG", "Ana\x07", "", "   ", 5):
        assert GoogleIdentity("1", "a@example.com", name).name is None
    for subject in ("", "x" * 256, "ñ", "a\nb"):
        with pytest.raises(ValueError):
            GoogleIdentity(subject, "a@example.com")
    with pytest.raises(ValueError):
        GoogleIdentity("1", "not-an-email")


def test_profile_name_fallbacks() -> None:
    full = {"name": "Ana García", "given_name": "A", "family_name": "G"}
    assert claims_name(full) == "Ana García"
    assert claims_name({"given_name": "Ana", "family_name": "García"}) == "Ana García"
    assert claims_name({"name": 5, "given_name": "Ana"}) == "Ana"
    assert claims_name({}) is None


async def test_verify_accepts_google_id_tokens(oidc: Oidc) -> None:
    identity = await oidc.provider.verify(oidc.token(), STATE)
    assert identity == GoogleIdentity(
        subject="google-sub-1", email="ana@example.com", name="Ana García"
    )
    for token in (
        oidc.token(iss="accounts.google.com"),
        oidc.token(aud=[CLIENT_ID, "other.apps.googleusercontent.com"]),
        oidc.token(azp=MISSING, name=MISSING, given_name="Ana"),
        oidc.token(exp=int(time.time()) - 10),  # within the clock leeway
    ):
        assert (await oidc.provider.verify(token, STATE)).subject == "google-sub-1"


@pytest.mark.parametrize(
    "claims",
    [
        {"email_verified": False},
        {"email_verified": "true"},
        {"email_verified": MISSING},
        {"nonce": "0" * 64},
        {"nonce": MISSING},
        {"state": "cd" * 32},
        {"aud": "other.apps.googleusercontent.com"},
        {"aud": [CLIENT_ID, "other.apps.googleusercontent.com"], "azp": MISSING},
        {"azp": "other.apps.googleusercontent.com"},
        {"iss": "https://evil.example.com"},
        {"iss": MISSING},
        {"exp": int(time.time()) - 120},
        {"iat": int(time.time()) + 600},
        {"iat": MISSING},
        {"sub": MISSING},
        {"sub": "ñ"},
        {"email": MISSING},
        {"email": "not-an-email"},
    ],
)
async def test_verify_rejects_invalid_claims(oidc: Oidc, claims: dict[str, Any]) -> None:
    with pytest.raises(AppError) as error:
        await oidc.provider.verify(oidc.token(**claims), STATE)
    assert (error.value.code, error.value.status) == ("google_invalid_identity", 400)


async def test_verify_rejects_forged_or_malformed_tokens(oidc: Oidc) -> None:
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    candidates = [
        oidc.token(key="s" * 64, algorithm="HS256"),
        oidc.token(key=other_key),
        oidc.token(kid="unknown"),
        oidc.token(kid=""),
        oidc.token()[:-4] + "AAAA",
        "not.a.jwt",
        "",
    ]
    for token in candidates:
        with pytest.raises(AppError) as error:
            await oidc.provider.verify(token, STATE)
        assert error.value.code == "google_invalid_identity", token


async def test_signing_keys_are_cached_and_refreshed(oidc: Oidc, rsa_key: Any) -> None:
    await oidc.provider.verify(oidc.token(), STATE)
    await oidc.provider.verify(oidc.token(), STATE)
    assert oidc.server.jwks_requests == 1
    assert 590 < oidc.provider.keys_expire - time.monotonic() <= 600

    oidc.server.jwks = {"keys": [public_jwk(rsa_key, "key-2")]}  # Google rotated its keys
    await oidc.provider.verify(oidc.token(kid="key-2"), STATE)
    assert oidc.server.jwks_requests == 2

    oidc.provider.keys_expire = 0
    await oidc.provider.verify(oidc.token(kid="key-2"), STATE)
    assert oidc.server.jwks_requests == 3


@pytest.mark.parametrize("problem", ["status", "size", "json", "empty", "other-keys", "network"])
async def test_unusable_key_sets_mean_google_is_unavailable(oidc: Oidc, problem: str) -> None:
    server = oidc.server
    if problem == "status":
        server.jwks_status = 500
    elif problem == "size":
        server.jwks_body = json.dumps({"keys": [], "padding": "x" * 70_000}).encode()
    elif problem == "json":
        server.jwks_body = b"<html>"
    elif problem == "empty":
        server.jwks = {"keys": []}
    elif problem == "other-keys":
        server.jwks = {"keys": [{**server.jwks["keys"][0], "alg": "RS512"}, {"kty": "EC"}]}
    else:
        server.failure = httpx.ConnectError("down")
    with pytest.raises(AppError) as error:
        await oidc.provider.verify(oidc.token(), STATE)
    assert (error.value.code, error.value.status) == ("google_unavailable", 503)


async def test_exchange_redeems_the_code_with_the_pkce_verifier(oidc: Oidc) -> None:
    oidc.server.id_token = oidc.token()
    identity = await oidc.provider.exchange("the-code", STATE, ORIGIN)
    assert identity.email == "ana@example.com"
    assert oidc.server.token_forms == [
        {
            "code": "the-code",
            "client_id": CLIENT_ID,
            "client_secret": "client-secret",
            "redirect_uri": ORIGIN + CALLBACK,
            "grant_type": "authorization_code",
            "code_verifier": pkce_verifier(oidc.config, STATE),
        }
    ]


@pytest.mark.parametrize(
    ("problem", "code"),
    [
        ("400", "google_invalid_identity"),
        ("401", "google_unavailable"),
        ("500", "google_unavailable"),
        ("302", "google_unavailable"),
        ("network", "google_unavailable"),
        ("no-token", "google_invalid_identity"),
        ("not-json", "google_invalid_identity"),
        ("too-large", "google_invalid_identity"),
        ("long-token", "google_invalid_identity"),
        ("unverified", "google_invalid_identity"),
    ],
)
async def test_exchange_failures(oidc: Oidc, problem: str, code: str) -> None:
    server = oidc.server
    server.id_token = oidc.token()
    if problem.isdigit():
        server.token_status = int(problem)
    elif problem == "network":
        server.failure = httpx.ReadTimeout("slow")
    elif problem == "no-token":
        server.token_body = b'{"access_token": "x"}'
    elif problem == "not-json":
        server.token_body = b"<html>"
    elif problem == "too-large":
        server.token_body = json.dumps({"id_token": server.id_token, "x": "x" * 70_000}).encode()
    elif problem == "long-token":
        server.token_body = json.dumps({"id_token": "x" * 20_000}).encode()
    else:
        server.id_token = oidc.token(email_verified=False)
    with pytest.raises(AppError) as error:
        await oidc.provider.exchange("c", STATE, ORIGIN)
    assert error.value.code == code


async def test_exchange_times_out(provider_config: Settings, monkeypatch: Any) -> None:
    monkeypatch.setattr(google_auth, "EXCHANGE_TIMEOUT_SECONDS", 0.05)

    async def slow(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(5)
        return httpx.Response(200)

    client = httpx.AsyncClient(transport=httpx.MockTransport(slow))
    provider = GoogleProvider(provider_config, client)
    try:
        with pytest.raises(AppError) as error:
            await provider.exchange("c", STATE, ORIGIN)
        assert error.value.code == "google_unavailable"
    finally:
        await provider.close()


def test_sign_in_end_to_end_with_a_signed_id_token(
    google: TestClient, google_config: Settings, rsa_key: rsa.RSAPrivateKey
) -> None:
    user_id = add_user(google, email="ana@example.com")
    server = MockGoogle(rsa_key)
    client = httpx.AsyncClient(transport=httpx.MockTransport(server))
    provider = GoogleProvider(google_config, client)
    google.app.state.google_provider = provider
    oidc = Oidc(google_config, rsa_key, server, provider)
    try:
        _, query = start(google, "/admin")
        server.id_token = oidc.token(state=query["state"])
        assert_redirect(callback(google, state=query["state"], code="real-code"), "/admin")
        [form] = server.token_forms
        digest = hashlib.sha256(form["code_verifier"].encode()).digest()
        assert base64.urlsafe_b64encode(digest).decode().rstrip("=") == query["code_challenge"]
        assert (form["code"], form["redirect_uri"]) == ("real-code", ORIGIN + CALLBACK)
        assert get_user(google, user_id).google_subject == "google-sub-1"
        assert google.get("/api/auth/session").json()["user"]["id"] == user_id

        _, query = start(google)
        server.id_token = oidc.token(state=query["state"], email_verified=False)
        assert_redirect(
            callback(google, state=query["state"], code="other-code"),
            "/login?error=google_invalid_identity",
        )
    finally:
        assert google.portal is not None
        google.portal.call(provider.close)
