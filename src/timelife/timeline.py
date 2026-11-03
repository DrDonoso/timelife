"""Timelines: one child's events outside the trash, or every child's together (the family view),
newest first, filtered like the search panel asks. A fixed number of queries whatever the number
of events (no per-event loading), so long timelines stay fast."""

import datetime as dt
import uuid
from collections import defaultdict
from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import ColumnElement, and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from . import crops
from .auth import DB, CurrentUser
from .contracts import Id, IdPath, SearchQuery, TimelineCoverOut, TimelineEventOut, TimelineOut
from .db import Child, Event, EventCategory, EventChild, Image
from .errors import AppError
from .events import NEWEST_FIRST, linked_to, matches_text, tagged_with_any

router = APIRouter(prefix="/api", tags=["Timeline"])

CategoryIds = Annotated[list[Id] | None, Query()]


def cover_out(
    image_id: uuid.UUID | None, dominant_color: str | None, framing: crops.Framing | None
) -> TimelineCoverOut | None:
    if image_id is None or dominant_color is None:
        return None
    return TimelineCoverOut(
        id=image_id, thumb_url=crops.thumb_url(image_id, framing), dominant_color=dominant_color
    )


async def timeline_out(
    db: AsyncSession,
    child_id: int | None,
    q: str | None,
    date_from: dt.date | None,
    date_to: dt.date | None,
    category_id: Sequence[int] | None,
) -> TimelineOut:
    """The timeline of ``child_id``, or of every child when None. ``q``: titles containing every
    word (accents and case ignored); ``date_from``/``date_to``: inclusive range; ``category_id``:
    events with any of them. ``total`` counts all the timeline's events outside the trash,
    ignoring the filters."""
    if date_from is not None and date_to is not None and date_from > date_to:
        raise AppError("invalid_request", 422, fields={"date_to": "value_error"})
    live: list[ColumnElement[bool]] = [Event.deleted_at.is_(None)]
    if child_id is not None:
        live.append(linked_to(child_id))
    scope = [*live, *matches_text(q)]
    if date_from is not None:
        scope.append(Event.date >= date_from)
    if date_to is not None:
        scope.append(Event.date <= date_to)
    if category_id:
        scope.append(tagged_with_any(category_id))
    total = await db.scalar(select(func.count()).select_from(Event).where(*live))

    cover = aliased(Image)
    image_count = (
        select(func.count(Image.id))
        .where(Image.event_id == Event.id)
        .correlate(Event)
        .scalar_subquery()
    )
    rows = (
        await db.execute(
            select(
                Event.id,
                Event.title,
                Event.date,
                Event.day_order,
                Event.created_at,
                cover.id.label("cover_id"),
                cover.dominant_color,
                cover.crop_x,
                cover.crop_y,
                cover.crop_zoom,
                image_count.label("image_count"),
            )
            .outerjoin(cover, and_(cover.id == Event.cover_image_id, cover.event_id == Event.id))
            .where(*scope)
            .order_by(*NEWEST_FIRST)
        )
    ).all()

    categories: defaultdict[int, list[int]] = defaultdict(list)
    children: defaultdict[int, list[int]] = defaultdict(list)
    if rows:
        matching = select(Event.id).where(*scope)
        for event_id, category in await db.execute(
            select(EventCategory.event_id, EventCategory.category_id)
            .where(EventCategory.event_id.in_(matching))
            .order_by(EventCategory.event_id, EventCategory.position, EventCategory.category_id)
        ):
            categories[event_id].append(category)
        for event_id, child in await db.execute(
            select(EventChild.event_id, EventChild.child_id)
            .where(EventChild.event_id.in_(matching))
            .order_by(EventChild.event_id, EventChild.child_id)
        ):
            children[event_id].append(child)

    return TimelineOut(
        child_id=child_id,
        total=total or 0,
        events=[
            TimelineEventOut(
                id=row.id,
                title=row.title,
                date=row.date,
                day_order=row.day_order,
                category_ids=categories[row.id],
                child_ids=children[row.id],
                cover=cover_out(
                    row.cover_id,
                    row.dominant_color,
                    None
                    if row.crop_x is None or row.crop_y is None or row.crop_zoom is None
                    else (row.crop_x, row.crop_y, row.crop_zoom),
                ),
                image_count=row.image_count or 0,
                created_at=row.created_at,
            )
            for row in rows
        ],
    )


@router.get("/children/{child_id}/timeline", response_model=TimelineOut)
async def child_timeline(
    child_id: IdPath,
    user: CurrentUser,
    db: DB,
    q: SearchQuery = None,
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
    category_id: CategoryIds = None,
) -> TimelineOut:
    # ``q``: titles containing every word (accents and case ignored); ``date_from``/``date_to``:
    # inclusive range; repeated ``category_id``: events with any of them. ``total`` counts all
    # the child's events outside the trash, ignoring the filters.
    if date_from is not None and date_to is not None and date_from > date_to:
        raise AppError("invalid_request", 422, fields={"date_to": "value_error"})
    if await db.scalar(select(Child.id).where(Child.id == child_id)) is None:
        raise AppError("child_not_found", 404)
    return await timeline_out(db, child_id, q, date_from, date_to, category_id)


@router.get("/timeline", response_model=TimelineOut)
async def family_timeline(
    user: CurrentUser,
    db: DB,
    q: SearchQuery = None,
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
    category_id: CategoryIds = None,
) -> TimelineOut:
    # Every child's events together (the "All together" view), with the same filters as a
    # child's timeline: ``child_id`` is null and each event's ``child_ids`` say whose it is.
    return await timeline_out(db, None, q, date_from, date_to, category_id)
