"""Appearance: per-year colour overrides, the years that have events and the timeline settings
(background image, its opacity, the default zoom level and the direction of the timeline on
desktops and on phones).

The settings are JSON values in ``app_settings`` (``background_image_id``,
``background_opacity``, ``default_zoom``, ``direction_desktop``, ``direction_mobile``) read
defensively: a missing, malformed or out-of-range value falls back to its default. The background
must be a pending ``background`` upload or the current background; replacing or removing it
deletes the previous image (its files once the transaction commits)."""

import json
import uuid
from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import APIRouter, Request
from sqlalchemy import Integer, Text, cast, delete, extract, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.ext.asyncio import AsyncSession

from . import media
from .auth import DB, AdminUser, CurrentUser, settings
from .contracts import AppearanceOut, Direction, SettingsIn, YearColorIn, YearColorOut, Zoom
from .db import AppSetting, Base, Event, Image, YearColor, utcnow
from .errors import AppError

router = APIRouter(prefix="/api", tags=["Appearance"])
admin_router = APIRouter(prefix="/api/admin", tags=["Appearance"])

MIN_YEAR = 1900
MAX_YEAR = 2200
BACKGROUND_KEY = "background_image_id"
OPACITY_KEY = "background_opacity"
ZOOM_KEY = "default_zoom"
DESKTOP_DIRECTION_KEY = "direction_desktop"
MOBILE_DIRECTION_KEY = "direction_mobile"
SETTING_KEYS = (BACKGROUND_KEY, OPACITY_KEY, ZOOM_KEY, DESKTOP_DIRECTION_KEY, MOBILE_DIRECTION_KEY)
DEFAULT_OPACITY = 0.18
DEFAULT_ZOOM: Zoom = "events"
ZOOMS: dict[str, Zoom] = {"years": "years", "months": "months", "events": "events"}
# Newest milestone on the left on desktops, at the top on phones.
DEFAULT_DESKTOP_DIRECTION: Direction = "right_to_left"
DEFAULT_MOBILE_DIRECTION: Direction = "bottom_to_top"
DIRECTIONS: dict[str, Direction] = {
    "left_to_right": "left_to_right",
    "right_to_left": "right_to_left",
    "top_to_bottom": "top_to_bottom",
    "bottom_to_top": "bottom_to_top",
}


def dialect_insert(db: AsyncSession, model: type[Base]) -> postgresql.Insert | sqlite.Insert:
    """``INSERT`` into ``model``'s table supporting ``ON CONFLICT`` on the session's database."""
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        return postgresql.insert(model)
    if dialect == "sqlite":
        return sqlite.insert(model)
    raise RuntimeError(f"Unsupported database dialect: {dialect}")


def decode(raw: str | None) -> Any:
    """A stored JSON value; None when missing or malformed."""
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (ValueError, RecursionError):
        return None


def background_id(value: Any) -> uuid.UUID | None:
    if not isinstance(value, str):
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


def opacity(value: Any) -> float:
    # bool is an int subclass; NaN and the infinities fail the range check.
    if isinstance(value, int | float) and not isinstance(value, bool) and 0 <= value <= 1:
        return float(value)
    return DEFAULT_OPACITY


def zoom(value: Any) -> Zoom:
    return ZOOMS.get(value, DEFAULT_ZOOM) if isinstance(value, str) else DEFAULT_ZOOM


def direction(value: Any, default: Direction) -> Direction:
    return DIRECTIONS.get(value, default) if isinstance(value, str) else default


def check_year(year: int) -> None:
    if not MIN_YEAR <= year <= MAX_YEAR:
        raise AppError("invalid_year", 422)


async def stored_settings(
    db: AsyncSession, keys: Sequence[str] = SETTING_KEYS, *, lock: bool = False
) -> dict[str, Any]:
    """Decoded values of the ``app_settings`` rows ``keys`` that exist, those rows locked until
    the transaction ends when ``lock``."""
    # Fetched as text and decoded here, so one malformed value cannot fail the whole request.
    query = select(AppSetting.key, cast(AppSetting.value, Text)).where(AppSetting.key.in_(keys))
    if lock:
        query = query.with_for_update()
    return {key: decode(raw) for key, raw in await db.execute(query)}


async def store_settings(db: AsyncSession, values: Mapping[str, Any]) -> None:
    """Insert or overwrite the ``app_settings`` rows ``values`` (JSON-serialisable); no commit."""
    now = utcnow()
    statement = dialect_insert(db, AppSetting).values(
        [{"key": key, "value": value, "updated_at": now} for key, value in values.items()]
    )
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[AppSetting.key],
            set_={"value": statement.excluded.value, "updated_at": statement.excluded.updated_at},
        )
    )


async def lock_background(db: AsyncSession) -> uuid.UUID | None:
    """The current background id, with its ``app_settings`` row (created if missing) locked until
    the transaction ends: concurrent settings saves then run one after another, so each one
    replaces, and deletes, the image the previous one attached instead of orphaning it."""
    # On SQLite this first write already takes the database write lock, which serialises too.
    await db.execute(
        dialect_insert(db, AppSetting)
        .values(key=BACKGROUND_KEY, value=None, updated_at=utcnow())
        .on_conflict_do_nothing(index_elements=[AppSetting.key])
    )
    values = await stored_settings(db, (BACKGROUND_KEY,), lock=True)
    return background_id(values.get(BACKGROUND_KEY))


async def background_image(db: AsyncSession, image_id: uuid.UUID | None) -> Image | None:
    """The attached background image ``image_id`` names; None when it no longer exists (or is
    no attached background image, which only a manual database edit could cause)."""
    if image_id is None:
        return None
    image = await db.get(Image, image_id)
    if image is None or image.purpose != "background" or image.expires_at is not None:
        return None
    return image


async def year_colors(db: AsyncSession) -> list[YearColorOut]:
    rows = await db.scalars(select(YearColor).order_by(YearColor.year.desc()))
    return [YearColorOut(year=row.year, color=row.color) for row in rows]


async def event_years(db: AsyncSession) -> list[int]:
    """Distinct years of the events that are not in the trash, newest first."""
    # EXTRACT on PostgreSQL (a numeric, hence the cast) and STRFTIME('%Y') on SQLite.
    year = cast(extract("year", Event.date), Integer).label("event_year")
    years = await db.scalars(
        select(year).where(Event.deleted_at.is_(None)).distinct().order_by(year.desc())
    )
    return list(years)


async def appearance_out(db: AsyncSession) -> AppearanceOut:
    values = await stored_settings(db)
    background = await background_image(db, background_id(values.get(BACKGROUND_KEY)))
    return AppearanceOut(
        year_colors=await year_colors(db),
        event_years=await event_years(db),
        background=None if background is None else media.image_out(background),
        background_opacity=opacity(values.get(OPACITY_KEY)),
        default_zoom=zoom(values.get(ZOOM_KEY)),
        direction_desktop=direction(values.get(DESKTOP_DIRECTION_KEY), DEFAULT_DESKTOP_DIRECTION),
        direction_mobile=direction(values.get(MOBILE_DIRECTION_KEY), DEFAULT_MOBILE_DIRECTION),
    )


@router.get("/appearance", response_model=AppearanceOut)
async def get_appearance(user: CurrentUser, db: DB) -> AppearanceOut:
    return await appearance_out(db)


# ``year`` is validated by the handler (1900..2200) so that out-of-range years get ``invalid_year``.
@admin_router.put("/year-colors/{year}", response_model=AppearanceOut)
async def set_year_color(year: int, body: YearColorIn, admin: AdminUser, db: DB) -> AppearanceOut:
    check_year(year)
    statement = dialect_insert(db, YearColor).values(
        year=year, color=body.color, updated_at=utcnow()
    )
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[YearColor.year],
            set_={"color": statement.excluded.color, "updated_at": statement.excluded.updated_at},
        )
    )
    await db.commit()
    return await appearance_out(db)


# Back to the automatic colour; resetting a year without an override is a no-op.
@admin_router.delete("/year-colors/{year}", response_model=AppearanceOut)
async def reset_year_color(year: int, admin: AdminUser, db: DB) -> AppearanceOut:
    check_year(year)
    await db.execute(delete(YearColor).where(YearColor.year == year))
    await db.commit()
    return await appearance_out(db)


# Replaces every setting. The background must be a pending background upload or the current
# background (send its id to keep it); a replaced or removed background image is deleted.
@admin_router.put("/settings", response_model=AppearanceOut)
async def update_settings(
    body: SettingsIn, request: Request, admin: AdminUser, db: DB
) -> AppearanceOut:
    current = await lock_background(db)
    wanted = body.background_image_id
    if wanted is not None:
        await media.attach_pending(
            db, [wanted], purpose="background", keep=() if current is None else (current,)
        )
    if current is not None and current != wanted:
        previous = await db.get(Image, current)
        # A hand-edited setting could name some other kind of image: that one is never deleted.
        if previous is not None and previous.purpose == "background":
            await media.delete_images(db, [previous], settings(request).media_dir)
    await store_settings(
        db,
        {
            BACKGROUND_KEY: None if wanted is None else str(wanted),
            OPACITY_KEY: body.background_opacity,
            ZOOM_KEY: body.default_zoom,
            DESKTOP_DIRECTION_KEY: body.direction_desktop,
            MOBILE_DIRECTION_KEY: body.direction_mobile,
        },
    )
    await db.commit()
    return await appearance_out(db)
