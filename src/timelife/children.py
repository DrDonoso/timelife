"""Children: the list every signed-in user sees (with avatars) and the administrators' create,
edit, delete, reorder and line colour operations.

Slugs (the ``/c/<slug>`` URLs) are unique and permanent: ``slugify(name)``, made unique with
``-2``, ``-3``..., is chosen when the child is added and never changes afterwards (not even when
the child is renamed), so links to a timeline keep working. An avatar must be a pending
``avatar`` upload or the child's current avatar; replacing or removing it, or deleting the child,
deletes the previous image (its files once the transaction commits). A child's own line colour on
the family timeline is optional (null: the theme's automatic colour)."""

import uuid
from collections.abc import Collection

from fastapi import APIRouter, Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from . import media
from .auth import DB, AdminUser, CurrentUser, settings
from .categories import apply_order, next_position
from .contracts import ChildColorIn, ChildIn, ChildOut, IdPath, OrderIn
from .db import Child, EventChild, Image, utcnow
from .errors import AppError
from .text import SLUG_MAX_LENGTH, slugify

router = APIRouter(prefix="/api", tags=["Children"])
admin_router = APIRouter(prefix="/api/admin", tags=["Children"])


def child_out(child: Child, avatar: Image | None) -> ChildOut:
    return ChildOut(
        id=child.id,
        name=child.name,
        slug=child.slug,
        birth_date=child.birth_date,
        avatar=None if avatar is None else media.image_out(avatar),
        color=child.color,
        sort_order=child.sort_order,
    )


async def ordered_children(db: AsyncSession) -> list[Child]:
    return list(
        await db.scalars(
            select(Child).options(selectinload(Child.avatar)).order_by(Child.sort_order, Child.id)
        )
    )


async def get_child(db: AsyncSession, child_id: int) -> Child:
    """The child to change, row-locked until the transaction ends so that concurrent edits of
    it serialise (each sees the avatar the previous one left)."""
    child = await db.get(Child, child_id, with_for_update=True)
    if child is None:
        raise AppError("child_not_found", 404)
    return child


async def taken_slugs(db: AsyncSession) -> set[str]:
    """Slugs of every child."""
    return set(await db.scalars(select(Child.slug)))


def unique_slug(base: str, taken: Collection[str]) -> str:
    """``base``, else the first free ``base-2``, ``base-3``... (``base`` shortened to fit)."""
    slug, number = base, 1
    while slug in taken:
        number += 1
        suffix = f"-{number}"
        slug = base[: SLUG_MAX_LENGTH - len(suffix)].rstrip("-") + suffix
    return slug


async def new_slug(db: AsyncSession, name: str) -> str:
    """Slug for a new child named ``name``: ``slugify(name)`` made unique among every child."""
    return unique_slug(slugify(name), await taken_slugs(db))


async def slug_race(db: AsyncSession, slug: str) -> None:
    """After a failed insert: roll back, then 409 ``slug_taken`` if another child took ``slug``
    meanwhile (the unique constraint caught what ``new_slug`` could not see yet)."""
    await db.rollback()
    if slug in await taken_slugs(db):
        raise AppError("slug_taken", 409)


async def attach_avatar(
    db: AsyncSession, image_id: uuid.UUID | None, current: uuid.UUID | None = None
) -> Image | None:
    """Image for ``image_id``: a pending avatar upload (attached now) or the ``current`` avatar;
    422 ``invalid_image`` for anything else."""
    if image_id is None:
        return None
    [image] = await media.attach_pending(
        db, [image_id], purpose="avatar", keep=() if current is None else (current,)
    )
    return image


async def events_linked(db: AsyncSession, child_id: int) -> int:
    """How many events (trashed ones included) are linked to the child."""
    count = await db.scalar(
        select(func.count()).select_from(EventChild).where(EventChild.child_id == child_id)
    )
    return count or 0


async def ensure_unlinked(db: AsyncSession, child_id: int) -> None:
    events = await events_linked(db, child_id)
    if events:
        raise AppError("child_in_use", 409, detail={"events": events})


async def current_avatar(db: AsyncSession, child: Child) -> Image | None:
    return None if child.avatar_image_id is None else await db.get(Image, child.avatar_image_id)


@router.get("/children", response_model=list[ChildOut])
async def list_children(user: CurrentUser, db: DB) -> list[ChildOut]:
    return [child_out(child, child.avatar) for child in await ordered_children(db)]


@admin_router.post("/children", response_model=ChildOut, status_code=201)
async def create_child(body: ChildIn, admin: AdminUser, db: DB) -> ChildOut:
    slug = await new_slug(db, body.name)
    avatar = await attach_avatar(db, body.avatar_image_id)
    now = utcnow()
    child = Child(
        name=body.name,
        slug=slug,
        birth_date=body.birth_date,
        avatar_image_id=body.avatar_image_id,
        sort_order=await next_position(db, Child.sort_order),
        created_at=now,
        updated_at=now,
    )
    db.add(child)
    try:
        await db.commit()
    except IntegrityError:
        await slug_race(db, slug)
        raise
    return child_out(child, avatar)


# Declared before "/children/{child_id}" so "order" is never parsed as an id.
@admin_router.put("/children/order", response_model=list[ChildOut])
async def reorder_children(body: OrderIn, admin: AdminUser, db: DB) -> list[ChildOut]:
    children = apply_order(await ordered_children(db), body.ids)
    await db.commit()
    return [child_out(child, child.avatar) for child in children]


# The slug is not part of the body: it never changes.
@admin_router.put("/children/{child_id}", response_model=ChildOut)
async def update_child(
    child_id: IdPath, body: ChildIn, request: Request, admin: AdminUser, db: DB
) -> ChildOut:
    child = await get_child(db, child_id)
    previous = child.avatar_image_id
    avatar = await attach_avatar(db, body.avatar_image_id, previous)
    replaced = None
    if previous is not None and previous != body.avatar_image_id:
        replaced = await db.get(Image, previous)
    child.name = body.name
    child.birth_date = body.birth_date
    child.avatar_image_id = body.avatar_image_id
    child.updated_at = utcnow()
    # Save the child first so it no longer references the image deleted next.
    await db.flush()
    if replaced is not None:
        await media.delete_images(db, [replaced], settings(request).media_dir)
    await db.commit()
    return child_out(child, avatar)


@admin_router.put("/children/{child_id}/color", response_model=ChildOut)
async def set_child_color(
    child_id: IdPath, body: ChildColorIn, admin: AdminUser, db: DB
) -> ChildOut:
    child = await get_child(db, child_id)
    child.color = body.color
    child.updated_at = utcnow()
    await db.commit()
    return child_out(child, await current_avatar(db, child))


# Back to the automatic colour; resetting a child without its own colour is a no-op.
@admin_router.delete("/children/{child_id}/color", response_model=ChildOut)
async def reset_child_color(child_id: IdPath, admin: AdminUser, db: DB) -> ChildOut:
    child = await get_child(db, child_id)
    if child.color is not None:
        child.color = None
        child.updated_at = utcnow()
    await db.commit()
    return child_out(child, await current_avatar(db, child))


@admin_router.delete("/children/{child_id}", status_code=204)
async def delete_child(child_id: IdPath, request: Request, admin: AdminUser, db: DB) -> None:
    child = await get_child(db, child_id)
    await ensure_unlinked(db, child_id)
    avatar = await current_avatar(db, child)
    await db.delete(child)
    try:
        await db.flush()
        if avatar is not None:
            await media.delete_images(db, [avatar], settings(request).media_dir)
        await db.commit()
    except IntegrityError:
        # An event was linked to the child meanwhile: event_children restricts the delete.
        await db.rollback()
        await ensure_unlinked(db, child_id)
        raise