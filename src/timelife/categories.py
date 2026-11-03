"""Event categories: the list every signed-in user sees and the administrators' create, edit,
delete and reorder operations.

``next_position`` and ``apply_order`` are shared with ``children`` (same ordering rules)."""

import datetime as dt
from collections.abc import Sequence
from typing import Protocol, TypeVar

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from .auth import DB, AdminUser, CurrentUser
from .contracts import CategoryIn, CategoryOut, IdPath, OrderIn
from .db import Category, EventCategory, utcnow
from .errors import AppError

router = APIRouter(prefix="/api", tags=["Categories"])
admin_router = APIRouter(prefix="/api/admin", tags=["Categories"])


class Ordered(Protocol):
    @property
    def id(self) -> int: ...

    sort_order: int
    updated_at: dt.datetime


OrderedT = TypeVar("OrderedT", bound=Ordered)


async def next_position(db: AsyncSession, column: InstrumentedAttribute[int]) -> int:
    """``sort_order`` that appends a new row after every existing one."""
    highest = await db.scalar(select(func.max(column)))
    return 0 if highest is None else highest + 1


def apply_order(rows: Sequence[OrderedT], ids: Sequence[int]) -> list[OrderedT]:
    """Set ``sort_order`` to each row's index in ``ids`` and return the rows in that order.

    422 ``invalid_order`` unless ``ids`` lists every row id exactly once."""
    by_id = {row.id: row for row in rows}
    if len(ids) != len(by_id) or set(ids) != by_id.keys():
        raise AppError("invalid_order", 422)
    now = utcnow()
    ordered = [by_id[row_id] for row_id in ids]
    for position, row in enumerate(ordered):
        if row.sort_order != position:
            row.sort_order = position
            row.updated_at = now
    return ordered


async def ordered_categories(db: AsyncSession) -> list[Category]:
    return list(await db.scalars(select(Category).order_by(Category.sort_order, Category.id)))


async def get_category(db: AsyncSession, category_id: int) -> Category:
    """The category to change, row-locked until the transaction ends."""
    category = await db.get(Category, category_id, with_for_update=True)
    if category is None:
        raise AppError("category_not_found", 404)
    return category


async def events_using(db: AsyncSession, category_id: int) -> int:
    """How many events (trashed ones included) are tagged with the category."""
    count = await db.scalar(
        select(func.count())
        .select_from(EventCategory)
        .where(EventCategory.category_id == category_id)
    )
    return count or 0


async def ensure_unused(db: AsyncSession, category_id: int) -> None:
    events = await events_using(db, category_id)
    if events:
        raise AppError("category_in_use", 409, detail={"events": events})


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(user: CurrentUser, db: DB) -> list[CategoryOut]:
    return [CategoryOut.model_validate(category) for category in await ordered_categories(db)]


@admin_router.post("/categories", response_model=CategoryOut, status_code=201)
async def create_category(body: CategoryIn, admin: AdminUser, db: DB) -> CategoryOut:
    now = utcnow()
    category = Category(
        key=None,
        name_es=body.name_es,
        name_en=body.name_en,
        name_pt=body.name_pt,
        icon=body.icon,
        color=body.color,
        sort_order=await next_position(db, Category.sort_order),
        created_at=now,
        updated_at=now,
    )
    db.add(category)
    await db.commit()
    return CategoryOut.model_validate(category)


# Declared before "/categories/{category_id}" so "order" is never parsed as an id.
@admin_router.put("/categories/order", response_model=list[CategoryOut])
async def reorder_categories(body: OrderIn, admin: AdminUser, db: DB) -> list[CategoryOut]:
    categories = apply_order(await ordered_categories(db), body.ids)
    await db.commit()
    return [CategoryOut.model_validate(category) for category in categories]


@admin_router.put("/categories/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: IdPath, body: CategoryIn, admin: AdminUser, db: DB
) -> CategoryOut:
    category = await get_category(db, category_id)
    category.name_es = body.name_es
    category.name_en = body.name_en
    category.name_pt = body.name_pt
    category.icon = body.icon
    category.color = body.color
    category.updated_at = utcnow()
    await db.commit()
    return CategoryOut.model_validate(category)


@admin_router.delete("/categories/{category_id}", status_code=204)
async def delete_category(category_id: IdPath, admin: AdminUser, db: DB) -> None:
    category = await get_category(db, category_id)
    await ensure_unused(db, category_id)
    await db.delete(category)
    try:
        await db.commit()
    except IntegrityError:
        # An event was tagged with it meanwhile: event_categories restricts the delete.
        await db.rollback()
        await ensure_unused(db, category_id)
        raise