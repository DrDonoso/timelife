"""Schema behaviour other modules rely on, identical on SQLite (tests) and PostgreSQL."""

import datetime as dt
import uuid

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError, InvalidRequestError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from timelife.contracts import ChildOut, EventOut, ImageOut
from timelife.db import (
    AppSetting,
    Category,
    Child,
    Event,
    EventCategory,
    EventChild,
    Image,
    User,
    YearColor,
    aware,
    utcnow,
)

Sessions = async_sessionmaker[AsyncSession]


def image(**values: object) -> Image:
    defaults: dict[str, object] = {
        "purpose": "event",
        "name": "Foto",
        "original_filename": "foto.jpg",
        "original_ext": "jpg",
        "content_type": "image/jpeg",
        "byte_size": 1234,
        "width": 800,
        "height": 600,
        "dominant_color": "#aabbcc",
    }
    defaults.update(values)
    return Image(**defaults)


async def create_event(db: AsyncSession) -> tuple[User, Child, list[Category], Event]:
    user = User(email="admin@example.com", role="admin")
    child = Child(name="Lucía", slug="lucia", sort_order=0)
    seeded = list(await db.scalars(select(Category).order_by(Category.sort_order).limit(2)))
    db.add_all([user, child])
    await db.flush()
    event = Event(
        title="Primer diente",
        title_search="primer diente",
        date=dt.date(2026, 3, 12),
        created_by_id=user.id,
        updated_by_id=user.id,
        child_links=[EventChild(child_id=child.id)],
        category_links=[
            EventCategory(category_id=seeded[1].id, position=0),
            EventCategory(category_id=seeded[0].id, position=1),
        ],
    )
    db.add(event)
    await db.flush()
    db.add_all([image(event_id=event.id, position=1, name="B"), image(event_id=event.id, name="A")])
    await db.commit()
    return user, child, seeded, event


def test_time_helpers() -> None:
    now = utcnow()
    assert now.tzinfo is dt.UTC
    naive = dt.datetime(2026, 1, 2, 3, 4, 5)
    assert aware(naive) == naive.replace(tzinfo=dt.UTC)
    assert aware(now) is now
    assert aware(None) is None


async def test_relationships_load_explicitly_and_feed_contracts(sessions: Sessions) -> None:
    async with sessions() as db:
        _, child, seeded, event = await create_event(db)
        event_id = event.id

    async with sessions() as db:
        loaded = await db.scalar(
            select(Event)
            .where(Event.id == event_id)
            .options(
                selectinload(Event.child_links),
                selectinload(Event.category_links),
                selectinload(Event.images),
            )
        )
        assert loaded is not None
        assert loaded.child_ids == [child.id]
        assert loaded.category_ids == [seeded[1].id, seeded[0].id]
        assert [item.name for item in loaded.images] == ["A", "B"]
        assert aware(loaded.created_at).tzinfo is not None

        out = EventOut.model_validate(loaded)
        assert out.images[0].thumb_url == f"/api/media/{loaded.images[0].id}/thumb"
        assert out.images[0].display_url == f"/api/media/{loaded.images[0].id}/display"
        assert out.created_at.tzinfo is not None
        assert ImageOut.model_validate(loaded.images[1]).name == "B"

        unloaded = await db.scalar(select(Child).where(Child.id == child.id))
        assert unloaded is not None
        with pytest.raises(InvalidRequestError):
            _ = unloaded.avatar
        with_avatar = await db.scalar(
            select(Child).where(Child.id == child.id).options(selectinload(Child.avatar))
        )
        assert ChildOut.model_validate(with_avatar).avatar is None


async def test_children_and_categories_in_use_cannot_be_deleted(sessions: Sessions) -> None:
    async with sessions() as db:
        _, child, seeded, _ = await create_event(db)
        child_id, category_id = child.id, seeded[0].id  # rollback() expires loaded objects
        with pytest.raises(IntegrityError):
            await db.execute(delete(Child).where(Child.id == child_id))
        await db.rollback()
        with pytest.raises(IntegrityError):
            await db.execute(delete(Category).where(Category.id == category_id))
        await db.rollback()


async def test_deleting_an_event_cascades_to_links_and_images(sessions: Sessions) -> None:
    async with sessions() as db:
        user, child, _, event = await create_event(db)
        avatar = image(purpose="avatar", expires_at=None)
        db.add(avatar)
        await db.flush()
        child.avatar_image_id = avatar.id
        await db.commit()

        await db.delete(event)
        await db.commit()
        assert list(await db.scalars(select(EventChild))) == []
        assert list(await db.scalars(select(EventCategory))) == []
        assert list(await db.scalars(select(Image.id).where(Image.purpose == "event"))) == []

        await db.execute(delete(Image).where(Image.id == avatar.id))
        await db.commit()
        await db.refresh(child)
        assert child.avatar_image_id is None

        another = Event(
            title="Otro", title_search="otro", date=dt.date(2026, 1, 1), created_by_id=user.id
        )
        db.add(another)
        await db.commit()
        await db.execute(delete(User).where(User.id == user.id))
        await db.commit()
        await db.refresh(another)
        assert another.created_by_id is None


async def test_app_settings_store_json_values_including_null(sessions: Sessions) -> None:
    async with sessions() as db:
        db.add_all(
            [
                AppSetting(key="background_image_id", value=None),
                AppSetting(key="background_opacity", value=0.18),
                AppSetting(key="default_zoom", value="events"),
                YearColor(year=2026, color="#3b82f6"),
            ]
        )
        await db.commit()
    async with sessions() as db:
        rows = {row.key: row.value for row in await db.scalars(select(AppSetting))}
        year = await db.get(YearColor, 2026)
    assert rows["background_image_id"] is None
    assert rows["background_opacity"] == 0.18
    assert rows["default_zoom"] == "events"
    assert year is not None and year.color == "#3b82f6"


async def test_unique_and_check_constraints(sessions: Sessions) -> None:
    async with sessions() as db:
        db.add_all(
            [Child(name="A", slug="same", sort_order=0), Child(name="B", slug="same", sort_order=1)]
        )
        with pytest.raises(IntegrityError):
            await db.commit()
        await db.rollback()
        db.add(User(email="x@example.com", role="owner"))
        with pytest.raises(IntegrityError):
            await db.commit()
        await db.rollback()
        db.add(image(purpose="other", id=uuid.uuid4()))
        with pytest.raises(IntegrityError):
            await db.commit()
