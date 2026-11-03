"""Cookie sessions, throttling, development sign-in and the authentication dependencies.

Session tokens are 32 random bytes (hex) that live only in the ``timelife_session`` cookie; the
database keeps their HMAC (``access_hash``), so a leaked database holds no usable session."""

import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated, AsyncIterator, Literal

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import Insert, delete, select, update
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .config import LOOPBACK_HOSTS, Settings, is_loopback, normalize_origin
from .contracts import AuthConfigOut, DevLoginIn, SessionOut, SessionUserOut
from .db import AuthLimit, GoogleAuthFlow, PasswordReset, User, UserRole, UserSession, utcnow
from .errors import AppError

SESSION_COOKIE = "timelife_session"
SESSION_COOKIE_PATH = "/api"
GOOGLE_COOKIE = "timelife_google"
GOOGLE_COOKIE_PATH = "/api/auth"
# Session tokens, Google sign-in states and browser bindings: 32 random bytes in lower-case hex.
TOKEN = re.compile(r"[0-9a-f]{64}")
LIMIT_SECONDS = 300
DEV_LOGIN_LIMIT = 10
DEV_LOGIN_IP_LIMIT = 50
DEV_USERS: dict[UserRole, str] = {
    "admin": "dev-admin@example.com",
    "viewer": "dev-viewer@example.com",
}
# Bulk deletes on expiry must not "evaluate" their criteria against loaded objects: SQLite
# returns naive datetimes, which cannot be compared with the aware ``utcnow()``.
UNSYNCHRONIZED = {"synchronize_session": False}

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def settings(request: Request) -> Settings:
    return request.app.state.settings


async def database(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessions() as db:
        yield db


DB = Annotated[AsyncSession, Depends(database)]


@dataclass(frozen=True)
class SessionUser:
    id: int
    email: str
    name: str | None
    role: Literal["admin", "viewer"]
    has_password: bool = False

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def access_hash(config: Settings, purpose: str, token: str) -> str:
    """HMAC-SHA256 keyed with ``AUTH_SECRET`` of ``purpose + "\\0" + token`` (64 hex chars)."""
    return hmac.new(
        config.auth_secret.get_secret_value().encode(),
        f"{purpose}\0{token}".encode(),
        hashlib.sha256,
    ).hexdigest()


async def session_user(request: Request, db: AsyncSession) -> SessionUser | None:
    """User of the request's session cookie, or None unless the session is unexpired, the user is
    enabled and its ``auth_version`` is unchanged since the session was issued."""
    token = request.cookies.get(SESSION_COOKIE, "")
    if not TOKEN.fullmatch(token):
        return None
    row = (
        await db.execute(
            select(User.id, User.email, User.name, User.role, User.password_hash.is_not(None))
            .join(UserSession, UserSession.user_id == User.id)
            .where(
                UserSession.token_hash == access_hash(settings(request), "session", token),
                UserSession.expires_at > utcnow(),
                UserSession.auth_version == User.auth_version,
                User.disabled.is_(False),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    user_id, email, name, role, has_password = row
    return SessionUser(
        id=user_id, email=email, name=name, role=role, has_password=bool(has_password)
    )


async def current_user(request: Request, db: DB) -> SessionUser:
    """Signed-in user from the ``timelife_session`` cookie, else 401 authentication_required."""
    user = await session_user(request, db)
    if user is None:
        raise AppError("authentication_required", 401)
    return user


CurrentUser = Annotated[SessionUser, Depends(current_user)]


async def admin_user(user: CurrentUser) -> SessionUser:
    """Signed-in administrator, else 401 ``authentication_required`` / 403 ``admin_required``."""
    if user.role != "admin":
        raise AppError("admin_required", 403)
    return user


AdminUser = Annotated[SessionUser, Depends(admin_user)]


def session_out(user: User | SessionUser) -> SessionOut:
    return SessionOut(
        authenticated=True,
        user=SessionUserOut(
            id=user.id,
            email=user.email,
            name=user.name,
            role=user.role,
            has_password=user.has_password,
        ),
    )


async def has_enabled_admin(db: AsyncSession) -> bool:
    query = select(User.id).where(User.role == "admin", User.disabled.is_(False)).limit(1)
    return await db.scalar(query) is not None


def request_origin(request: Request, config: Settings) -> str:
    """The request's single ``Origin``; it must be a configured public origin (else 403)."""
    values = request.headers.getlist("origin")
    try:
        origin = normalize_origin(values[0]) if len(values) == 1 else None
    except ValueError:
        origin = None
    if origin is None or origin not in config.public_origins:
        raise AppError("invalid_origin", 403)
    return origin


async def revoke_user_sessions(db: AsyncSession, user: User) -> None:
    """Sign ``user`` out everywhere (use on role/disable/password changes): bump ``auth_version``
    and delete the user's session rows. The caller commits."""
    user.auth_version += 1
    await db.execute(delete(UserSession).where(UserSession.user_id == user.id))


async def purge_expired(db: AsyncSession) -> None:
    """Delete expired sessions, Google sign-in flows, password reset links and throttle windows.
    Commits."""
    now = utcnow()
    for statement in (
        delete(UserSession).where(UserSession.expires_at <= now),
        delete(GoogleAuthFlow).where(GoogleAuthFlow.expires_at <= now),
        delete(PasswordReset).where(PasswordReset.expires_at <= now),
        delete(AuthLimit).where(AuthLimit.expires_at <= now),
    ):
        await db.execute(statement, execution_options=UNSYNCHRONIZED)
    await db.commit()


async def issue_session(
    db: AsyncSession, request: Request, response: Response, user: User
) -> SessionOut:
    """Sign ``user`` in: store a new hashed session (dropping the request's previous one), stamp
    ``last_login_at``, purge expired rows and set the ``timelife_session`` cookie on ``response``.

    401 ``authentication_required`` if the user was disabled or revoked meanwhile. Commits."""
    config = settings(request)
    now = utcnow()
    signed_in = await db.scalar(
        update(User)
        .where(
            User.id == user.id,
            User.auth_version == user.auth_version,
            User.disabled.is_(False),
        )
        .values(last_login_at=now)
        .returning(User.id)
    )
    if signed_in is None:
        raise AppError("authentication_required", 401)
    previous = request.cookies.get(SESSION_COOKIE, "")
    if TOKEN.fullmatch(previous):
        await db.execute(
            delete(UserSession).where(
                UserSession.token_hash == access_hash(config, "session", previous)
            )
        )
    token = secrets.token_hex(32)
    db.add(
        UserSession(
            token_hash=access_hash(config, "session", token),
            user_id=user.id,
            auth_version=user.auth_version,
            expires_at=now + timedelta(days=config.session_days),
            created_at=now,
        )
    )
    await purge_expired(db)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=config.session_days * 86400,
        path=SESSION_COOKIE_PATH,
        secure=config.auth_cookie_secure,
        httponly=True,
        samesite="strict",
    )
    return session_out(user)


def clear_auth_cookies(response: Response, config: Settings) -> None:
    response.delete_cookie(
        SESSION_COOKIE,
        path=SESSION_COOKIE_PATH,
        secure=config.auth_cookie_secure,
        httponly=True,
        samesite="strict",
    )
    response.delete_cookie(
        GOOGLE_COOKIE,
        path=GOOGLE_COOKIE_PATH,
        secure=config.auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )


def limit_counters(
    request: Request, scope: str, identity: str | None, limit: int, ip_limit: int
) -> list[tuple[str, int]]:
    """``(auth_limits key, maximum)`` per client IP and, when given, per ``identity``."""
    config = settings(request)
    client = request.client.host if request.client else "unknown"
    counters = [(access_hash(config, "limit", f"{scope}:ip:{client}"), ip_limit)]
    if identity is not None:
        counters.append((access_hash(config, "limit", f"{scope}:id:{identity}"), limit))
    return counters


async def throttled(
    db: AsyncSession,
    request: Request,
    scope: str,
    identity: str | None = None,
    *,
    limit: int = 10,
    ip_limit: int = 50,
) -> bool:
    """Whether the client IP or ``identity`` already used up its attempts (counts nothing)."""
    counters = limit_counters(request, scope, identity, limit, ip_limit)
    rows = await db.execute(
        select(AuthLimit.key, AuthLimit.hits).where(
            AuthLimit.key.in_([key for key, _ in counters]), AuthLimit.expires_at > utcnow()
        )
    )
    hits = {key: count for key, count in rows}
    return any(hits.get(key, 0) >= maximum for key, maximum in counters)


async def count_attempt(
    db: AsyncSession,
    request: Request,
    scope: str,
    identity: str | None = None,
    *,
    limit: int = 10,
    ip_limit: int = 50,
    seconds: int = LIMIT_SECONDS,
) -> bool:
    """Count one attempt per client IP and per ``identity`` in fixed windows of ``seconds``;
    returns whether a limit is now exceeded. Commits."""
    now = utcnow()
    await db.execute(
        delete(AuthLimit).where(AuthLimit.expires_at <= now), execution_options=UNSYNCHRONIZED
    )
    dialect = db.get_bind().dialect.name
    exceeded = False
    for key, maximum in limit_counters(request, scope, identity, limit, ip_limit):
        values = {"key": key, "hits": 1, "expires_at": now + timedelta(seconds=seconds)}
        bump = {"hits": AuthLimit.hits + 1}
        statement: Insert
        if dialect == "postgresql":
            statement = (
                postgresql.insert(AuthLimit)
                .values(values)
                .on_conflict_do_update(index_elements=[AuthLimit.key], set_=bump)
            )
        elif dialect == "sqlite":
            statement = (
                sqlite.insert(AuthLimit)
                .values(values)
                .on_conflict_do_update(index_elements=[AuthLimit.key], set_=bump)
            )
        else:
            raise RuntimeError(f"Unsupported database dialect for throttling: {dialect}")
        hits = await db.scalar(statement.returning(AuthLimit.hits))
        exceeded = exceeded or (hits is not None and hits > maximum)
    await db.commit()
    return exceeded


async def throttle(
    db: AsyncSession,
    request: Request,
    scope: str,
    identity: str | None = None,
    *,
    limit: int = 10,
    ip_limit: int = 50,
    seconds: int = LIMIT_SECONDS,
    code: str = "request_throttled",
) -> None:
    """Count an attempt; 429 ``code`` once the client IP or ``identity`` exceeds its limit."""
    if await count_attempt(
        db, request, scope, identity, limit=limit, ip_limit=ip_limit, seconds=seconds
    ):
        raise AppError(code, 429, headers={"Retry-After": str(seconds)})


def dev_login_allowed(config: Settings) -> bool:
    """Dev login needs ``ALLOW_INSECURE_LOCAL_LOGIN`` and loopback-only public origins (settings
    validation enforces it; re-checked here so no hand-built settings object can expose it)."""
    return config.dev_login_enabled and all(
        is_loopback(origin) for origin in config.public_origins
    )


async def require_dev_login(request: Request) -> None:
    # A dependency, so a disabled endpoint answers 404 before the body is validated.
    if not dev_login_allowed(settings(request)) or request.url.hostname not in LOOPBACK_HOSTS:
        raise AppError("not_found", 404)


async def dev_user(db: AsyncSession, role: UserRole) -> User:
    """Development account for ``role``: created on demand, re-enabled and kept in its role."""
    email = DEV_USERS[role]
    user = await db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, role=role, disabled=False, auth_version=1, created_at=utcnow())
        db.add(user)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()  # created by a concurrent sign-in
            user = await db.scalar(select(User).where(User.email == email))
            if user is None:
                raise
    if user.role != role or user.disabled:
        user.role = role
        user.disabled = False
        await revoke_user_sessions(db, user)
    return user


@router.get("/config", response_model=AuthConfigOut)
async def auth_config(request: Request, db: DB) -> AuthConfigOut:
    config = settings(request)
    return AuthConfigOut(
        google_enabled=config.google_enabled,
        dev_login_enabled=dev_login_allowed(config),
        password_reset_enabled=config.smtp_enabled,
        setup_required=not await has_enabled_admin(db),
    )


@router.get("/session", response_model=SessionOut)
async def current_session(request: Request, db: DB) -> SessionOut:
    user = await session_user(request, db)
    if user is None:
        return SessionOut(authenticated=False, user=None)
    return session_out(user)


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, db: DB) -> None:
    config = settings(request)
    token = request.cookies.get(SESSION_COOKIE, "")
    if TOKEN.fullmatch(token):
        await db.execute(
            delete(UserSession).where(
                UserSession.token_hash == access_hash(config, "session", token)
            )
        )
    browser = request.cookies.get(GOOGLE_COOKIE, "")
    if TOKEN.fullmatch(browser):
        await db.execute(
            delete(GoogleAuthFlow).where(
                GoogleAuthFlow.browser_hash == access_hash(config, "google-browser", browser)
            )
        )
    await db.commit()
    clear_auth_cookies(response, config)


@router.post("/dev-login", response_model=SessionOut, dependencies=[Depends(require_dev_login)])
async def dev_login(
    body: DevLoginIn, request: Request, response: Response, db: DB
) -> SessionOut:
    # Only failed attempts count, so local/e2e runs signing in repeatedly are never throttled.
    if await throttled(
        db, request, "dev-login", body.username, limit=DEV_LOGIN_LIMIT, ip_limit=DEV_LOGIN_IP_LIMIT
    ):
        raise AppError("login_throttled", 429, headers={"Retry-After": str(LIMIT_SECONDS)})
    expected = settings(request).local_login_password.get_secret_value().encode()
    if not secrets.compare_digest(body.password.encode(), expected):
        await count_attempt(
            db,
            request,
            "dev-login",
            body.username,
            limit=DEV_LOGIN_LIMIT,
            ip_limit=DEV_LOGIN_IP_LIMIT,
        )
        raise AppError("invalid_credentials", 401)
    user = await dev_user(db, body.username)
    return await issue_session(db, request, response, user)
