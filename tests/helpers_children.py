"""Direct database helpers for the children and categories tests (rows the API under test does
not create itself: uploaded images and events)."""

import datetime as dt
import uuid
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from timelife.db import Event, EventCategory, EventChild, Image, ImagePurpose, utcnow
from timelife.text import normalize_search

from .conftest import run_db
from .helpers_media import PHOTO_FIELDS


def media_dir(client: TestClient) -> Path:
    app: Any = client.app
    return app.state.settings.media_dir


def add_image(
    client: TestClient,
    *,
    purpose: ImagePurpose = "avatar",
    pending: bool = True,
    event_id: int | None = None,
    name: str = "foto",
) -> uuid.UUID:
    """Insert an image row like an upload would (pending for 24 h unless ``pending=False``) plus
    a ``media_dir/<id>/`` folder with dummy files; returns the image id."""
    image_id = uuid.uuid4()
    folder = media_dir(client) / str(image_id)
    folder.mkdir(parents=True)
    for variant in ("original.jpg", "thumb.webp", "display.webp"):
        (folder / variant).write_bytes(b"not really an image")
    now = utcnow()

    async def insert(db: AsyncSession) -> None:
        db.add(
            Image(
                id=image_id,
                purpose=purpose,
                event_id=event_id,
                name=name,
                original_filename=f"{name}.jpg",
                original_ext="jpg",
                content_type="image/jpeg",
                byte_size=19,
                width=640,
                height=480,
                dominant_color="#a0b1c2",
                created_at=now,
                expires_at=now + dt.timedelta(hours=24) if pending else None,
            )
        )
        await db.commit()

    run_db(client, insert)
    return image_id


def image_row(client: TestClient, image_id: uuid.UUID) -> Image | None:
    async def load(db: AsyncSession) -> Image | None:
        return await db.scalar(select(Image).where(Image.id == image_id))

    return run_db(client, load)


def image_folder(client: TestClient, image_id: uuid.UUID) -> Path:
    return media_dir(client) / str(image_id)


def add_event(
    client: TestClient,
    *,
    child_ids: Sequence[int] = (),
    category_ids: Sequence[int] = (),
    deleted: bool = False,
    title: str = "Primer diente",
) -> int:
    """Insert an event (soft-deleted when ``deleted``) linked to children and categories."""

    async def insert(db: AsyncSession) -> int:
        now = utcnow()
        event = Event(
            title=title,
            title_search=normalize_search(title),
            date=dt.date(2025, 3, 12),
            notes="",
            version=1,
            created_at=now,
            updated_at=now,
            deleted_at=now if deleted else None,
        )
        db.add(event)
        await db.flush()
        db.add_all(EventChild(event_id=event.id, child_id=child_id) for child_id in child_ids)
        db.add_all(
            EventCategory(event_id=event.id, category_id=category_id, position=position)
            for position, category_id in enumerate(category_ids)
        )
        await db.commit()
        return event.id

    return run_db(client, insert)


def avatar_out(image_id: uuid.UUID, name: str = "foto") -> dict[str, Any]:
    """Expected ``ImageOut`` of an image created by ``add_image``."""
    return {
        "id": str(image_id),
        "name": name,
        "width": 640,
        "height": 480,
        "dominant_color": "#a0b1c2",
        "crop": None,
        "thumb_url": f"/api/media/{image_id}/thumb",
        "display_url": f"/api/media/{image_id}/display",
        **PHOTO_FIELDS,
    }
