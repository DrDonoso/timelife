"""Events: the administrators' list, editor operations and trash, and the event detail every
signed-in user sees.

An event belongs to one or more children and to ordered categories (the first is the primary
one) and owns ordered, named images (purpose ``event``: photos, videos and Live Photos). Saving
attaches pending uploads, takes the images' order, names, thumbnail framings (``crops``) and Live
choices from the list and deletes the images
left out (their folders once the transaction commits); the cover must be one of the images
(default: the first). An edit carries the ``version`` it started from (409 ``event_stale``
otherwise). Deleting moves an event to the trash (``deleted_at``); only trashed events can be
restored or purged (rows and image folders). Every change locks the event row, so concurrent
changes of one event run in turn.

``insert_event`` and the filters (``matches_text``, ``linked_to``, ``tagged_with_any``,
``NEWEST_FIRST``) are shared with ``timeline`` and ``demo``.

Events of the same date are shown in ``day_order`` (lower first): a new event, or one moved to
another date, goes first of its day, and administrators reorder a day with ``PUT
/api/admin/events/day-order``."""

import datetime as dt
import uuid
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Query, Request
from sqlalchemy import ColumnElement, and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute, selectinload
from starlette.concurrency import run_in_threadpool

from . import crops, media
from .auth import DB, AdminUser, CurrentUser, settings
from .contracts import (
    DayOrderIn,
    EventIn,
    EventOut,
    EventPageOut,
    EventSummaryOut,
    EventUpdateIn,
    IdPath,
    IdQuery,
    LocationOut,
    SearchQuery,
    TrashItemOut,
)
from .db import Category, Child, Event, EventCategory, EventChild, Image, utcnow
from .errors import AppError
from .text import normalize_search, search_tokens

router = APIRouter(prefix="/api", tags=["Events"])
admin_router = APIRouter(prefix="/api/admin", tags=["Events"])

TITLE_SEARCH_LENGTH = 240
# Every list of events: newest date first, then the day's order, then the most recently created.
NEWEST_FIRST = (Event.date.desc(), Event.day_order, Event.created_at.desc(), Event.id.desc())
LINKS = (selectinload(Event.child_links), selectinload(Event.category_links))
DETAIL = (*LINKS, selectinload(Event.images))
# Places suggested to the editor's location field (the most used ones).
MAX_LOCATIONS = 500


# Filters ------------------------------------------------------------------------------------


def title_search(title: str) -> str:
    """``events.title_search`` of ``title``: its accent- and case-insensitive form."""
    return normalize_search(title)[:TITLE_SEARCH_LENGTH]


def matches_text(q: str | None) -> list[ColumnElement[bool]]:
    """Conditions keeping the events whose title contains every normalized word of ``q``."""
    return [
        Event.title_search.contains(token, autoescape=True) for token in search_tokens(q or "")
    ]


def linked_to(child_id: int) -> ColumnElement[bool]:
    # Explicit correlation: these conditions are also nested in subqueries of link tables.
    return (
        select(EventChild.event_id)
        .where(EventChild.event_id == Event.id, EventChild.child_id == child_id)
        .correlate(Event)
        .exists()
    )


def tagged_with_any(category_ids: Sequence[int]) -> ColumnElement[bool]:
    return (
        select(EventCategory.event_id)
        .where(
            EventCategory.event_id == Event.id,
            EventCategory.category_id.in_(sorted(set(category_ids))),
        )
        .correlate(Event)
        .exists()
    )


# Loading and responses ----------------------------------------------------------------------


async def load_event(
    db: AsyncSession, event_id: int, *, lock: bool = False, detail: bool = True
) -> Event | None:
    """The event (trashed or not) with its links and images when ``detail``; ``lock`` keeps its
    row locked until the transaction ends."""
    query = select(Event).where(Event.id == event_id).execution_options(populate_existing=True)
    if detail:
        query = query.options(*DETAIL)
    if lock:
        query = query.with_for_update()
    return await db.scalar(query)


def event_out(event: Event) -> EventOut:
    return EventOut(
        id=event.id,
        title=event.title,
        date=event.date,
        notes=event.notes,
        location=event.location,
        child_ids=sorted(event.child_ids),
        category_ids=event.category_ids,
        images=[
            media.image_out(image)
            for image in sorted(event.images, key=lambda image: image.position)
        ],
        cover_image_id=event.cover_image_id,
        version=event.version,
        created_at=event.created_at,
        updated_at=event.updated_at,
        deleted_at=event.deleted_at,
    )


async def saved(db: AsyncSession, event_id: int) -> EventOut:
    """``EventOut`` of a just committed event, reloaded exactly as a later GET returns it."""
    db.expunge_all()
    event = await load_event(db, event_id)
    if event is None:
        raise AppError("event_not_found", 404)
    return event_out(event)


async def covers_and_counts(
    db: AsyncSession, *scope: ColumnElement[bool]
) -> tuple[dict[int, Image], dict[int, tuple[int, int]]]:
    """Cover image and (images, videos) counts of the events matching ``scope``, by event id."""
    covers = {
        event_id: image
        for event_id, image in await db.execute(
            select(Event.id, Image)
            .join(Image, and_(Image.id == Event.cover_image_id, Image.event_id == Event.id))
            .where(*scope)
        )
    }
    counts = {
        event_id: (count, videos)
        for event_id, count, videos in await db.execute(
            select(
                Event.id,
                func.count(Image.id),
                func.count(Image.id).filter(Image.kind == "video"),
            )
            .join(Image, Image.event_id == Event.id)
            .where(*scope)
            .group_by(Event.id)
        )
    }
    return covers, counts


def summary_out(
    event: Event, covers: Mapping[int, Image], counts: Mapping[int, tuple[int, int]]
) -> EventSummaryOut:
    cover = covers.get(event.id)
    image_count, video_count = counts.get(event.id, (0, 0))
    return EventSummaryOut(
        id=event.id,
        title=event.title,
        date=event.date,
        location=event.location,
        child_ids=sorted(event.child_ids),
        category_ids=event.category_ids,
        cover=None if cover is None else media.image_out(cover),
        image_count=image_count,
        video_count=video_count,
        updated_at=event.updated_at,
    )


def trash_item(
    event: Event, covers: Mapping[int, Image], counts: Mapping[int, tuple[int, int]]
) -> TrashItemOut:
    cover = covers.get(event.id)
    deleter = event.deleted_by
    image_count, video_count = counts.get(event.id, (0, 0))
    return TrashItemOut(
        id=event.id,
        title=event.title,
        date=event.date,
        child_ids=sorted(event.child_ids),
        category_ids=event.category_ids,
        cover=None if cover is None else media.image_out(cover),
        image_count=image_count,
        video_count=video_count,
        deleted_at=event.deleted_at,
        deleted_by=None if deleter is None else deleter.name or deleter.email,
    )


# Saving -------------------------------------------------------------------------------------


async def missing(
    db: AsyncSession, column: InstrumentedAttribute[int], ids: Sequence[int]
) -> list[int]:
    """The ``ids`` that have no row (``column`` is the primary key of the table)."""
    found = set(await db.scalars(select(column).where(column.in_(ids))))
    return [item for item in ids if item not in found]


async def missing_children(db: AsyncSession, ids: Sequence[int]) -> list[int]:
    return await missing(db, Child.id, ids)


async def missing_categories(db: AsyncSession, ids: Sequence[int]) -> list[int]:
    return await missing(db, Category.id, ids)


async def ensure_references(db: AsyncSession, body: EventIn) -> None:
    """422 ``invalid_child`` / ``invalid_category`` unless every child and category exists."""
    if await missing_children(db, body.child_ids):
        raise AppError("invalid_child", 422)
    if await missing_categories(db, body.category_ids):
        raise AppError("invalid_category", 422)


async def reference_race(db: AsyncSession, body: EventIn) -> None:
    """After a failed write: roll back, then 422 ``invalid_child``/``invalid_category`` if one was
    deleted meanwhile (the foreign keys caught what ``ensure_references`` could not see yet)."""
    await db.rollback()
    await ensure_references(db, body)


def chosen_cover(body: EventIn) -> uuid.UUID | None:
    """``cover_image_id`` when it is one of the images (422 ``invalid_cover`` otherwise), else the
    first image; None without images."""
    ids = [image.id for image in body.images]
    if body.cover_image_id is None:
        return ids[0] if ids else None
    if body.cover_image_id not in ids:
        raise AppError("invalid_cover", 422)
    return body.cover_image_id


def write(event: Event, body: EventIn, user_id: int | None, now: dt.datetime) -> None:
    event.title = body.title
    event.title_search = title_search(body.title)
    event.date = body.date
    event.notes = body.notes
    event.location = body.location
    event.cover_image_id = chosen_cover(body)
    event.updated_by_id = user_id
    event.updated_at = now


def link(
    event: Event,
    body: EventIn,
    children: Mapping[int, EventChild],
    categories: Mapping[int, EventCategory],
) -> None:
    """Set the event's children and categories (positions in list order), reusing its current
    ``children``/``categories`` links that stay."""
    event.child_links = [
        children.get(child_id) or EventChild(child_id=child_id) for child_id in body.child_ids
    ]
    ordered: list[EventCategory] = []
    for position, category_id in enumerate(body.category_ids):
        category = categories.get(category_id) or EventCategory(category_id=category_id)
        category.position = position
        ordered.append(category)
    event.category_links = ordered


async def place_images(
    db: AsyncSession, event: Event, body: EventIn, previous: Sequence[Image], media_dir: Path
) -> None:
    """Attach the listed images (pending uploads or already the event's; 422 ``invalid_image``
    otherwise) with positions, names, thumbnail framings and Live choices in list order, and
    delete the ``previous`` images left out (their folders once the transaction commits).
    Flushes."""
    images = await media.attach_pending(
        db, [item.id for item in body.images], purpose="event", event_id=event.id
    )
    for position, (image, item) in enumerate(zip(images, body.images, strict=True)):
        image.position = position
        image.name = item.name
        image.live = item.live and image.is_live_photo
        crop = item.crop
        framing = (
            None
            if crop is None
            else crops.normalize(crop.x, crop.y, crop.zoom, image.width, image.height)
        )
        image.crop_x, image.crop_y, image.crop_zoom = framing or (None, None, None)
    listed = {image.id for image in images}
    await media.delete_images(
        db, [image for image in previous if image.id not in listed], media_dir
    )
    await db.flush()


async def prune_thumbnails(media_dir: Path, event: EventOut) -> None:
    """After a save: remove the framed thumbnails the event's images no longer use."""
    current = {
        image.id: None if image.crop is None else crops.key(
            (image.crop.x, image.crop.y, image.crop.zoom)
        )
        for image in event.images
    }
    await run_in_threadpool(media.prune_framed_thumbs, media_dir, current)


async def first_of_day(db: AsyncSession, date: dt.date, *, other_than: int | None = None) -> int:
    """``day_order`` that puts an event before every other live event of ``date``."""
    query = select(func.min(Event.day_order)).where(
        Event.date == date, Event.deleted_at.is_(None)
    )
    if other_than is not None:
        query = query.where(Event.id != other_than)
    lowest = await db.scalar(query)
    return 0 if lowest is None else lowest - 1


async def insert_event(
    db: AsyncSession,
    body: EventIn,
    *,
    user_id: int | None,
    media_dir: Path,
    now: dt.datetime | None = None,
) -> Event:
    """Validate ``body`` and add it as a new event with its links and images, first of its day;
    flushes, the caller commits. 422 ``invalid_child``, ``invalid_category``, ``invalid_cover``
    or ``invalid_image``."""
    await ensure_references(db, body)
    now = now or utcnow()
    event = Event(
        version=1,
        created_by_id=user_id,
        created_at=now,
        day_order=await first_of_day(db, body.date),
    )
    write(event, body, user_id, now)
    link(event, body, {}, {})
    db.add(event)
    await db.flush()
    await place_images(db, event, body, (), media_dir)
    return event


async def change_event(
    db: AsyncSession, event: Event, body: EventIn, *, user_id: int, media_dir: Path
) -> None:
    """Validate ``body`` and write it to ``event`` (loaded with ``DETAIL`` and locked), bumping
    its version; an event moved to another date goes first of that day. Flushes, the caller
    commits. Same errors as ``insert_event``."""
    await ensure_references(db, body)
    previous = list(event.images)
    if body.date != event.date:
        event.day_order = await first_of_day(db, body.date, other_than=event.id)
    write(event, body, user_id, utcnow())
    link(
        event,
        body,
        {item.child_id: item for item in event.child_links},
        {item.category_id: item for item in event.category_links},
    )
    event.version += 1
    await place_images(db, event, body, previous, media_dir)


async def trashed_event(db: AsyncSession, event_id: int) -> Event:
    """The trashed event, row-locked; 404 ``event_not_found`` or 409 ``event_not_deleted``."""
    event = await load_event(db, event_id, lock=True, detail=False)
    if event is None:
        raise AppError("event_not_found", 404)
    if event.deleted_at is None:
        raise AppError("event_not_deleted", 409)
    return event


# Routes -------------------------------------------------------------------------------------


@admin_router.get("/events", response_model=EventPageOut)
async def list_events(
    admin: AdminUser,
    db: DB,
    q: SearchQuery = None,
    child_id: IdQuery = None,
    category_id: IdQuery = None,
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
    page: Annotated[int, Query(ge=1, le=100_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> EventPageOut:
    # Events not in the trash, newest first. ``q`` keeps titles containing every word (accents
    # and case ignored); ``child_id``/``category_id`` keep the events linked to them;
    # ``date_from``/``date_to`` is an inclusive date range.
    if date_from is not None and date_to is not None and date_from > date_to:
        raise AppError("invalid_request", 422, fields={"date_to": "value_error"})
    scope = [Event.deleted_at.is_(None), *matches_text(q)]
    if child_id is not None:
        scope.append(linked_to(child_id))
    if category_id is not None:
        scope.append(tagged_with_any([category_id]))
    if date_from is not None:
        scope.append(Event.date >= date_from)
    if date_to is not None:
        scope.append(Event.date <= date_to)
    total = await db.scalar(select(func.count()).select_from(Event).where(*scope))
    rows = list(
        await db.scalars(
            select(Event)
            .where(*scope)
            .order_by(*NEWEST_FIRST)
            .offset((page - 1) * page_size)
            .limit(page_size)
            .options(*LINKS)
        )
    )
    covers: dict[int, Image] = {}
    counts: dict[int, tuple[int, int]] = {}
    if rows:
        covers, counts = await covers_and_counts(db, Event.id.in_([row.id for row in rows]))
    return EventPageOut(
        items=[summary_out(row, covers, counts) for row in rows],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


@admin_router.get("/locations", response_model=list[LocationOut])
async def list_locations(admin: AdminUser, db: DB) -> list[LocationOut]:
    # Places of the events outside the trash, for the editor's suggestions. Spellings that differ
    # only in case or accents are one place, named by its most used spelling (on a tie, the one
    # saved last); the most used places first, then alphabetically (accents and case ignored); at
    # most MAX_LOCATIONS.
    spellings = await db.execute(
        select(Event.location, func.count(), func.max(Event.updated_at))
        .where(Event.deleted_at.is_(None), Event.location.is_not(None))
        .group_by(Event.location)
    )
    places: dict[str, list[tuple[str, int, dt.datetime]]] = {}
    for location, count, latest in spellings:
        if location:
            places.setdefault(normalize_search(location), []).append((location, count, latest))
    merged: list[tuple[str, str, int]] = []
    for key, variants in places.items():
        name = max(variants, key=lambda variant: (variant[1], variant[2]))[0]
        merged.append((key, name, sum(uses for _, uses, _ in variants)))
    merged.sort(key=lambda place: (-place[2], place[0], place[1]))
    return [LocationOut(name=name, count=count) for _, name, count in merged[:MAX_LOCATIONS]]


@admin_router.post("/events", response_model=EventOut, status_code=201)
async def create_event(body: EventIn, request: Request, admin: AdminUser, db: DB) -> EventOut:
    media_dir = settings(request).media_dir
    try:
        event = await insert_event(db, body, user_id=admin.id, media_dir=media_dir)
        event_id = event.id
        await db.commit()
    except IntegrityError:
        await reference_race(db, body)
        raise
    out = await saved(db, event_id)
    await prune_thumbnails(media_dir, out)
    return out


# Declared before "/events/{event_id}" so "day-order" is never parsed as an id.
@admin_router.put("/events/day-order", response_model=list[EventSummaryOut])
async def reorder_day(body: DayOrderIn, admin: AdminUser, db: DB) -> list[EventSummaryOut]:
    # ``ids``: events of ``date`` (not in the trash) in the order they should be shown, the first
    # one first. A subset (e.g. a filtered or paged list) is reordered among the places its events
    # already take; the day's other events keep theirs. 422 ``invalid_order`` when an id is not a
    # live event of that date. Answers every live event of the day in the new order.
    day = list(
        await db.scalars(
            select(Event)
            .where(Event.date == body.date, Event.deleted_at.is_(None))
            .order_by(*NEWEST_FIRST)
            .with_for_update()
            .options(*LINKS)
        )
    )
    current = [event.id for event in day]
    wanted = set(body.ids)
    if not wanted <= set(current):
        raise AppError("invalid_order", 422)
    order = list(current)
    slots = [index for index, event_id in enumerate(current) if event_id in wanted]
    for slot, event_id in zip(slots, body.ids, strict=True):
        order[slot] = event_id
    by_id = {event.id: event for event in day}
    for position, event_id in enumerate(order):
        by_id[event_id].day_order = position
    await db.commit()
    covers, counts = await covers_and_counts(db, Event.id.in_(order))
    return [summary_out(by_id[event_id], covers, counts) for event_id in order]


@admin_router.get("/events/{event_id}", response_model=EventOut)
async def get_admin_event(event_id: IdPath, admin: AdminUser, db: DB) -> EventOut:
    # Trashed events too (``deleted_at`` set).
    event = await load_event(db, event_id)
    if event is None:
        raise AppError("event_not_found", 404)
    return event_out(event)


@admin_router.put("/events/{event_id}", response_model=EventOut)
async def update_event(
    event_id: IdPath, body: EventUpdateIn, request: Request, admin: AdminUser, db: DB
) -> EventOut:
    # ``version`` must be the event's current one (409 event_stale) and becomes version + 1.
    # Trashed events are not found. Images left out of ``images`` are deleted.
    event = await load_event(db, event_id, lock=True)
    if event is None or event.deleted_at is not None:
        raise AppError("event_not_found", 404)
    if body.version != event.version:
        raise AppError("event_stale", 409)
    media_dir = settings(request).media_dir
    try:
        await change_event(db, event, body, user_id=admin.id, media_dir=media_dir)
        await db.commit()
    except IntegrityError:
        await reference_race(db, body)
        raise
    out = await saved(db, event_id)
    await prune_thumbnails(media_dir, out)
    return out


@admin_router.delete("/events/{event_id}", status_code=204)
async def delete_event(event_id: IdPath, admin: AdminUser, db: DB) -> None:
    # Moves the event to the trash.
    event = await load_event(db, event_id, lock=True, detail=False)
    if event is None or event.deleted_at is not None:
        raise AppError("event_not_found", 404)
    event.deleted_at = utcnow()
    event.deleted_by_id = admin.id
    await db.commit()


@admin_router.get("/trash", response_model=list[TrashItemOut])
async def list_trash(admin: AdminUser, db: DB) -> list[TrashItemOut]:
    # Most recently deleted first. ``deleted_by``: name (else e-mail) of the administrator who
    # deleted the event, null once that account is gone.
    trashed = Event.deleted_at.is_not(None)
    rows = list(
        await db.scalars(
            select(Event)
            .where(trashed)
            .order_by(Event.deleted_at.desc(), Event.id.desc())
            .options(*LINKS, selectinload(Event.deleted_by))
        )
    )
    covers, counts = await covers_and_counts(db, trashed) if rows else ({}, {})
    return [trash_item(row, covers, counts) for row in rows]


@admin_router.post("/trash/{event_id}/restore", response_model=EventOut)
async def restore_event(event_id: IdPath, admin: AdminUser, db: DB) -> EventOut:
    event = await trashed_event(db, event_id)
    event.deleted_at = None
    event.deleted_by_id = None
    await db.commit()
    return await saved(db, event_id)


@admin_router.delete("/trash/{event_id}", status_code=204)
async def purge_event(event_id: IdPath, request: Request, admin: AdminUser, db: DB) -> None:
    # Permanent: the rows go now, the image folders once the deletion is committed.
    event = await trashed_event(db, event_id)
    images = list(await db.scalars(select(Image).where(Image.event_id == event_id)))
    await media.delete_images(db, images, settings(request).media_dir)
    await db.delete(event)
    await db.commit()


@router.get("/events/{event_id}", response_model=EventOut)
async def get_event(event_id: IdPath, user: CurrentUser, db: DB) -> EventOut:
    # Trashed events are not found.
    event = await load_event(db, event_id)
    if event is None or event.deleted_at is not None:
        raise AppError("event_not_found", 404)
    return event_out(event)
