"""Helpers for the events, trash, timeline and demo tests: children, categories, events and
images created through the API, plus direct database access for what the API cannot do (fixed
timestamps, bulk data)."""

import datetime as dt
import uuid
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from timelife.db import Event, EventCategory, EventChild, Image

from .conftest import run_db
from .helpers_children import add_image, media_dir


def add_child(client: TestClient, name: str = "Lucía") -> int:
    response = client.post("/api/admin/children", json={"name": name})
    assert response.status_code == 201, response.text
    child_id: int = response.json()["id"]
    return child_id


def category_ids(client: TestClient) -> dict[str, int]:
    """Seeded category ids by key."""
    response = client.get("/api/categories")
    assert response.status_code == 200, response.text
    return {item["key"]: item["id"] for item in response.json() if item["key"]}


def event_body(
    child_ids: Sequence[int], category_ids: Sequence[int], /, **changes: Any
) -> dict[str, Any]:
    return {
        "title": "Primeros pasos",
        "date": "2025-03-22",
        "child_ids": list(child_ids),
        "category_ids": list(category_ids),
        **changes,
    }


def create_event(
    client: TestClient, child_ids: Sequence[int], category_ids: Sequence[int], /, **changes: Any
) -> dict[str, Any]:
    response = client.post("/api/admin/events", json=event_body(child_ids, category_ids, **changes))
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def update_body(event: dict[str, Any], **changes: Any) -> dict[str, Any]:
    """PUT body keeping everything of ``event`` (an ``EventOut``) except ``changes``."""
    return {
        "title": event["title"],
        "date": event["date"],
        "notes": event["notes"],
        "location": event["location"],
        "child_ids": event["child_ids"],
        "category_ids": event["category_ids"],
        "images": [{"id": image["id"], "name": image["name"]} for image in event["images"]],
        "cover_image_id": event["cover_image_id"],
        "version": event["version"],
        **changes,
    }


def update_event(client: TestClient, event: dict[str, Any], **changes: Any) -> httpx.Response:
    return client.put(f"/api/admin/events/{event['id']}", json=update_body(event, **changes))


def admin_event(client: TestClient, event_id: int) -> dict[str, Any]:
    response = client.get(f"/api/admin/events/{event_id}")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def listed(client: TestClient, **params: Any) -> dict[str, Any]:
    response = client.get("/api/admin/events", params=params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def listed_titles(client: TestClient, **params: Any) -> list[str]:
    return [item["title"] for item in listed(client, page_size=100, **params)["items"]]


def trash(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/admin/trash")
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()
    return items


def timeline(client: TestClient, child_id: int, **params: Any) -> dict[str, Any]:
    response = client.get(f"/api/children/{child_id}/timeline", params=params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def timeline_titles(client: TestClient, child_id: int, **params: Any) -> list[str]:
    return [item["title"] for item in timeline(client, child_id, **params)["events"]]


def pending_images(client: TestClient, count: int, prefix: str = "foto") -> list[str]:
    """``count`` pending event uploads (rows plus dummy folders); their ids as strings."""
    return [
        str(add_image(client, purpose="event", name=f"{prefix} {number}"))
        for number in range(1, count + 1)
    ]


def image_items(ids: Sequence[str], prefix: str = "Imagen") -> list[dict[str, str]]:
    """``EventImageIn`` list naming each image "<prefix> <n>"."""
    return [{"id": image_id, "name": f"{prefix} {number}"} for number, image_id in enumerate(ids, 1)]


def folder(client: TestClient, image_id: str | uuid.UUID) -> Path:
    return media_dir(client) / str(image_id)


def stored_event(client: TestClient, event_id: int) -> Event | None:
    async def load(db: AsyncSession) -> Event | None:
        return await db.scalar(select(Event).where(Event.id == event_id))

    return run_db(client, load)


def stored_images(client: TestClient, ids: Sequence[str | uuid.UUID]) -> dict[str, Image]:
    """The image rows that still exist among ``ids``, by id string."""

    async def load(db: AsyncSession) -> dict[str, Image]:
        rows = await db.scalars(select(Image).where(Image.id.in_([uuid.UUID(str(i)) for i in ids])))
        return {str(row.id): row for row in rows}

    return run_db(client, load)


def link_counts(client: TestClient, event_id: int) -> tuple[int, int, int]:
    """How many child links, category links and images reference ``event_id``."""

    async def count(db: AsyncSession) -> tuple[int, int, int]:
        return (
            await db.scalar(
                select(func.count()).select_from(EventChild).where(EventChild.event_id == event_id)
            )
            or 0,
            await db.scalar(
                select(func.count())
                .select_from(EventCategory)
                .where(EventCategory.event_id == event_id)
            )
            or 0,
            await db.scalar(
                select(func.count()).select_from(Image).where(Image.event_id == event_id)
            )
            or 0,
        )

    return run_db(client, count)


def set_event_times(client: TestClient, event_id: int, **values: dt.datetime | None) -> None:
    """Overwrite timestamps (``created_at``, ``updated_at``, ``deleted_at``) of an event."""

    async def change(db: AsyncSession) -> None:
        await db.execute(update(Event).where(Event.id == event_id).values(**values))
        await db.commit()

    run_db(client, change)


def set_day_order(client: TestClient, event_id: int, day_order: int) -> None:
    """Overwrite an event's ``day_order`` (e.g. 0, as events saved before it existed)."""

    async def change(db: AsyncSession) -> None:
        await db.execute(update(Event).where(Event.id == event_id).values(day_order=day_order))
        await db.commit()

    run_db(client, change)


def reorder_day(client: TestClient, date: str, ids: Sequence[int]) -> httpx.Response:
    return client.put("/api/admin/events/day-order", json={"date": date, "ids": list(ids)})


def utc(*parts: int) -> dt.datetime:
    year, month, day, *rest = parts
    return dt.datetime(year, month, day, *rest, tzinfo=dt.UTC)
