"""Google sign-in: OpenID Connect authorization-code flow with PKCE, for invited users only.

``POST /api/auth/google/start`` stores the pending flow (hashed state, browser binding, origin,
return path) and returns Google's authorization URL. ``GET /api/auth/google/callback`` consumes
the flow, redeems the code through ``app.state.google_provider`` (tests swap in a fake), signs
the matching user in and redirects to the return path, or to ``/login?error=<code>``."""

import asyncio
import base64
import hashlib
import json
import logging
import re
import secrets
import time
import traceback
import unicodedata
from collections.abc import Iterator, Mapping
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import RedirectResponse

from .auth import (
    DB,
    GOOGLE_COOKIE,
    GOOGLE_COOKIE_PATH,
    TOKEN,
    UNSYNCHRONIZED,
    access_hash,
    issue_session,
    request_origin,
    settings,
    throttle,
)
from .config import Settings, normalize_email, normalize_origin
from .contracts import GoogleStartIn, GoogleStartOut
from .db import GoogleAuthFlow, User, aware, utcnow
from .errors import AppError

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth/google", tags=["Google sign-in"])

AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
CALLBACK_PATH = "/api/auth/google/callback"
LOGIN_PATH = "/login"
FLOW_SECONDS = 600
START_IP_LIMIT = 20
MAX_RESPONSE_BYTES = 64 * 1024
MAX_ID_TOKEN_LENGTH = 16 * 1024
MAX_CODE_LENGTH = 4096
EXCHANGE_TIMEOUT_SECONDS = 20
KEYS_DEFAULT_TTL = 300
KEYS_MAX_TTL = 3600
CLOCK_LEEWAY_SECONDS = 30
REQUIRED_CLAIMS = ["iss", "aud", "exp", "iat", "sub", "nonce", "email", "email_verified"]
# Bidirectional-text controls could disguise a name shown in the admin UI.
BIDI_CONTROLS = frozenset(
    "\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"
)


def profile_name(value: object) -> str | None:
    """A Google profile name usable as ``users.name`` (one line, 1-120 chars), else None."""
    if not isinstance(value, str):
        return None
    name = " ".join(value.split())
    if (
        not name
        or len(name) > 120
        or any(unicodedata.category(char) == "Cc" or char in BIDI_CONTROLS for char in name)
    ):
        return None
    return name


def claims_name(claims: Mapping[str, Any]) -> str | None:
    """``name`` claim, else ``given_name family_name``, else ``given_name``."""
    given = profile_name(claims.get("given_name"))
    family = profile_name(claims.get("family_name"))
    combined = f"{given} {family}" if given and family else None
    for candidate in (claims.get("name"), combined, given):
        name = profile_name(candidate)
        if name is not None:
            return name
    return None


@dataclass(frozen=True)
class GoogleIdentity:
    """A verified Google account: ``email`` is validated and lower-cased, an unusable ``name``
    becomes None; ValueError unless ``subject`` is 1-255 printable ASCII characters."""

    subject: str
    email: str
    name: str | None = None

    def __post_init__(self) -> None:
        if not (
            isinstance(self.subject, str)
            and 1 <= len(self.subject) <= 255
            and self.subject.isascii()
            and self.subject.isprintable()
        ):
            raise ValueError("Invalid Google subject")
        object.__setattr__(self, "email", normalize_email(self.email))
        object.__setattr__(self, "name", profile_name(self.name))


def pkce_verifier(config: Settings, state: str) -> str:
    # Derived from the state, so it never needs storing; 64 hex chars is a valid RFC 7636 verifier.
    return access_hash(config, "google-pkce", state)


def flow_nonce(config: Settings, state: str) -> str:
    return access_hash(config, "google-nonce", state)


def authorization_url(config: Settings, state: str, origin: str) -> str:
    digest = hashlib.sha256(pkce_verifier(config, state).encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    query = urlencode(
        {
            "client_id": config.google_client_id,
            "redirect_uri": origin + CALLBACK_PATH,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": flow_nonce(config, state),
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
            "access_type": "online",
        }
    )
    return f"{AUTHORIZATION_URL}?{query}"


@contextmanager
def provider_errors() -> Iterator[None]:
    """Transport failures → 503 ``google_unavailable``; malformed or unverifiable answers → 400
    ``google_invalid_identity``. Only the exception type is logged."""
    try:
        yield
    except (httpx.HTTPError, TimeoutError) as error:
        log.warning("Google provider unavailable (%s)", type(error).__name__)
        raise AppError("google_unavailable", 503) from None
    except (jwt.PyJWTError, ValueError, TypeError, KeyError, RecursionError) as error:
        log.warning("Google identity rejected (%s)", type(error).__name__)
        raise AppError("google_invalid_identity", 400) from None


async def read_limited(response: httpx.Response) -> bytes | None:
    """Response body, or None when it exceeds ``MAX_RESPONSE_BYTES``."""
    body = bytearray()
    async for chunk in response.aiter_bytes():
        body += chunk
        if len(body) > MAX_RESPONSE_BYTES:
            return None
    return bytes(body)


class GoogleProvider:
    """Google OIDC client kept in ``app.state.google_provider`` and closed at shutdown.

    Tests replace it with a fake exposing ``async exchange(code, state, origin) -> GoogleIdentity``
    and ``async close()``, or pass ``client`` (an ``httpx.AsyncClient`` on a mock transport)."""

    def __init__(self, config: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.config = config
        self.client = client or httpx.AsyncClient(timeout=10, follow_redirects=False)
        self.keys: dict[str, jwt.PyJWK] = {}
        self.keys_expire = 0.0
        self.key_lock = asyncio.Lock()

    async def close(self) -> None:
        await self.client.aclose()

    async def fetch_keys(self) -> tuple[dict[str, jwt.PyJWK], int]:
        """Google's current RS256 signing keys and how long to cache them (seconds)."""
        async with self.client.stream("GET", JWKS_URL) as response:
            response.raise_for_status()
            body = await read_limited(response)
            cache_control = response.headers.get("cache-control", "")
        if body is None:
            raise AppError("google_unavailable", 503)
        try:
            data = json.loads(body)
        except (ValueError, RecursionError):
            raise AppError("google_unavailable", 503) from None
        items = data.get("keys") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise AppError("google_unavailable", 503)
        keys: dict[str, jwt.PyJWK] = {}
        for item in items:
            if (
                isinstance(item, dict)
                and item.get("kty") == "RSA"
                and item.get("alg", "RS256") == "RS256"
                and item.get("use", "sig") == "sig"
                and isinstance(item.get("kid"), str)
            ):
                with suppress(jwt.PyJWTError, ValueError, TypeError, KeyError):
                    keys[item["kid"]] = jwt.PyJWK.from_dict(item, algorithm="RS256")
        if not keys:
            raise AppError("google_unavailable", 503)
        max_age = re.search(r"(?:^|,)\s*max-age=([0-9]{1,9})\b", cache_control)
        return keys, min(int(max_age[1]), KEYS_MAX_TTL) if max_age else KEYS_DEFAULT_TTL

    async def signing_key(self, kid: str) -> jwt.PyJWK:
        """Key ``kid`` from the cache, refreshed when stale or when Google rotated its keys."""
        async with self.key_lock:
            if kid not in self.keys or time.monotonic() >= self.keys_expire:
                keys, ttl = await self.fetch_keys()
                self.keys, self.keys_expire = keys, time.monotonic() + ttl
            key = self.keys.get(kid)
        if key is None:
            raise AppError("google_invalid_identity", 400)
        return key

    async def verify(self, token: str, state: str) -> GoogleIdentity:
        """Validate an ID token: RS256 signature by a Google key, issuer, audience (and ``azp``),
        expiry and issue time, the nonce bound to ``state`` and a verified e-mail address."""
        config = self.config
        with provider_errors():
            header = jwt.get_unverified_header(token)
            kid = header.get("kid")
            if (
                header.get("alg") != "RS256"
                or not isinstance(kid, str)
                or not 1 <= len(kid) <= 200
            ):
                raise AppError("google_invalid_identity", 400)
            key = await self.signing_key(kid)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                audience=config.google_client_id,
                issuer=ISSUERS,
                leeway=CLOCK_LEEWAY_SECONDS,
                options={"require": REQUIRED_CLAIMS},
            )
            nonce, audience, authorized_party = claims["nonce"], claims["aud"], claims.get("azp")
            if (
                claims["email_verified"] is not True
                or not isinstance(nonce, str)
                or not secrets.compare_digest(nonce, flow_nonce(config, state))
                or (authorized_party is not None and authorized_party != config.google_client_id)
                or (isinstance(audience, list) and len(audience) > 1 and authorized_party is None)
                or not isinstance(claims["sub"], str)
                or not isinstance(claims["email"], str)
            ):
                raise AppError("google_invalid_identity", 400)
            identity = GoogleIdentity(
                subject=claims["sub"], email=claims["email"], name=claims_name(claims)
            )
        return identity

    async def exchange(self, code: str, state: str, origin: str) -> GoogleIdentity:
        """Redeem an authorization code (with the PKCE verifier of ``state``) for the verified
        identity of its ID token."""
        config = self.config
        form = {
            "code": code,
            "client_id": config.google_client_id,
            "client_secret": config.google_client_secret.get_secret_value(),
            "redirect_uri": origin + CALLBACK_PATH,
            "grant_type": "authorization_code",
            "code_verifier": pkce_verifier(config, state),
        }
        with provider_errors():
            async with asyncio.timeout(EXCHANGE_TIMEOUT_SECONDS):
                async with self.client.stream("POST", TOKEN_URL, data=form) as response:
                    if response.status_code == 400:
                        # invalid_grant: code expired, already used or issued to another flow.
                        raise AppError("google_invalid_identity", 400)
                    response.raise_for_status()
                    body = await read_limited(response)
                if body is None:
                    raise AppError("google_invalid_identity", 400)
                data = json.loads(body)
                token = data.get("id_token") if isinstance(data, dict) else None
                if not isinstance(token, str) or len(token) > MAX_ID_TOKEN_LENGTH:
                    raise AppError("google_invalid_identity", 400)
                identity = await self.verify(token, state)
        return identity


async def require_google(request: Request) -> None:
    # A dependency, so a disabled provider answers 503 before the body is validated.
    if not settings(request).google_enabled:
        raise AppError("google_disabled", 503)


@router.post("/start", response_model=GoogleStartOut, dependencies=[Depends(require_google)])
async def start(
    body: GoogleStartIn, request: Request, response: Response, db: DB
) -> GoogleStartOut:
    config = settings(request)
    origin = request_origin(request, config)
    await throttle(db, request, "google-start", ip_limit=START_IP_LIMIT)
    state, browser = secrets.token_hex(32), secrets.token_hex(32)
    now = utcnow()
    await db.execute(
        delete(GoogleAuthFlow).where(GoogleAuthFlow.expires_at <= now),
        execution_options=UNSYNCHRONIZED,
    )
    previous = request.cookies.get(GOOGLE_COOKIE, "")
    if TOKEN.fullmatch(previous):
        # One pending sign-in per browser: restarting abandons the previous flow.
        await db.execute(
            delete(GoogleAuthFlow).where(
                GoogleAuthFlow.browser_hash == access_hash(config, "google-browser", previous)
            )
        )
    db.add(
        GoogleAuthFlow(
            state_hash=access_hash(config, "google-state", state),
            browser_hash=access_hash(config, "google-browser", browser),
            origin=origin,
            return_path=body.return_path,
            expires_at=now + timedelta(seconds=FLOW_SECONDS),
        )
    )
    await db.commit()
    response.set_cookie(
        GOOGLE_COOKIE,
        browser,
        max_age=FLOW_SECONDS,
        path=GOOGLE_COOKIE_PATH,
        secure=config.auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return GoogleStartOut(authorization_url=authorization_url(config, state, origin))


def callback_response(request: Request, location: str) -> RedirectResponse:
    """303 to ``location`` that always drops the browser-binding cookie."""
    response = RedirectResponse(location, status_code=303)
    response.delete_cookie(
        GOOGLE_COOKIE,
        path=GOOGLE_COOKIE_PATH,
        secure=settings(request).auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return response


async def consume_flow(request: Request, db: AsyncSession, state: str) -> GoogleAuthFlow:
    """Atomically take the pending flow of ``state`` when it is unexpired and belongs to this
    browser (binding cookie) and origin; 400 ``google_invalid_flow`` otherwise. Commits."""
    config = settings(request)
    binding = request.cookies.get(GOOGLE_COOKIE, "")
    if not TOKEN.fullmatch(state) or not TOKEN.fullmatch(binding):
        raise AppError("google_invalid_flow", 400)
    try:
        origin = normalize_origin(str(request.base_url))
    except ValueError:
        raise AppError("google_invalid_flow", 400) from None
    hashed = access_hash(config, "google-state", state)
    flow = await db.get(GoogleAuthFlow, hashed)
    if (
        flow is None
        or aware(flow.expires_at) <= utcnow()
        or flow.origin != origin
        or flow.origin not in config.public_origins
        or not secrets.compare_digest(
            flow.browser_hash, access_hash(config, "google-browser", binding)
        )
    ):
        raise AppError("google_invalid_flow", 400)
    consumed = await db.scalar(
        delete(GoogleAuthFlow)
        .where(GoogleAuthFlow.state_hash == hashed, GoogleAuthFlow.expires_at > utcnow())
        .returning(GoogleAuthFlow.state_hash),
        execution_options=UNSYNCHRONIZED,
    )
    if consumed is None:
        raise AppError("google_invalid_flow", 400)
    await db.commit()
    return flow


async def invited_user(db: AsyncSession, identity: GoogleIdentity) -> User:
    """The user bound to the Google subject, else the invited user with that e-mail and no Google
    account yet (bound now). 403 ``google_not_invited`` / ``account_disabled``. Fills an empty
    name from the Google profile. The caller commits."""
    user = await db.scalar(
        select(User).where(User.google_subject == identity.subject).with_for_update()
    )
    if user is None:
        user = await db.scalar(
            select(User)
            .where(User.email == identity.email, User.google_subject.is_(None))
            .with_for_update()
        )
        if user is None:
            raise AppError("google_not_invited", 403)
        if user.disabled:
            raise AppError("account_disabled", 403)
        user.google_subject = identity.subject
    elif user.disabled:
        raise AppError("account_disabled", 403)
    if not user.name and identity.name:
        user.name = identity.name
    return user


@router.get("/callback", response_class=RedirectResponse, include_in_schema=False)
async def callback(request: Request, db: DB) -> RedirectResponse:
    try:
        if not settings(request).google_enabled:
            raise AppError("google_disabled", 503)
        params = request.query_params
        states = params.getlist("state")
        if len(states) != 1:
            raise AppError("google_invalid_flow", 400)
        flow = await consume_flow(request, db, states[0])
        if "error" in params:
            raise AppError("google_cancelled", 400)
        codes = params.getlist("code")
        if len(codes) != 1 or not 1 <= len(codes[0]) <= MAX_CODE_LENGTH:
            raise AppError("google_invalid_identity", 400)
        provider = request.app.state.google_provider
        identity = await provider.exchange(codes[0], states[0], flow.origin)
        user = await invited_user(db, identity)
        response = callback_response(request, flow.return_path)
        await issue_session(db, request, response, user)
        return response
    except AppError as error:
        code = error.code
        log.info("Google sign-in stopped (%s)", code)
    except IntegrityError:
        code = "google_invalid_identity"
        log.warning("Google account is already bound to another user")
    except Exception as error:
        code = "internal_error"
        log.error(
            "Google sign-in failed (%s)\n%s",
            type(error).__name__,
            "".join(traceback.format_tb(error.__traceback__)),
        )
    with suppress(SQLAlchemyError):
        await db.rollback()
    return callback_response(request, f"{LOGIN_PATH}?{urlencode({'error': code})}")
