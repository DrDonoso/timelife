"""Trash: soft delete, the trash list, restoring and purging events (rows and image folders)."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from timelife.db import User, aware, utcnow

from .conftest import login_as, run_db
from .helpers_events import (
    add_child,
    admin_event,
    category_ids,
    create_event,
    folder,
    image_items,
    link_counts,
    listed_titles,
    pending_images,
    set_event_times,
    stored_event,
    stored_images,
    timeline_titles,
    trash,
    utc,
)


@pytest.fixture
def family(admin: TestClient) -> dict[str, int]:
    return {"lucia": add_child(admin, "Lucía"), "mateo": add_child(admin, "Mateo")} | category_ids(
        admin
    )


def test_deleting_moves_an_event_to_the_trash(client: TestClient) -> None:
    admin_id = login_as(client, "admin", email="ana@example.com", name="Ana")
    lucia = add_child(client, "Lucía")
    general = category_ids(client)["general"]
    images = pending_images(client, 2)
    event = create_event(client, [lucia], [general], title="Primer diente",
                         images=image_items(images))
    started = utcnow()

    response = client.delete(f"/api/admin/events/{event['id']}")
    assert response.status_code == 204
    assert response.content == b""

    row = stored_event(client, event["id"])
    assert row is not None and row.deleted_at is not None
    assert aware(row.deleted_at) >= started
    assert row.deleted_by_id == admin_id
    trashed = admin_event(client, event["id"])
    # Only deleted_at changes: same version and contents.
    assert trashed == {**event, "deleted_at": trashed["deleted_at"]}
    assert listed_titles(client) == []
    assert timeline_titles(client, lucia) == []
    assert [item["id"] for item in trash(client)] == [event["id"]]
    # The images stay until the event is purged.
    assert all(folder(client, image).is_dir() for image in images)
    assert set(stored_images(client, images)) == set(images)

    again = client.delete(f"/api/admin/events/{event['id']}")
    assert (again.status_code, again.json()) == (404, {"code": "event_not_found"})

    login_as(client, "viewer")
    response = client.get(f"/api/events/{event['id']}")
    assert (response.status_code, response.json()) == (404, {"code": "event_not_found"})
    for image in images:
        assert client.get(f"/api/media/{image}/thumb").status_code == 404


def test_the_trash_lists_deleted_events_most_recent_first(
    client: TestClient,
) -> None:
    ana = login_as(client, "admin", email="ana@example.com", name="Ana")
    lucia, mateo = add_child(client, "Lucía"), add_child(client, "Mateo")
    categories = category_ids(client)
    images = pending_images(client, 3)
    first = create_event(client, [mateo, lucia], [categories["sleep"], categories["general"]],
                         title="Duerme toda la noche", date="2024-07-10",
                         images=image_items(images), cover_image_id=images[2])
    second = create_event(client, [lucia], [categories["teething"]], title="Primer diente",
                          date="2024-10-02")
    third = create_event(client, [mateo], [categories["language"]], title="Balbucea",
                         date="2026-03-14")
    live = create_event(client, [lucia], [categories["general"]], title="Sigue aquí")
    assert client.delete(f"/api/admin/events/{first['id']}").status_code == 204

    login_as(client, "admin", email="sin-nombre@example.com")
    assert client.delete(f"/api/admin/events/{second['id']}").status_code == 204
    gone = login_as(client, "admin", email="se-fue@example.com", name="Se fue")
    assert client.delete(f"/api/admin/events/{third['id']}").status_code == 204

    async def remove_user(db: AsyncSession) -> None:
        await db.execute(delete(User).where(User.id == gone))
        await db.commit()

    login_as(client, "admin", email="ana@example.com")
    run_db(client, remove_user)
    set_event_times(client, first["id"], deleted_at=utc(2026, 10, 1, 9))
    set_event_times(client, second["id"], deleted_at=utc(2026, 10, 3, 9))
    set_event_times(client, third["id"], deleted_at=utc(2026, 10, 2, 9))

    items = trash(client)
    assert [item["id"] for item in items] == [second["id"], third["id"], first["id"]]
    assert items[2] == {
        "id": first["id"],
        "title": "Duerme toda la noche",
        "date": "2024-07-10",
        "child_ids": sorted([lucia, mateo]),
        "category_ids": [categories["sleep"], categories["general"]],
        "cover": first["images"][2],
        "image_count": 3,
        "video_count": 0,
        "deleted_at": items[2]["deleted_at"],
        "deleted_by": "Ana",
    }
    assert items[2]["deleted_at"].startswith("2026-10-01T09:00:00")
    assert (items[0]["deleted_by"], items[0]["cover"], items[0]["image_count"]) == (
        "sin-nombre@example.com",
        None,
        0,
    )
    # The account that deleted it no longer exists.
    assert items[1]["deleted_by"] is None
    assert live["id"] not in [item["id"] for item in items]
    assert ana != gone


def test_an_empty_trash(admin: TestClient, family: dict[str, int]) -> None:
    create_event(admin, [family["lucia"]], [family["general"]])
    assert trash(admin) == []


def test_restoring_brings_an_event_back(admin: TestClient, family: dict[str, int]) -> None:
    images = pending_images(admin, 2)
    event = create_event(admin, [family["lucia"], family["mateo"]], [family["general"]],
                         title="Primeros pasos", images=image_items(images))
    admin.delete(f"/api/admin/events/{event['id']}")

    response = admin.post(f"/api/admin/trash/{event['id']}/restore")
    assert response.status_code == 200
    assert response.json() == event
    row = stored_event(admin, event["id"])
    assert row is not None and (row.deleted_at, row.deleted_by_id) == (None, None)
    assert trash(admin) == []
    assert listed_titles(admin) == ["Primeros pasos"]
    assert timeline_titles(admin, family["mateo"]) == ["Primeros pasos"]

    login_as(admin, "viewer")
    assert admin.get(f"/api/events/{event['id']}").json() == event
    for image in images:
        assert admin.get(f"/api/media/{image}/display").status_code == 200


def test_a_restored_event_can_be_edited_with_its_version(
    admin: TestClient, family: dict[str, int]
) -> None:
    event = create_event(admin, [family["lucia"]], [family["general"]])
    admin.delete(f"/api/admin/events/{event['id']}")
    restored = admin.post(f"/api/admin/trash/{event['id']}/restore").json()
    assert restored["version"] == event["version"]
    response = admin.put(
        f"/api/admin/events/{event['id']}",
        json={
            "title": "Editado",
            "date": restored["date"],
            "child_ids": restored["child_ids"],
            "category_ids": restored["category_ids"],
            "version": restored["version"],
        },
    )
    assert (response.status_code, response.json()["title"]) == (200, "Editado")


@pytest.mark.parametrize(
    ("method", "path"), [("post", "/api/admin/trash/{id}/restore"), ("delete", "/api/admin/trash/{id}")]
)
def test_only_trashed_events_can_be_restored_or_purged(
    admin: TestClient, family: dict[str, int], method: str, path: str
) -> None:
    event = create_event(admin, [family["lucia"]], [family["general"]])
    response = admin.request(method, path.format(id=event["id"]))
    assert (response.status_code, response.json()) == (409, {"code": "event_not_deleted"})
    assert admin_event(admin, event["id"]) == event
    missing = admin.request(method, path.format(id=999_999))
    assert (missing.status_code, missing.json()) == (404, {"code": "event_not_found"})


def test_purging_deletes_the_event_and_its_images(
    admin: TestClient, family: dict[str, int]
) -> None:
    images = pending_images(admin, 2)
    [kept] = pending_images(admin, 1, prefix="otra")
    event = create_event(admin, [family["lucia"], family["mateo"]],
                         [family["sleep"], family["general"]], images=image_items(images))
    other = create_event(admin, [family["lucia"]], [family["general"]], images=image_items([kept]))
    admin.delete(f"/api/admin/events/{event['id']}")
    assert link_counts(admin, event["id"]) == (2, 2, 2)

    response = admin.delete(f"/api/admin/trash/{event['id']}")
    assert response.status_code == 204
    assert response.content == b""
    assert stored_event(admin, event["id"]) is None
    assert link_counts(admin, event["id"]) == (0, 0, 0)
    assert stored_images(admin, images) == {}
    assert not any(folder(admin, image).exists() for image in images)
    assert trash(admin) == []
    for method, path in (
        ("get", f"/api/admin/events/{event['id']}"),
        ("post", f"/api/admin/trash/{event['id']}/restore"),
        ("delete", f"/api/admin/trash/{event['id']}"),
    ):
        gone = admin.request(method, path)
        assert (gone.status_code, gone.json()) == (404, {"code": "event_not_found"})

    # Other events keep their images; the child and category freed can now be deleted.
    assert admin_event(admin, other["id"]) == other
    assert folder(admin, kept).is_dir()
    assert admin.delete(f"/api/admin/children/{family['mateo']}").status_code == 204
    assert admin.delete(f"/api/admin/categories/{family['sleep']}").status_code == 204


def test_purge_keeps_the_files_if_the_commit_fails(
    admin: TestClient, family: dict[str, int], monkeypatch: pytest.MonkeyPatch
) -> None:
    images = pending_images(admin, 2)
    event = create_event(admin, [family["lucia"]], [family["general"]], images=image_items(images))
    admin.delete(f"/api/admin/events/{event['id']}")

    async def failing_commit(self: AsyncSession) -> None:
        raise RuntimeError("database unavailable")

    with monkeypatch.context() as patch:
        patch.setattr(AsyncSession, "commit", failing_commit)
        response = admin.delete(f"/api/admin/trash/{event['id']}")
    assert (response.status_code, response.json()) == (500, {"code": "internal_error"})
    assert all(folder(admin, image).is_dir() for image in images)
    assert set(stored_images(admin, images)) == set(images)
    assert [item["id"] for item in trash(admin)] == [event["id"]]


def test_trash_items_keep_the_saved_category_order(
    admin: TestClient, family: dict[str, int]
) -> None:
    order = [family["self-care"], family["feeding"], family["fine-motor"]]
    event = create_event(admin, [family["lucia"]], order)
    admin.delete(f"/api/admin/events/{event['id']}")
    item: dict[str, Any] = trash(admin)[0]
    assert item["category_ids"] == order
