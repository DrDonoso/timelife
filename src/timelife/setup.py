"""The first administrator, and administrator recovery.

While no enabled administrator exists (a new installation), the login page shows a form to create
one, and ``POST /api/auth/setup`` creates and signs them in: the first person to open a new
Timelife becomes its administrator. Afterwards, ``python -m timelife.setup`` (run in the
container) prints a link, ``<origin>/setup#<code>``, that works once within an hour: its form
creates an administrator, or gives an existing account (say, the only administrator, who lost
the password) that password, administrator rights and access again."""

import argparse
import asyncio
import secrets
import sys
from collections.abc import Sequence
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Request, Response
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .auth import DB, access_hash, has_enabled_admin, issue_session, settings, throttle
from .config import Settings
from .contracts import SessionOut, SetupIn
from .db import AppSetting, User, create_db_engine, utcnow
from .errors import AppError
from .password_auth import set_password
from .passwords import hash_password

router = APIRouter(prefix="/api/auth", tags=["Setup"])

# app_settings key of the pending recovery link: {"token_hash": …, "expires_at": ISO 8601}.
SETUP_KEY = "admin_setup"
SETUP_PATH = "/setup"
DEFAULT_MINUTES = 60
MAX_MINUTES = 24 * 60
SETUP_IP_LIMIT = 10
# PostgreSQL advisory lock that runs setups one at a time (b"timelife" as an integer).
SETUP_LOCK = int.from_bytes(b"timelife", "big")


async def lock_setup(db: AsyncSession) -> None:
    """Hold the setup lock until the transaction ends (PostgreSQL; SQLite serves development
    and tests only)."""
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": SETUP_LOCK})


def recovery_open(config: Settings, marker: AppSetting | None, token: str | None) -> bool:
    """Whether ``token`` is the code of the pending, unexpired recovery link."""
    if marker is None or token is None or not isinstance(marker.value, dict):
        return False
    expected, expires = marker.value.get("token_hash"), marker.value.get("expires_at")
    if not isinstance(expected, str) or not isinstance(expires, str):
        return False
    try:
        expires_at = datetime.fromisoformat(expires)
    except ValueError:
        return False
    return expires_at.tzinfo is not None and expires_at > utcnow() and secrets.compare_digest(
        expected, access_hash(config, "admin-setup", token)
    )


@router.post("/setup", response_model=SessionOut)
async def setup(body: SetupIn, request: Request, response: Response, db: DB) -> SessionOut:
    """Create the first administrator, or follow a recovery link: the account of ``email``
    (created if missing) becomes an enabled administrator with this password, signed in here and
    out everywhere else. 403 ``setup_closed`` once an enabled administrator exists, unless
    ``token`` is the code of the pending recovery link."""
    config = settings(request)
    await throttle(db, request, "setup", ip_limit=SETUP_IP_LIMIT)
    await lock_setup(db)
    marker = await db.get(AppSetting, SETUP_KEY)
    if await has_enabled_admin(db) and not recovery_open(config, marker, body.token):
        raise AppError("setup_closed", 403)
    user = await db.scalar(select(User).where(User.email == body.email))
    if user is None:
        user = User(
            email=body.email,
            name=body.name,
            role="admin",
            disabled=False,
            auth_version=1,
            password_hash=await hash_password(body.password),
            must_change_password=False,
            created_at=utcnow(),
        )
        db.add(user)
        await db.flush()
    else:
        user.role, user.disabled = "admin", False
        if body.name:
            user.name = body.name
        await set_password(db, user, body.password, temporary=False)
    if marker is not None:
        await db.delete(marker)
    return await issue_session(db, request, response, user)


async def open_recovery(config: Settings, minutes: int) -> tuple[str, datetime]:
    """Store a new recovery link (replacing the pending one); returns its code and expiry."""
    token = secrets.token_hex(32)
    now = utcnow()
    expires = now + timedelta(minutes=minutes)
    value = {
        "token_hash": access_hash(config, "admin-setup", token),
        "expires_at": expires.isoformat(),
    }
    engine = create_db_engine(config.database_url)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            marker = await db.get(AppSetting, SETUP_KEY)
            if marker is None:
                db.add(AppSetting(key=SETUP_KEY, value=value, updated_at=now))
            else:
                marker.value, marker.updated_at = value, now
            await db.commit()
    finally:
        await engine.dispose()
    return token, expires


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m timelife.setup",
        description=(
            "Print a single-use link to create an administrator, or to give an existing account "
            "a new password and administrator rights (e.g. a lost administrator password)."
        ),
    )
    parser.add_argument(
        "--minutes",
        type=int,
        default=DEFAULT_MINUTES,
        help=f"how long the link works, 1-{MAX_MINUTES} (default {DEFAULT_MINUTES})",
    )
    args = parser.parse_args(argv)
    if not 1 <= args.minutes <= MAX_MINUTES:
        parser.error(f"--minutes must be between 1 and {MAX_MINUTES}")
    config = Settings()
    try:
        token, expires = asyncio.run(open_recovery(config, args.minutes))
    except (SQLAlchemyError, OSError) as error:
        print(
            f"Database not ready ({type(error).__name__}): check DATABASE_URL and run "
            "'alembic upgrade head'.",
            file=sys.stderr,
        )
        return 1
    until = expires.astimezone(ZoneInfo(config.tz))
    print("Open this link to create an administrator or recover an administrator account:")
    for origin in config.public_origins:
        print(f"  {origin}{SETUP_PATH}#{token}")
    print(
        f"It works once, until {until:%Y-%m-%d %H:%M} ({config.tz}). "
        "Running this command again replaces it."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
