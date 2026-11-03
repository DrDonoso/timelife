"""E-mail and password sign-in, for users with a password (a temporary one an administrator gave
them, or one they chose).

``POST /api/auth/login`` signs in; a temporary password must be replaced first: the answer is 403
``password_change_required`` and the same request again with ``new_password`` signs in. Signed-in
users change their password with ``POST /api/auth/password``. With SMTP configured, ``POST
/api/auth/password/forgot`` e-mails a link (``/reset-password#<token>``, one hour, single use)
whose page sets a new password with ``POST /api/auth/password/reset``. A new password signs the
user out everywhere else and cancels their pending links."""

import secrets
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import mail
from .auth import (
    DB,
    LIMIT_SECONDS,
    UNSYNCHRONIZED,
    CurrentUser,
    access_hash,
    count_attempt,
    issue_session,
    request_origin,
    revoke_user_sessions,
    settings,
    throttle,
    throttled,
)
from .contracts import (
    PasswordChangeIn,
    PasswordForgotIn,
    PasswordLoginIn,
    PasswordResetIn,
    SessionOut,
)
from .db import PasswordReset, User, utcnow
from .errors import AppError
from .passwords import hash_password, needs_rehash, same_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["Password sign-in"])

RESET_PATH = "/reset-password"
RESET_SECONDS = 3600
# Failed sign-ins (and failed password changes) per address (account) and per client IP.
LOGIN_LIMIT = 10
LOGIN_IP_LIMIT = 50
# "Forgot password" e-mails per address and per client IP, in windows of 15 minutes.
FORGOT_LIMIT = 3
FORGOT_IP_LIMIT = 10
FORGOT_SECONDS = 900
RESET_IP_LIMIT = 20


async def set_password(db: AsyncSession, user: User, password: str, *, temporary: bool) -> None:
    """Give ``user`` a new password (``temporary``: to be changed at the next sign-in), sign them
    out everywhere and cancel their "forgot password" links. The caller commits."""
    user.password_hash = await hash_password(password)
    user.must_change_password = temporary
    await revoke_user_sessions(db, user)
    await db.execute(
        delete(PasswordReset).where(PasswordReset.user_id == user.id),
        execution_options=UNSYNCHRONIZED,
    )


def too_many_sign_ins() -> AppError:
    return AppError("login_throttled", 429, headers={"Retry-After": str(LIMIT_SECONDS)})


@router.post("/login", response_model=SessionOut)
async def login(
    body: PasswordLoginIn, request: Request, response: Response, db: DB
) -> SessionOut:
    # Only failed attempts count, so people signing in often are never throttled.
    if await throttled(
        db, request, "login", body.email, limit=LOGIN_LIMIT, ip_limit=LOGIN_IP_LIMIT
    ):
        raise too_many_sign_ins()
    user = await db.scalar(select(User).where(User.email == body.email))
    # Unknown addresses and accounts without a password take as long as a wrong password.
    valid = await verify_password(body.password, None if user is None else user.password_hash)
    if user is None or user.password_hash is None or not valid:
        await count_attempt(
            db, request, "login", body.email, limit=LOGIN_LIMIT, ip_limit=LOGIN_IP_LIMIT
        )
        raise AppError("invalid_credentials", 401)
    # Only told to someone who knows the password.
    if user.disabled:
        raise AppError("account_disabled", 403)
    if user.must_change_password:
        if body.new_password is None:
            raise AppError("password_change_required", 403)
        if same_password(body.new_password, body.password):
            raise AppError("password_unchanged", 422)
        await set_password(db, user, body.new_password, temporary=False)
    elif needs_rehash(user.password_hash):
        user.password_hash = await hash_password(body.password)
    return await issue_session(db, request, response, user)


@router.post("/password", response_model=SessionOut)
async def change_password(
    body: PasswordChangeIn, request: Request, response: Response, current: CurrentUser, db: DB
) -> SessionOut:
    """Replace the signed-in user's password: this browser gets a new session, every other one is
    signed out."""
    account = f"user:{current.id}"
    if await throttled(
        db, request, "password-change", account, limit=LOGIN_LIMIT, ip_limit=LOGIN_IP_LIMIT
    ):
        raise too_many_sign_ins()
    user = await db.get(User, current.id)
    if user is None:
        raise AppError("authentication_required", 401)
    if user.password_hash is None:
        raise AppError("password_not_set", 409)
    if not await verify_password(body.current_password, user.password_hash):
        await count_attempt(
            db, request, "password-change", account, limit=LOGIN_LIMIT, ip_limit=LOGIN_IP_LIMIT
        )
        raise AppError("current_password_invalid", 422)
    if same_password(body.new_password, body.current_password):
        raise AppError("password_unchanged", 422)
    await set_password(db, user, body.new_password, temporary=False)
    return await issue_session(db, request, response, user)


async def require_mail(request: Request) -> None:
    # A dependency, so without SMTP the endpoint answers 404 before the body is validated.
    if not settings(request).smtp_enabled:
        raise AppError("not_found", 404)


@router.post("/password/forgot", status_code=204, dependencies=[Depends(require_mail)])
async def forgot_password(
    body: PasswordForgotIn, request: Request, background: BackgroundTasks, db: DB
) -> None:
    """E-mail a link to choose a new password to an enabled account. The answer is the same
    whether the address has an account or not; the e-mail is sent after it."""
    config = settings(request)
    origin = request_origin(request, config)
    await throttle(
        db,
        request,
        "password-forgot",
        body.email,
        limit=FORGOT_LIMIT,
        ip_limit=FORGOT_IP_LIMIT,
        seconds=FORGOT_SECONDS,
    )
    user = await db.scalar(
        select(User).where(User.email == body.email, User.disabled.is_(False))
    )
    if user is None:
        return
    token = secrets.token_hex(32)
    now = utcnow()
    # One pending link per user: asking again replaces it.
    await db.execute(
        delete(PasswordReset).where(PasswordReset.user_id == user.id),
        execution_options=UNSYNCHRONIZED,
    )
    db.add(
        PasswordReset(
            token_hash=access_hash(config, "password-reset", token),
            user_id=user.id,
            expires_at=now + timedelta(seconds=RESET_SECONDS),
            created_at=now,
        )
    )
    await db.commit()
    link = f"{origin}{RESET_PATH}#{token}"
    message = mail.password_reset_message(config, user.email, user.name, link, body.locale)
    background.add_task(mail.deliver, request.app.state.mailer, message, "password reset")


@router.post("/password/reset", response_model=SessionOut)
async def reset_password(
    body: PasswordResetIn, request: Request, response: Response, db: DB
) -> SessionOut:
    """Choose a new password with an e-mailed link and sign in. 400 ``password_reset_invalid``
    when the link is unknown, expired or already used."""
    config = settings(request)
    await throttle(db, request, "password-reset", ip_limit=RESET_IP_LIMIT)
    # Taken atomically: a link works once, even when it is used twice at the same time.
    user_id = await db.scalar(
        delete(PasswordReset)
        .where(
            PasswordReset.token_hash == access_hash(config, "password-reset", body.token),
            PasswordReset.expires_at > utcnow(),
        )
        .returning(PasswordReset.user_id),
        execution_options=UNSYNCHRONIZED,
    )
    user = None if user_id is None else await db.get(User, user_id)
    if user is None:
        raise AppError("password_reset_invalid", 400)
    if user.disabled:
        raise AppError("account_disabled", 403)
    await set_password(db, user, body.new_password, temporary=False)
    return await issue_session(db, request, response, user)
