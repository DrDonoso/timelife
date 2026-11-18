"""Memories ("on this day"): the milestones that turn a whole number of months (1 to 11) or years
old today. The interface finds them in the family timeline, on the calendar of the user's device;
the server only keeps, per user, the last day they were told about them
(``users.memories_announced_on``) and the last day they looked at them
(``users.memories_opened_on``), so each person hears about them once a day on any device.

The server also finds them itself (``memories_on``), with the same rules as the interface
(``frontend/src/memories/memories.ts``), for the morning notification (``push``)."""

import calendar
import datetime as dt
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import DB, CurrentUser
from .contracts import MemoriesOut, MemoriesSeenIn
from .db import Child, Event, EventChild, User
from .errors import AppError
from .events import NEWEST_FIRST

router = APIRouter(prefix="/api", tags=["Memories"])

MemoryUnit = Literal["months", "years"]


@dataclass(frozen=True)
class Memory:
    event_id: int
    title: str
    # ``months``: 1 to 11; ``years``: 1 or more.
    unit: MemoryUnit
    count: int
    # Where it opens: over the timeline of its first child (the family one without children).
    path: str

    @property
    def months(self) -> int:
        return self.count * 12 if self.unit == "years" else self.count


def months_between(start: dt.date, end: dt.date) -> int:
    """Calendar months from ``start`` to ``end``, whatever their days."""
    return (end.year - start.year) * 12 + end.month - start.month


def add_months(day: dt.date, months: int) -> dt.date:
    """``day`` ``months`` later, on the last day of the month when that month is shorter."""
    year, month = divmod(day.year * 12 + day.month - 1 + months, 12)
    return dt.date(year, month + 1, min(day.day, calendar.monthrange(year, month + 1)[1]))


def memory_age(date: dt.date, day: dt.date) -> tuple[MemoryUnit, int] | None:
    """How old a milestone of ``date`` is on ``day`` when that makes it one of the day's memories:
    1 to 11 months, or whole years, counted from the same day of the month."""
    months = months_between(date, day)
    if months < 1 or (months >= 12 and months % 12) or add_months(date, months) != day:
        return None
    return ("months", months) if months < 12 else ("years", months // 12)


def event_path(event_id: int, slug: str | None) -> str:
    base = f"/c/{slug}" if slug else "/all"
    return f"{base}/e/{event_id}?zoom=events&focus=e{event_id}"


async def memories_on(db: AsyncSession, day: dt.date) -> list[Memory]:
    """The memories of ``day`` among the family's milestones outside the trash: the most recent
    first, those of the same age in the order of the timeline."""
    found: list[tuple[int, str, MemoryUnit, int]] = []
    for event_id, title, date in await db.execute(
        select(Event.id, Event.title, Event.date)
        .where(Event.deleted_at.is_(None), Event.date < day)
        .order_by(*NEWEST_FIRST)
    ):
        age = memory_age(date, day)
        if age is not None:
            found.append((event_id, title, *age))
    if not found:
        return []
    owners: dict[int, str] = {}
    for event_id, slug in await db.execute(
        select(EventChild.event_id, Child.slug)
        .join(Child, Child.id == EventChild.child_id)
        .where(EventChild.event_id.in_([event_id for event_id, *_ in found]))
        .order_by(Child.sort_order, Child.id)
    ):
        owners.setdefault(event_id, slug)
    memories = [
        Memory(event_id, title, unit, count, event_path(event_id, owners.get(event_id)))
        for event_id, title, unit, count in found
    ]
    return sorted(memories, key=lambda memory: memory.months)


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
