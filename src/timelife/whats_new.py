"""What's new: which notes about Timelife's changes each user has already read.

The notes ship with the interface (``frontend/src/whatsNew/notes/``, one JSON file per note named
``YYYY-MM-DD-slug``) and the server never reads them: it only keeps the ids each user has read
(``users.whats_new_seen``). NULL means the interface never recorded any, as for a new user: it then
marks every current note as read without showing them, so only later changes are announced."""

from fastapi import APIRouter
from sqlalchemy import select

from .auth import DB, CurrentUser
from .contracts import WhatsNewOut, WhatsNewSeenIn
from .db import User
from .errors import AppError

router = APIRouter(prefix="/api", tags=["What's new"])

# The newest ids kept per user: far more notes than will ever ship, and a bound on what a user
# can make the server store.
MAX_SEEN = 1000


def seen_out(seen: object) -> WhatsNewOut:
    return WhatsNewOut(seen=seen if isinstance(seen, list) else None)


@router.get("/whats-new", response_model=WhatsNewOut)
async def whats_new(user: CurrentUser, db: DB) -> WhatsNewOut:
    return seen_out(await db.scalar(select(User.whats_new_seen).where(User.id == user.id)))


@router.post("/whats-new/seen", response_model=WhatsNewOut)
async def mark_seen(body: WhatsNewSeenIn, user: CurrentUser, db: DB) -> WhatsNewOut:
    """Add ``ids`` to the notes the user has read (ids already there change nothing)."""
    # Locked (FOR NO KEY UPDATE on PostgreSQL), so that two tabs saving at once both add theirs.
    account = await db.scalar(
        select(User)
        .where(User.id == user.id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    if account is None:
        raise AppError("authentication_required", 401)
    read = account.whats_new_seen if isinstance(account.whats_new_seen, list) else []
    # Ids start with their date: sorted, the newest are the last.
    account.whats_new_seen = sorted({*read, *body.ids})[-MAX_SEEN:]
    await db.commit()
    return seen_out(account.whats_new_seen)
