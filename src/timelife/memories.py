"""Memories ("on this day"): the milestones that turn a whole number of months (1 to 11) or years
old today. The interface finds them in the family timeline, on the calendar of the user's device;
the server only keeps, per user, the last day they were told about them
(``users.memories_announced_on``) and the last day they looked at them
(``users.memories_opened_on``), so each person hears about them once a day on any device."""

import datetime as dt

from fastapi import APIRouter
from sqlalchemy import select

from .auth import DB, CurrentUser
from .contracts import MemoriesOut, MemoriesSeenIn
from .db import User
from .errors import AppError

router = APIRouter(prefix="/api", tags=["Memories"])


def memories_out(user: User) -> MemoriesOut:
    return MemoriesOut(announced_on=user.memories_announced_on, opened_on=user.memories_opened_on)


def latest(stored: dt.date | None, given: dt.date | None) -> dt.date | None:
    if given is None:
        return stored
    return given if stored is None or given > stored else stored


@router.get("/memories", response_model=MemoriesOut)
async def memories(user: CurrentUser, db: DB) -> MemoriesOut:
    account = await db.get(User, user.id)
    if account is None:
        raise AppError("authentication_required", 401)
    return memories_out(account)


@router.post("/memories/seen", response_model=MemoriesOut)
async def mark_seen(body: MemoriesSeenIn, user: CurrentUser, db: DB) -> MemoriesOut:
    """Record the day the user was told about their memories (``announced_on``) and the day they
    looked at them (``opened_on``). A day before the one recorded changes nothing (another device
    may be behind, in another time zone)."""
    # Locked (FOR NO KEY UPDATE on PostgreSQL), so that two devices saving at once keep the latest.
    account = await db.scalar(
        select(User)
        .where(User.id == user.id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    if account is None:
        raise AppError("authentication_required", 401)
    account.memories_announced_on = latest(account.memories_announced_on, body.announced_on)
    account.memories_opened_on = latest(account.memories_opened_on, body.opened_on)
    await db.commit()
    return memories_out(account)
