"""Events: administrator list, create, edit and delete (images, cover, versions, validation) and
the event detail every signed-in user reads."""

import asyncio
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from timelife import events
from timelife.config import Settings
from timelife.db import aware, utcnow

from .conftest import login_as
from .helpers_children import add_event, add_image
from .helpers_events import (
    add_child,
    admin_event,
    category_ids,
    create_event,
    event_body,
    folder,
    image_items,
    listed,
    listed_titles,
    pending_images,
    reorder_day,
    set_day_order,
    set_event_times,
    stored_event,
    stored_images,
    timeline_titles,
    update_body,
    update_event,
    utc,
)
from .helpers_media import uploaded

VALID_BODY = {"title": "Hito", "date": "2025-01-01", "child_ids": [1], "category_ids": [1]}
ADMIN_REQUESTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("get", "/api/admin/events", None),
    ("post", "/api/admin/events", VALID_BODY),
    ("put", "/api/admin/events/day-order", {"date": "2025-01-01", "ids": [1]}),
    ("get", "/api/admin/events/1", None),
    ("put", "/api/admin/events/1", {**VALID_BODY, "version": 1}),
    ("delete", "/api/admin/events/1", None),
    ("get", "/api/admin/locations", None),
    ("get", "/api/admin/trash", None),
    ("post", "/api/admin/trash/1/restore", None),
    ("delete", "/api/admin/trash/1", None),
]
MUTATIONS = [request for request in ADMIN_REQUESTS if request[0] != "get"]


@pytest.fixture
def family(admin: TestClient) -> dict[str, int]:
    """Children ``lucia``/``mateo`` and the seeded category ids by key."""
    return {"lucia": add_child(admin, "Lucía"), "mateo": add_child(admin, "Mateo")} | category_ids(
        admin
    )


def with_ids(path: str, event_id: int) -> str:
    return path.replace("/1", f"/{event_id}")


# Access ---------------------------------------------------------------------------------------


def test_event_endpoints_require_a_session(client: TestClient) -> None:
    for method, path, body in [*ADMIN_REQUESTS, ("get", "/api/events/1", None)]:
        response = client.request(method, path, json=body)
        assert response.status_code == 401, (method, path)
        assert response.json() == {"code": "authentication_required"}


def test_event_administration_requires_an_admin(admin: TestClient, family: dict[str, int]) -> None:
    event = create_event(admin, [family["lucia"]], [family["general"]])
    login_as(admin, "viewer")
    for method, path, body in ADMIN_REQUESTS:
        response = admin.request(method, with_ids(path, event["id"]), json=body)
        assert response.status_code == 403, (method, path)
        assert response.json() == {"code": "admin_required"}
    # Viewers read live events.
    response = admin.get(f"/api/events/{event['id']}")
    assert response.status_code == 200
    assert response.json() == event


def test_event_mutations_need_the_same_origin_headers(
    admin: TestClient, family: dict[str, int]
) -> None:
    event = create_event(admin, [family["lucia"]], [family["general"]])
    admin.delete(f"/api/admin/events/{event['id']}")
    for headers in ({"x-timelife-request": "0"}, {"origin": "http://evil.example"}):
        for method, path, body in MUTATIONS:
            response = admin.request(method, with_ids(path, event["id"]), json=body, headers=headers)
            assert response.status_code == 403, (method, path, headers)
            assert response.json() == {"code": "invalid_origin"}
    assert admin_event(admin, event["id"])["deleted_at"] is not None


# Create and read -------------------------------------------------------------------------------


def test_admins_create_events(client: TestClient) -> None:
    admin_id = login_as(client, "admin")
    lucia, mateo = add_child(client, "Lucía"), add_child(client, "Mateo")
    categories = category_ids(client)
    started = utcnow()
    event = create_event(
        client,
        [mateo, lucia],
        [categories["language"], categories["academic"]],
        title="  Primer   día de\nguardería ",
        date="2025-03-03",
        notes="  Entró sin llorar.\r\nMuy contenta.\r\n\r\nLa profe: Marta. ",
        location="  Escuela   Infantil El Jardín ",
    )
    assert event == {
        "id": event["id"],
        "title": "Primer día de guardería",
        "date": "2025-03-03",
        "notes": "Entró sin llorar.\nMuy contenta.\n\nLa profe: Marta.",
        "location": "Escuela Infantil El Jardín",
        "child_ids": sorted([lucia, mateo]),
        "category_ids": [categories["language"], categories["academic"]],
        "images": [],
        "cover_image_id": None,
        "version": 1,
        "created_at": event["created_at"],
        "updated_at": event["created_at"],
        "deleted_at": None,
    }
    assert event["created_at"].endswith("Z") or event["created_at"].endswith("+00:00")
    row = stored_event(client, event["id"])
    assert row is not None
    assert row.title_search == "primer dia de guarderia"
    assert (row.created_by_id, row.updated_by_id, row.deleted_by_id) == (admin_id, admin_id, None)
    assert aware(row.created_at) >= started

    assert admin_event(client, event["id"]) == event
    login_as(client, "viewer")
    response = client.get(f"/api/events/{event['id']}")
    assert response.status_code == 200
    assert response.json() == event


@pytest.mark.parametrize("location", [None, "", "   "])
def test_a_blank_location_is_null(
    admin: TestClient, family: dict[str, int], location: str | None
) -> None:
    event = create_event(admin, [family["lucia"]], [family["general"]], location=location)
    assert event["location"] is None
    assert event["notes"] == ""


def test_the_search_form_of_long_titles_fits_its_column(
    admin: TestClient, family: dict[str, int]
) -> None:
    # Some characters expand when normalized (a ligature becomes 18 letters).
    title = "\ufdfa" * 120
    event = create_event(admin, [family["lucia"]], [family["general"]], title=title)
    assert event["title"] == title
    row = stored_event(admin, event["id"])
    assert row is not None and len(row.title_search) == 240


def test_optional_fields_have_defaults(admin: TestClient, family: dict[str, int]) -> None:
    response = admin.post("/api/admin/events", json=event_body([family["lucia"]], [family["sleep"]]))
    assert response.status_code == 201
    event = response.json()
    assert (event["notes"], event["location"], event["images"], event["cover_image_id"]) == (
        "",
        None,
        [],
        None,
    )


IMAGE = str(uuid.uuid4())


@pytest.mark.parametrize(
    ("changes", "field", "error"),
    [
        ({"title": ""}, "title", "string_too_short"),
        ({"title": "   "}, "title", "string_too_short"),
        ({"title": "x" * 121}, "title", "string_too_long"),
        ({"title": "a\x00b"}, "title", "value_error"),
        ({"title": None}, "title", "string_type"),
        ({"date": "2025-02-30"}, "date", "date_from_datetime_parsing"),
        ({"date": "ayer"}, "date", "date_from_datetime_parsing"),
        ({"date": None}, "date", "date_type"),
        ({"notes": "x" * 5001}, "notes", "string_too_long"),
        ({"notes": "a\x07b"}, "notes", "value_error"),
        ({"location": "x" * 201}, "location", "string_too_long"),
        ({"location": "a\x1bb"}, "location", "value_error"),
        ({"child_ids": []}, "child_ids", "too_short"),
        ({"child_ids": list(range(1, 22))}, "child_ids", "too_long"),
        ({"child_ids": [1, 1]}, "child_ids", "value_error"),
        ({"child_ids": [0]}, "child_ids", "greater_than_equal"),
        ({"child_ids": [2_147_483_648]}, "child_ids", "less_than_equal"),
        ({"child_ids": None}, "child_ids", "list_type"),
        ({"category_ids": []}, "category_ids", "too_short"),
        ({"category_ids": list(range(1, 22))}, "category_ids", "too_long"),
        ({"category_ids": [2, 2]}, "category_ids", "value_error"),
        ({"category_ids": ["x"]}, "category_ids", "int_parsing"),
        ({"images": [{"id": "foto", "name": "a"}]}, "id", "uuid_parsing"),
        ({"images": [{"id": IMAGE, "name": ""}]}, "name", "string_too_short"),
        ({"images": [{"id": IMAGE, "name": "x" * 161}]}, "name", "string_too_long"),
        ({"images": [{"id": IMAGE}]}, "name", "missing"),
        ({"images": [{"id": IMAGE, "name": "a", "position": 1}]}, "position", "extra_forbidden"),
        (
            {"images": [{"id": IMAGE, "name": "a"}, {"id": IMAGE, "name": "b"}]},
            "images",
            "value_error",
        ),
        (
            {"images": [{"id": str(uuid.uuid4()), "name": "a"} for _ in range(51)]},
            "images",
            "too_long",
        ),
        ({"cover_image_id": "portada"}, "cover_image_id", "uuid_parsing"),
        ({"deleted_at": None}, "deleted_at", "extra_forbidden"),
    ],
)
def test_event_input_is_validated(
    admin: TestClient, family: dict[str, int], changes: dict[str, Any], field: str, error: str
) -> None:
    event = create_event(admin, [family["lucia"]], [family["general"]])
    body = event_body([family["lucia"]], [family["general"]], **changes)
    for method, path, extra in (
        ("post", "/api/admin/events", {}),
        ("put", f"/api/admin/events/{event['id']}", {"version": 1}),
    ):
        response = admin.request(method, path, json={**body, **extra})
        assert response.status_code == 422, method
        assert response.json() == {"code": "invalid_request", "fields": {field: error}}
    assert listed(admin)["total"] == 1
    assert admin_event(admin, event["id"]) == event


@pytest.mark.parametrize("missing", ["title", "date", "child_ids", "category_ids"])
def test_required_fields(admin: TestClient, family: dict[str, int], missing: str) -> None:
    body = event_body([family["lucia"]], [family["general"]])
    del body[missing]
    response = admin.post("/api/admin/events", json=body)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {missing: "missing"}}


@pytest.mark.parametrize(("version", "error"), [(None, "missing"), (0, "greater_than_equal")])
def test_updates_need_a_version(
    admin: TestClient, family: dict[str, int], version: int | None, error: str
) -> None:
    event = create_event(admin, [family["lucia"]], [family["general"]])
    body = update_body(event)
    if version is None:
        del body["version"]
    else:
        body["version"] = version
    response = admin.put(f"/api/admin/events/{event['id']}", json=body)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {"version": error}}


def test_children_and_categories_must_exist(admin: TestClient, family: dict[str, int]) -> None:
    event = create_event(admin, [family["lucia"]], [family["general"]])
    [image] = pending_images(admin, 1)
    for changes, code in (
        ({"child_ids": [family["lucia"], 999_999]}, "invalid_child"),
        ({"category_ids": [family["general"], 999_999]}, "invalid_category"),
        ({"child_ids": [999_999], "category_ids": [999_998]}, "invalid_child"),
    ):
        images = {"images": image_items([image])}
        created = admin.post(
            "/api/admin/events",
            json=event_body([family["lucia"]], [family["general"]], **images, **changes),
        )
        assert (created.status_code, created.json()) == (422, {"code": code})
        updated = update_event(admin, event, **images, **changes)
        assert (updated.status_code, updated.json()) == (422, {"code": code})
    assert admin_event(admin, event["id"]) == event
    assert listed(admin)["total"] == 1
    row = stored_images(admin, [image])[image]
    assert row.event_id is None and row.expires_at is not None


@pytest.mark.parametrize("deleted", ["missing_children", "missing_categories"])
def test_a_child_or_category_deleted_meanwhile_is_reported(
    admin: TestClient, family: dict[str, int], monkeypatch: pytest.MonkeyPatch, deleted: str
) -> None:
    # The existence check misses the deletion (as if it committed right after the check); the
    # foreign keys reject the links and the error is still reported properly.
    event = create_event(admin, [family["lucia"]], [family["general"]])
    [image] = pending_images(admin, 1)
    real = getattr(events, deleted)
    calls: list[list[int]] = []

    async def stale_first(db: AsyncSession, ids: list[int]) -> list[int]:
        calls.append(list(ids))
        return [] if len(calls) % 2 == 1 else await real(db, ids)

    monkeypatch.setattr(events, deleted, stale_first)
    field, code = (
        ("child_ids", "invalid_child")
        if deleted == "missing_children"
        else ("category_ids", "invalid_category")
    )
    changes = {field: [999_999], "images": image_items([image])}
    created = admin.post(
        "/api/admin/events", json=event_body([family["lucia"]], [family["general"]], **changes)
    )
    assert (created.status_code, created.json()) == (422, {"code": code})
    updated = update_event(admin, event, **changes)
    assert (updated.status_code, updated.json()) == (422, {"code": code})
    assert calls == [[999_999]] * 4
    monkeypatch.undo()
    assert admin_event(admin, event["id"]) == event
    assert listed(admin)["total"] == 1
    row = stored_images(admin, [image])[image]
    assert row.event_id is None and row.expires_at is not None


# Images and cover ------------------------------------------------------------------------------


def test_uploaded_images_are_attached_in_list_order(
    client: TestClient, family: dict[str, int]
) -> None:
    first, second, third = (
        uploaded(client, filename=f"{name}.jpg") for name in ("uno", "dos", "tres")
    )
    event = create_event(
        client,
        [family["lucia"]],
        [family["general"]],
        images=[
            {"id": third["id"], "name": "  La tercera  "},
            {"id": first["id"], "name": "La primera"},
            {"id": second["id"], "name": "dos"},
        ],
    )
    assert event["images"] == [
        {**third, "name": "La tercera"},
        {**first, "name": "La primera"},
        {**second, "name": "dos"},
    ]
    assert event["cover_image_id"] == third["id"]
    rows = stored_images(client, [first["id"], second["id"], third["id"]])
    assert [(rows[item["id"]].position, rows[item["id"]].name) for item in event["images"]] == [
        (0, "La tercera"),
        (1, "La primera"),
        (2, "dos"),
    ]
    assert all(row.event_id == event["id"] and row.expires_at is None for row in rows.values())
    assert admin_event(client, event["id"]) == event
    # Attached to a live event: viewers can see them now.
    login_as(client, "viewer")
    for image in event["images"]:
        assert client.get(f"/api/media/{image['id']}/thumb").status_code == 200


def test_the_cover_must_be_one_of_the_images(admin: TestClient, family: dict[str, int]) -> None:
    first, second, other = pending_images(admin, 3)
    base = event_body([family["lucia"]], [family["general"]], images=image_items([first, second]))

    chosen = admin.post("/api/admin/events", json={**base, "cover_image_id": second})
    assert chosen.status_code == 201
    assert chosen.json()["cover_image_id"] == second

    for body in (
        {**base, "images": [], "cover_image_id": other},
        {**event_body([family["lucia"]], [family["general"]]), "cover_image_id": first},
    ):
        response = admin.post("/api/admin/events", json=body)
        assert (response.status_code, response.json()) == (422, {"code": "invalid_cover"})
    event = chosen.json()
    for changes in (
        {"cover_image_id": other},
        # Removing the cover image while still naming it as the cover.
        {"images": image_items([first]), "cover_image_id": second},
    ):
        response = update_event(admin, event, **changes)
        assert (response.status_code, response.json()) == (422, {"code": "invalid_cover"})
    assert admin_event(admin, event["id"]) == event
    assert stored_images(admin, [other])[other].expires_at is not None
    assert listed(admin)["total"] == 1


def test_without_images_there_is_no_cover(admin: TestClient, family: dict[str, int]) -> None:
    event = create_event(admin, [family["lucia"]], [family["general"]], cover_image_id=None)
    assert (event["images"], event["cover_image_id"]) == ([], None)


def another_events_image(client: TestClient) -> uuid.UUID:
    event_id = add_event(client, category_ids=[1])
    return add_image(client, purpose="event", pending=False, event_id=event_id)


def a_childs_avatar(client: TestClient) -> uuid.UUID:
    image = add_image(client, purpose="avatar")
    response = client.post("/api/admin/children", json={"name": "Otra", "avatar_image_id": str(image)})
    assert response.status_code == 201
    return image


@pytest.mark.parametrize(
    "make_image",
    [
        pytest.param(lambda client: uuid.uuid4(), id="unknown"),
        pytest.param(lambda client: add_image(client, purpose="avatar"), id="avatar-upload"),
        pytest.param(lambda client: add_image(client, purpose="background"), id="background"),
        pytest.param(another_events_image, id="another-events-image"),
        pytest.param(a_childs_avatar, id="childs-avatar"),
        pytest.param(
            lambda client: add_image(client, purpose="event", pending=False), id="not-pending"
        ),
    ],
)
def test_only_pending_event_uploads_or_own_images_are_accepted(
    admin: TestClient, family: dict[str, int], make_image: Callable[[TestClient], uuid.UUID]
) -> None:
    [own, fresh] = pending_images(admin, 2)
    event = create_event(admin, [family["lucia"]], [family["general"]], images=image_items([own]))
    image = str(make_image(admin))
    before = stored_images(admin, [image]).get(image)
    total = listed(admin)["total"]
    images = image_items([fresh, image])

    created = admin.post(
        "/api/admin/events", json=event_body([family["lucia"]], [family["general"]], images=images)
    )
    assert (created.status_code, created.json()) == (422, {"code": "invalid_image"})
    updated = update_event(admin, event, images=image_items([own, fresh, image]))
    assert (updated.status_code, updated.json()) == (422, {"code": "invalid_image"})

    assert admin_event(admin, event["id"]) == event
    assert listed(admin)["total"] == total
    rows = stored_images(admin, [own, fresh, image])
    assert rows[fresh].expires_at is not None and rows[fresh].event_id is None
    assert rows[own].event_id == event["id"]
    after = rows.get(image)
    assert (after is None) == (before is None)
    if before is not None and after is not None:
        assert (after.event_id, after.expires_at is None) == (
            before.event_id,
            before.expires_at is None,
        )


def test_editing_reorders_renames_adds_and_removes_images(
    admin: TestClient, family: dict[str, int]
) -> None:
    a, b, c, d = pending_images(admin, 4)
    event = create_event(
        admin,
        [family["lucia"]],
        [family["general"]],
        images=image_items([a, b, c]),
        cover_image_id=b,
    )
    assert event["cover_image_id"] == b
    response = update_event(
        admin,
        event,
        images=[{"id": c, "name": "La C"}, {"id": d, "name": "Nueva"}, {"id": a, "name": "a"}],
        cover_image_id=None,
    )
    assert response.status_code == 200, response.text
    edited = response.json()
    assert [(image["id"], image["name"]) for image in edited["images"]] == [
        (c, "La C"),
        (d, "Nueva"),
        (a, "a"),
    ]
    # The cover was removed: the first image becomes the cover.
    assert edited["cover_image_id"] == c
    assert edited["version"] == 2
    assert admin_event(admin, event["id"]) == edited

    rows = stored_images(admin, [a, b, c, d])
    assert b not in rows
    assert not folder(admin, b).exists()
    assert [rows[i].position for i in (c, d, a)] == [0, 1, 2]
    assert all(rows[i].event_id == event["id"] and rows[i].expires_at is None for i in (a, c, d))
    assert all(folder(admin, i).is_dir() for i in (a, c, d))


def test_the_cover_can_be_changed_and_kept(admin: TestClient, family: dict[str, int]) -> None:
    a, b = pending_images(admin, 2)
    event = create_event(admin, [family["lucia"]], [family["general"]], images=image_items([a, b]))
    assert event["cover_image_id"] == a
    changed = update_event(admin, event, cover_image_id=b).json()
    assert changed["cover_image_id"] == b
    # Reordering keeps an explicit cover.
    kept = update_event(admin, changed, images=image_items([b, a])).json()
    assert (kept["cover_image_id"], [image["id"] for image in kept["images"]]) == (b, [b, a])


def test_removing_every_image_clears_the_cover(admin: TestClient, family: dict[str, int]) -> None:
    a, b = pending_images(admin, 2)
    event = create_event(admin, [family["lucia"]], [family["general"]], images=image_items([a, b]))
    response = update_event(admin, event, images=[], cover_image_id=None)
    assert response.status_code == 200
    assert (response.json()["images"], response.json()["cover_image_id"]) == ([], None)
    assert stored_images(admin, [a, b]) == {}
    assert not folder(admin, a).exists() and not folder(admin, b).exists()


def test_a_failed_update_keeps_the_images(
    admin: TestClient, family: dict[str, int], monkeypatch: pytest.MonkeyPatch
) -> None:
    a, b, fresh = pending_images(admin, 3)
    event = create_event(admin, [family["lucia"]], [family["general"]], images=image_items([a, b]))

    async def failing_commit(self: AsyncSession) -> None:
        raise RuntimeError("database unavailable")

    with monkeypatch.context() as patch:
        patch.setattr(AsyncSession, "commit", failing_commit)
        failed = update_event(admin, event, images=image_items([fresh]), cover_image_id=None)
    assert (failed.status_code, failed.json()) == (500, {"code": "internal_error"})
    # A rejected update changes nothing either.
    rejected = update_event(
        admin, event, images=image_items([fresh, str(uuid.uuid4())]), cover_image_id=None
    )
    assert (rejected.status_code, rejected.json()) == (422, {"code": "invalid_image"})

    assert admin_event(admin, event["id"]) == event
    rows = stored_images(admin, [a, b, fresh])
    assert rows[a].event_id == rows[b].event_id == event["id"]
    assert rows[fresh].event_id is None and rows[fresh].expires_at is not None
    assert all(folder(admin, image).is_dir() for image in (a, b, fresh))


# Update -----------------------------------------------------------------------------------


def test_admins_update_events(admin: TestClient, family: dict[str, int]) -> None:
    author = login_as(admin, "admin")
    event = create_event(admin, [family["lucia"]], [family["general"], family["sleep"]])
    editor = login_as(admin, "admin", email="otra@example.com", name="Otra")
    started = utcnow()
    response = update_event(
        admin,
        event,
        title="Duerme toda la NOCHE",
        date="2024-07-10",
        notes="Del tirón.",
        location="Casa",
        child_ids=[family["mateo"], family["lucia"]],
        category_ids=[family["sleep"], family["feeding"]],
    )
    assert response.status_code == 200, response.text
    edited = response.json()
    assert edited == {
        **event,
        "title": "Duerme toda la NOCHE",
        "date": "2024-07-10",
        "notes": "Del tirón.",
        "location": "Casa",
        "child_ids": sorted([family["lucia"], family["mateo"]]),
        "category_ids": [family["sleep"], family["feeding"]],
        "version": 2,
        "updated_at": edited["updated_at"],
    }
    assert edited["updated_at"] > event["updated_at"]
    row = stored_event(admin, event["id"])
    assert row is not None
    assert row.title_search == "duerme toda la noche"
    assert (row.created_by_id, row.updated_by_id) == (author, editor)
    assert aware(row.updated_at) >= started
    assert admin_event(admin, event["id"]) == edited

    login_as(admin, "viewer")
    assert admin.get(f"/api/events/{event['id']}").json() == edited


def test_stale_versions_are_rejected(admin: TestClient, family: dict[str, int]) -> None:
    event = create_event(admin, [family["lucia"]], [family["general"]])
    first = update_event(admin, event, title="Primera edición")
    assert first.status_code == 200
    assert first.json()["version"] == 2
    for version in (1, 3, 99):
        stale = update_event(admin, event, title="Segunda edición", version=version)
        assert (stale.status_code, stale.json()) == (409, {"code": "event_stale"})
    assert admin_event(admin, event["id"]) == first.json()
    second = update_event(admin, first.json(), title="Segunda edición")
    assert (second.status_code, second.json()["version"]) == (200, 3)


def test_every_save_bumps_the_version(admin: TestClient, family: dict[str, int]) -> None:
    event = create_event(admin, [family["lucia"]], [family["general"]])
    for version in (2, 3):
        event = update_event(admin, event).json()
        assert event["version"] == version


def test_concurrent_changes_of_one_event_run_in_turn(
    admin: TestClient, family: dict[str, int], config: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Two edits from the same version: the second waits for the first's row lock, then sees
    # the new version. An edit and a delete at once run one after the other.
    if not config.database_url.startswith("postgresql"):
        pytest.skip("SQLite has no row locks (production runs PostgreSQL)")
    event = create_event(admin, [family["lucia"]], [family["general"]])
    real = events.change_event

    async def slow_change(*args: Any, **kwargs: Any) -> None:
        await asyncio.sleep(0.4)
        await real(*args, **kwargs)

    monkeypatch.setattr(events, "change_event", slow_change)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(update_event, admin, event, title="Primera")
        second = pool.submit(update_event, admin, event, title="Segunda")
        responses = [first.result(), second.result()]
    assert sorted(response.status_code for response in responses) == [200, 409]
    [stale] = [response for response in responses if response.status_code == 409]
    assert stale.json() == {"code": "event_stale"}
    [saved] = [response.json() for response in responses if response.status_code == 200]
    assert admin_event(admin, event["id"]) == saved

    with ThreadPoolExecutor(max_workers=2) as pool:
        edit = pool.submit(update_event, admin, saved, title="Tercera")
        deletion = pool.submit(admin.delete, f"/api/admin/events/{event['id']}")
        assert (edit.result().status_code, deletion.result().status_code) in {(200, 204), (404, 204)}
    assert admin_event(admin, event["id"])["deleted_at"] is not None


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/api/admin/events/{id}", None),
        ("put", "/api/admin/events/{id}", "update"),
        ("delete", "/api/admin/events/{id}", None),
        ("post", "/api/admin/trash/{id}/restore", None),
        ("delete", "/api/admin/trash/{id}", None),
        ("get", "/api/events/{id}", None),
    ],
)
def test_unknown_events_are_not_found(
    admin: TestClient, family: dict[str, int], method: str, path: str, body: str | None
) -> None:
    payload = {**event_body([family["lucia"]], [family["general"]]), "version": 1}
    response = admin.request(
        method, path.format(id=999_999), json=payload if body == "update" else None
    )
    assert (response.status_code, response.json()) == (404, {"code": "event_not_found"})


@pytest.mark.parametrize(
    ("value", "error"),
    [("0", "greater_than_equal"), ("2147483648", "less_than_equal"), ("hito", "int_parsing")],
)
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/admin/events/{id}"),
        ("put", "/api/admin/events/{id}"),
        ("delete", "/api/admin/events/{id}"),
        ("post", "/api/admin/trash/{id}/restore"),
        ("delete", "/api/admin/trash/{id}"),
        ("get", "/api/events/{id}"),
    ],
)
def test_event_ids_in_paths_are_validated(
    admin: TestClient, family: dict[str, int], method: str, path: str, value: str, error: str
) -> None:
    body = {**event_body([family["lucia"]], [family["general"]]), "version": 1}
    response = admin.request(method, path.format(id=value), json=body if method == "put" else None)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {"event_id": error}}


def test_trashed_events_are_hidden_from_viewers_and_cannot_be_edited(
    admin: TestClient, family: dict[str, int]
) -> None:
    event = create_event(admin, [family["lucia"]], [family["general"]])
    assert admin.delete(f"/api/admin/events/{event['id']}").status_code == 204
    trashed = admin_event(admin, event["id"])
    assert trashed["deleted_at"] is not None
    assert trashed == {**event, "deleted_at": trashed["deleted_at"]}
    response = update_event(admin, event, title="Otro")
    assert (response.status_code, response.json()) == (404, {"code": "event_not_found"})
    for role in ("admin", "viewer"):
        login_as(admin, role)
        response = admin.get(f"/api/events/{event['id']}")
        assert (response.status_code, response.json()) == (404, {"code": "event_not_found"})


# List -----------------------------------------------------------------------------------------


def test_the_list_is_newest_first_and_paginated(admin: TestClient, family: dict[str, int]) -> None:
    child, category = [family["lucia"]], [family["general"]]
    ids = {
        title: create_event(admin, child, category, title=title, date=date)["id"]
        for title, date in (
            ("Enero", "2025-01-01"),
            ("Marzo A", "2025-03-01"),
            ("Marzo B", "2025-03-01"),
            ("Diciembre", "2024-12-31"),
            ("Año nuevo", "2026-01-01"),
            ("Borrado", "2027-01-01"),
        )
    }
    admin.delete(f"/api/admin/events/{ids['Borrado']}")
    newest = ["Año nuevo", "Marzo B", "Marzo A", "Enero", "Diciembre"]
    assert listed_titles(admin) == newest
    page = listed(admin)
    assert (page["total"], page["page"], page["page_size"]) == (5, 1, 50)
    for number, titles in ((1, newest[:2]), (2, newest[2:4]), (3, newest[4:]), (4, [])):
        page = listed(admin, page=number, page_size=2)
        assert [item["title"] for item in page["items"]] == titles
        assert (page["total"], page["page"], page["page_size"]) == (5, number, 2)

    # Same date: each new event goes first of its day; with the same day order (events saved
    # before it existed), the most recently created first, then the highest id.
    set_day_order(admin, ids["Marzo A"], 0)
    set_day_order(admin, ids["Marzo B"], 0)
    set_event_times(admin, ids["Marzo A"], created_at=utc(2025, 3, 2, 12))
    set_event_times(admin, ids["Marzo B"], created_at=utc(2025, 3, 2, 10))
    assert listed_titles(admin)[1:3] == ["Marzo A", "Marzo B"]
    set_event_times(admin, ids["Marzo B"], created_at=utc(2025, 3, 2, 12))
    assert listed_titles(admin)[1:3] == ["Marzo B", "Marzo A"]


def test_list_items_are_summaries(admin: TestClient, family: dict[str, int]) -> None:
    a, b, c = pending_images(admin, 3)
    with_images = create_event(
        admin,
        [family["mateo"], family["lucia"]],
        [family["feeding"], family["general"]],
        title="Primera papilla",
        date="2024-09-05",
        location="Casa",
        images=image_items([a, b, c]),
        cover_image_id=b,
    )
    plain = create_event(admin, [family["lucia"]], [family["sleep"]], date="2024-01-01")
    items = listed(admin)["items"]
    assert items == [
        {
            "id": with_images["id"],
            "title": "Primera papilla",
            "date": "2024-09-05",
            "location": "Casa",
            "child_ids": sorted([family["lucia"], family["mateo"]]),
            "category_ids": [family["feeding"], family["general"]],
            "cover": with_images["images"][1],
            "image_count": 3,
            "video_count": 0,
            "updated_at": with_images["updated_at"],
        },
        {
            "id": plain["id"],
            "title": plain["title"],
            "date": "2024-01-01",
            "location": None,
            "child_ids": [family["lucia"]],
            "category_ids": [family["sleep"]],
            "cover": None,
            "image_count": 0,
            "video_count": 0,
            "updated_at": plain["updated_at"],
        },
    ]


def test_the_list_filters_by_text_child_and_category(
    admin: TestClient, family: dict[str, int]
) -> None:
    lucia, mateo = family["lucia"], family["mateo"]
    create_event(admin, [lucia], [family["academic"]], title="Primer día de guardería",
                 date="2025-03-03")
    create_event(admin, [lucia, mateo], [family["gross-motor"], family["general"]],
                 title="Primeros pasos", date="2025-03-22")
    create_event(admin, [mateo], [family["general"]], title="Día de playa", date="2025-07-12")
    trashed = create_event(admin, [lucia], [family["teething"]], title="Primer diente",
                           date="2025-08-01")
    admin.delete(f"/api/admin/events/{trashed['id']}")

    cases: list[tuple[dict[str, Any], list[str]]] = [
        ({}, ["Día de playa", "Primeros pasos", "Primer día de guardería"]),
        ({"q": "dia"}, ["Día de playa", "Primer día de guardería"]),
        ({"q": "DÍA"}, ["Día de playa", "Primer día de guardería"]),
        ({"q": "primer"}, ["Primeros pasos", "Primer día de guardería"]),
        ({"q": "  guarderia   PRIMER "}, ["Primer día de guardería"]),
        ({"q": "pasos primeros"}, ["Primeros pasos"]),
        ({"q": "diente"}, []),
        ({"q": "   "}, ["Día de playa", "Primeros pasos", "Primer día de guardería"]),
        ({"child_id": mateo}, ["Día de playa", "Primeros pasos"]),
        ({"child_id": 999_999}, []),
        ({"category_id": family["general"]}, ["Día de playa", "Primeros pasos"]),
        ({"category_id": family["teething"]}, []),
        ({"child_id": lucia, "category_id": family["general"]}, ["Primeros pasos"]),
        ({"child_id": lucia, "q": "día"}, ["Primer día de guardería"]),
    ]
    for params, titles in cases:
        page = listed(admin, **params)
        assert [item["title"] for item in page["items"]] == titles, params
        assert page["total"] == len(titles), params


def test_search_wildcards_match_literally(admin: TestClient, family: dict[str, int]) -> None:
    for title in ("Feliz al 100%", "Hora_de_dormir", "Medio año 1/2", "Otro hito"):
        create_event(admin, [family["lucia"]], [family["general"]], title=title)
    assert listed_titles(admin, q="%") == ["Feliz al 100%"]
    assert listed_titles(admin, q="_") == ["Hora_de_dormir"]
    assert listed_titles(admin, q="1/2") == ["Medio año 1/2"]
    assert listed_titles(admin, q="/") == ["Medio año 1/2"]


def test_the_list_filters_by_an_inclusive_date_range(
    admin: TestClient, family: dict[str, int]
) -> None:
    lucia, mateo = family["lucia"], family["mateo"]
    for date in ("2025-01-01", "2025-01-15", "2025-01-31", "2025-02-01"):
        create_event(admin, [lucia], [family["general"]], title=date, date=date)
    create_event(admin, [mateo], [family["sleep"]], title="Mateo", date="2025-01-20")

    cases: list[tuple[dict[str, Any], list[str]]] = [
        ({"date_from": "2025-01-15", "date_to": "2025-01-31"},
         ["2025-01-31", "Mateo", "2025-01-15"]),
        ({"date_from": "2025-01-15"}, ["2025-02-01", "2025-01-31", "Mateo", "2025-01-15"]),
        ({"date_to": "2025-01-15"}, ["2025-01-15", "2025-01-01"]),
        ({"date_from": "2025-01-31", "date_to": "2025-01-31"}, ["2025-01-31"]),
        ({"date_from": "2025-01-02", "date_to": "2025-01-14"}, []),
        ({"date_from": "2025-01-10", "child_id": lucia}, ["2025-02-01", "2025-01-31", "2025-01-15"]),
        ({"date_to": "2025-01-25", "category_id": family["sleep"]}, ["Mateo"]),
        ({"date_to": "2025-01-25", "q": "2025"}, ["2025-01-15", "2025-01-01"]),
    ]
    for params, titles in cases:
        page = listed(admin, **params)
        assert [item["title"] for item in page["items"]] == titles, params
        assert page["total"] == len(titles), params


def test_a_reversed_list_date_range_is_rejected(admin: TestClient) -> None:
    response = admin.get(
        "/api/admin/events", params={"date_from": "2025-02-01", "date_to": "2025-01-31"}
    )
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {"date_to": "value_error"}}


# Location suggestions --------------------------------------------------------------------------


def locations(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/admin/locations")
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()
    return items


def with_locations(admin: TestClient, family: dict[str, int], *places: str | None) -> list[int]:
    return [
        create_event(admin, [family["lucia"]], [family["general"]], location=place)["id"]
        for place in places
    ]


def test_locations_are_suggested_most_used_first(admin: TestClient, family: dict[str, int]) -> None:
    assert locations(admin) == []
    with_locations(admin, family, "Esplugues", "Casa", "Esplugues", "Parque", "Esplugues", "Casa")
    with_locations(admin, family, None, "  ")
    assert locations(admin) == [
        {"name": "Esplugues", "count": 3},
        {"name": "Casa", "count": 2},
        {"name": "Parque", "count": 1},
    ]


def test_spellings_of_one_place_count_together(admin: TestClient, family: dict[str, int]) -> None:
    # Case and accents aside it is one place, named by its most used spelling (on a tie, the one
    # saved last).
    with_locations(admin, family, "Málaga", "malaga", "Málaga", "MÁLAGA", "avila", "Ávila")
    assert locations(admin) == [{"name": "Málaga", "count": 4}, {"name": "Ávila", "count": 2}]


def test_equally_used_places_are_alphabetical_and_trashed_events_do_not_count(
    admin: TestClient, family: dict[str, int]
) -> None:
    ids = with_locations(admin, family, "Zaragoza", "Ávila", "Burgos", "Toledo", "Toledo")
    for event_id in ids[3:]:
        assert admin.delete(f"/api/admin/events/{event_id}").status_code == 204
    assert [place["name"] for place in locations(admin)] == ["Ávila", "Burgos", "Zaragoza"]


def test_locations_are_capped(
    admin: TestClient, family: dict[str, int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(events, "MAX_LOCATIONS", 2)
    with_locations(admin, family, "A", "B", "B", "C", "C", "C")
    assert locations(admin) == [{"name": "C", "count": 3}, {"name": "B", "count": 2}]


# Same-day order --------------------------------------------------------------------------------


def day_events(admin: TestClient, family: dict[str, int], date: str, *titles: str) -> list[int]:
    """Events created one after the other on ``date`` (each new one goes first of its day)."""
    return [
        create_event(admin, [family["lucia"]], [family["general"]], title=title, date=date)["id"]
        for title in titles
    ]


def test_new_events_go_first_of_their_day(admin: TestClient, family: dict[str, int]) -> None:
    a, b, c = day_events(admin, family, "2025-05-05", "A", "B", "C")
    other = create_event(admin, [family["lucia"]], [family["general"]], title="Otro día",
                         date="2025-05-04")
    assert listed_titles(admin) == ["C", "B", "A", "Otro día"]
    orders = [stored_event(admin, event_id) for event_id in (a, b, c, other["id"])]
    assert [event.day_order if event else None for event in orders] == [0, -1, -2, 0]


def test_admins_reorder_the_events_of_a_day(admin: TestClient, family: dict[str, int]) -> None:
    a, b, c = day_events(admin, family, "2025-05-05", "A", "B", "C")
    create_event(admin, [family["lucia"]], [family["general"]], title="Otro día", date="2025-05-04")
    versions = {event_id: admin_event(admin, event_id)["version"] for event_id in (a, b, c)}

    response = reorder_day(admin, "2025-05-05", [a, c, b])
    assert response.status_code == 200, response.text
    assert [(item["id"], item["title"]) for item in response.json()] == [
        (a, "A"),
        (c, "C"),
        (b, "B"),
    ]
    assert response.json()[0] == listed(admin)["items"][0]
    assert listed_titles(admin) == ["A", "C", "B", "Otro día"]
    assert timeline_titles(admin, family["lucia"]) == ["A", "C", "B", "Otro día"]
    stored = [stored_event(admin, event_id) for event_id in (a, c, b)]
    assert [event.day_order for event in stored if event] == [0, 1, 2]
    # Ordering is not an edit: an editor open meanwhile can still save.
    assert {event_id: admin_event(admin, event_id)["version"] for event_id in (a, b, c)} == versions


def test_a_subset_is_reordered_among_its_own_places(
    admin: TestClient, family: dict[str, int]
) -> None:
    a, b, _c, d = day_events(admin, family, "2025-05-05", "A", "B", "C", "D")
    assert listed_titles(admin) == ["D", "C", "B", "A"]
    # E.g. the list filtered to D and B: they swap places, C and A stay where they are.
    response = reorder_day(admin, "2025-05-05", [b, d])
    assert response.status_code == 200, response.text
    assert [item["title"] for item in response.json()] == ["B", "C", "D", "A"]
    assert listed_titles(admin) == ["B", "C", "D", "A"]
    assert reorder_day(admin, "2025-05-05", [a]).status_code == 200
    assert listed_titles(admin) == ["B", "C", "D", "A"]


def test_moved_and_restored_events_keep_a_sensible_place(
    admin: TestClient, family: dict[str, int]
) -> None:
    a, b = day_events(admin, family, "2025-05-05", "A", "B")
    reorder_day(admin, "2025-05-05", [a, b])
    moved = create_event(admin, [family["lucia"]], [family["general"]], title="Movido",
                         date="2025-05-01")
    # Moving an event to another date puts it first of that day; other edits keep its place.
    assert update_event(admin, moved, date="2025-05-05").status_code == 200
    assert listed_titles(admin) == ["Movido", "A", "B"]
    assert update_event(admin, admin_event(admin, a), title="A2").status_code == 200
    assert listed_titles(admin) == ["Movido", "A2", "B"]
    admin.delete(f"/api/admin/events/{b}")
    admin.post(f"/api/admin/trash/{b}/restore")
    assert listed_titles(admin) == ["Movido", "A2", "B"]


@pytest.mark.parametrize("case", ["other_day", "trashed", "unknown"])
def test_only_live_events_of_the_day_can_be_ordered(
    admin: TestClient, family: dict[str, int], case: str
) -> None:
    a, b = day_events(admin, family, "2025-05-05", "A", "B")
    other = day_events(admin, family, "2025-05-06", "Otro")[0]
    trashed = day_events(admin, family, "2025-05-05", "Borrado")[0]
    admin.delete(f"/api/admin/events/{trashed}")
    extra = {"other_day": other, "trashed": trashed, "unknown": 999_999}[case]
    response = reorder_day(admin, "2025-05-05", [a, extra, b])
    assert (response.status_code, response.json()) == (422, {"code": "invalid_order"})
    assert listed_titles(admin) == ["Otro", "B", "A"]


@pytest.mark.parametrize(
    ("body", "field", "error"),
    [
        ({"date": "2025-05-05", "ids": []}, "ids", "too_short"),
        ({"date": "2025-05-05", "ids": [1, 1]}, "ids", "value_error"),
        ({"date": "2025-05-05", "ids": [0]}, "ids", "greater_than_equal"),
        ({"date": "2025-13-05", "ids": [1]}, "date", "date_from_datetime_parsing"),
        ({"ids": [1]}, "date", "missing"),
    ],
)
def test_day_orders_are_validated(
    admin: TestClient, body: dict[str, Any], field: str, error: str
) -> None:
    response = admin.put("/api/admin/events/day-order", json=body)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {field: error}}


@pytest.mark.parametrize(
    ("params", "field", "error"),
    [
        ({"page": 0}, "page", "greater_than_equal"),
        ({"page": "x"}, "page", "int_parsing"),
        ({"page_size": 0}, "page_size", "greater_than_equal"),
        ({"page_size": 101}, "page_size", "less_than_equal"),
        ({"q": "x" * 201}, "q", "string_too_long"),
        ({"child_id": 0}, "child_id", "greater_than_equal"),
        ({"category_id": "general"}, "category_id", "int_parsing"),
        ({"date_from": "2025-13-01"}, "date_from", "date_from_datetime_parsing"),
        ({"date_to": "mañana"}, "date_to", "date_from_datetime_parsing"),
    ],
)
def test_list_parameters_are_validated(
    admin: TestClient, params: dict[str, Any], field: str, error: str
) -> None:
    response = admin.get("/api/admin/events", params=params)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {field: error}}
