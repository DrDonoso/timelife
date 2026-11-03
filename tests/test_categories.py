"""Categories: the signed-in list, administrator create/edit/delete, ordering and the in-use guard."""

import datetime as dt
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from timelife import categories
from timelife.db import Category, aware, utcnow
from timelife.seed import CATEGORIES, seed

from .conftest import run_db
from .helpers_children import add_event

TRAVEL = {
    "name_es": "Viajes",
    "name_en": "Travel",
    "name_pt": "Viagens",
    "icon": "plane",
    "color": "#0EA5E9",
}
ADMIN_REQUESTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("post", "/api/admin/categories", TRAVEL),
    ("put", "/api/admin/categories/order", {"ids": [1]}),
    ("put", "/api/admin/categories/1", TRAVEL),
    ("delete", "/api/admin/categories/1", None),
]


def listed(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/categories")
    assert response.status_code == 200
    return response.json()


def category_ids(client: TestClient) -> list[int]:
    return [category["id"] for category in listed(client)]


def category_id(client: TestClient, key: str) -> int:
    return next(category["id"] for category in listed(client) if category["key"] == key)


def stored(client: TestClient, category_id: int) -> Category | None:
    async def load(db: AsyncSession) -> Category | None:
        return await db.scalar(select(Category).where(Category.id == category_id))

    return run_db(client, load)


def test_signed_in_users_list_the_seeded_categories_in_order(viewer: TestClient) -> None:
    body = listed(viewer)
    assert [
        (
            item["key"],
            item["name_es"],
            item["name_en"],
            item["name_pt"],
            item["icon"],
            item["color"],
        )
        for item in body
    ] == [tuple(item) for item in CATEGORIES]
    assert [item["sort_order"] for item in body] == list(range(len(CATEGORIES)))
    assert all(isinstance(item["id"], int) for item in body)
    assert {frozenset(item) for item in body} == {
        frozenset({"id", "key", "name_es", "name_en", "name_pt", "icon", "color", "sort_order"})
    }


def test_the_list_breaks_sort_order_ties_by_id(admin: TestClient) -> None:
    first, second = category_ids(admin)[:2]

    async def tie(db: AsyncSession) -> None:
        for row in await db.scalars(select(Category).where(Category.id.in_([first, second]))):
            row.sort_order = 50
        await db.commit()

    run_db(admin, tie)
    assert category_ids(admin)[-2:] == [first, second]


def test_categories_require_a_session(client: TestClient) -> None:
    for method, path, body in [("get", "/api/categories", None), *ADMIN_REQUESTS]:
        response = client.request(method, path, json=body)
        assert response.status_code == 401, (method, path)
        assert response.json() == {"code": "authentication_required"}


def test_category_administration_requires_an_admin(viewer: TestClient) -> None:
    before = listed(viewer)
    for method, path, body in ADMIN_REQUESTS:
        response = viewer.request(method, path, json=body)
        assert response.status_code == 403, (method, path)
        assert response.json() == {"code": "admin_required"}
    assert listed(viewer) == before


def test_category_mutations_need_the_same_origin_headers(admin: TestClient) -> None:
    for headers in ({"x-timelife-request": "0"}, {"origin": "http://evil.example"}):
        for method, path, body in ADMIN_REQUESTS:
            response = admin.request(method, path, json=body, headers=headers)
            assert response.status_code == 403, (method, path, headers)
            assert response.json() == {"code": "invalid_origin"}
    assert len(listed(admin)) == len(CATEGORIES)


def test_admins_create_categories_at_the_end(admin: TestClient) -> None:
    before = utcnow()
    response = admin.post(
        "/api/admin/categories",
        json={
            **TRAVEL,
            "name_es": "  Viajes \n y   salidas ",
            "name_pt": " Viagens \t e passeios ",
        },
    )
    assert response.status_code == 201
    created = response.json()
    assert created == {
        "id": created["id"],
        "key": None,
        "name_es": "Viajes y salidas",
        "name_en": "Travel",
        "name_pt": "Viagens e passeios",
        "icon": "plane",
        "color": "#0ea5e9",
        "sort_order": len(CATEGORIES),
    }
    row = stored(admin, created["id"])
    assert row is not None and row.key is None and row.name_pt == "Viagens e passeios"
    assert aware(row.created_at) >= before and aware(row.updated_at) >= before

    second = admin.post("/api/admin/categories", json={**TRAVEL, "icon": "map"})
    assert second.status_code == 201
    assert second.json()["sort_order"] == len(CATEGORIES) + 1
    assert listed(admin)[-2:] == [created, second.json()]


def test_admins_edit_names_icon_and_color_but_never_the_key(admin: TestClient) -> None:
    before = listed(admin)
    sleep = next(item for item in before if item["key"] == "sleep")
    started = utcnow()
    response = admin.put(
        f"/api/admin/categories/{sleep['id']}",
        json={
            "name_es": " Dormir ",
            "name_en": "Rest",
            "name_pt": " Descanso ",
            "icon": "bed",
            "color": "#ABCDEF",
        },
    )
    assert response.status_code == 200
    updated = {
        **sleep,
        "name_es": "Dormir",
        "name_en": "Rest",
        "name_pt": "Descanso",
        "icon": "bed",
        "color": "#abcdef",
    }
    assert response.json() == updated
    assert listed(admin) == [updated if item["id"] == sleep["id"] else item for item in before]
    row = stored(admin, sleep["id"])
    assert row is not None and row.key == "sleep" and row.name_pt == "Descanso"
    assert aware(row.updated_at) >= started > aware(row.created_at)


@pytest.mark.parametrize(("method", "body"), [("put", TRAVEL), ("delete", None)])
def test_unknown_categories_are_not_found(
    admin: TestClient, method: str, body: dict[str, Any] | None
) -> None:
    response = admin.request(method, "/api/admin/categories/999999", json=body)
    assert response.status_code == 404
    assert response.json() == {"code": "category_not_found"}


@pytest.mark.parametrize(
    ("value", "error"),
    [
        ("0", "greater_than_equal"),
        ("2147483648", "less_than_equal"),
        ("abc", "int_parsing"),
    ],
)
@pytest.mark.parametrize(("method", "body"), [("put", TRAVEL), ("delete", None)])
def test_category_ids_in_paths_are_validated(
    admin: TestClient, method: str, body: dict[str, Any] | None, value: str, error: str
) -> None:
    response = admin.request(method, f"/api/admin/categories/{value}", json=body)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {"category_id": error}}


@pytest.mark.parametrize(
    ("changes", "field", "error"),
    [
        ({"name_es": "   "}, "name_es", "string_too_short"),
        ({"name_en": "x" * 61}, "name_en", "string_too_long"),
        ({"name_es": "a\x07b"}, "name_es", "value_error"),
        ({"name_en": None}, "name_en", "string_type"),
        ({"name_pt": "   "}, "name_pt", "string_too_short"),
        ({"name_pt": "x" * 61}, "name_pt", "string_too_long"),
        ({"name_pt": "a\x07b"}, "name_pt", "value_error"),
        ({"name_pt": None}, "name_pt", "string_type"),
        ({"icon": "Moon"}, "icon", "string_pattern_mismatch"),
        ({"icon": "x" * 65}, "icon", "string_pattern_mismatch"),
        ({"icon": ""}, "icon", "string_pattern_mismatch"),
        ({"color": "#12345"}, "color", "string_pattern_mismatch"),
        ({"color": "0ea5e9"}, "color", "string_pattern_mismatch"),
        ({"color": "#0ea5eg"}, "color", "string_pattern_mismatch"),
        ({"key": "travel"}, "key", "extra_forbidden"),
        ({"sort_order": 0}, "sort_order", "extra_forbidden"),
    ],
)
def test_category_input_is_validated(
    admin: TestClient, changes: dict[str, Any], field: str, error: str
) -> None:
    before = listed(admin)
    for method, path in (
        ("post", "/api/admin/categories"),
        ("put", f"/api/admin/categories/{before[0]['id']}"),
    ):
        response = admin.request(method, path, json={**TRAVEL, **changes})
        assert response.status_code == 422, method
        assert response.json() == {"code": "invalid_request", "fields": {field: error}}
    assert listed(admin) == before


def test_category_fields_are_required(admin: TestClient) -> None:
    response = admin.post("/api/admin/categories", json={"name_es": "Viajes"})
    assert response.status_code == 422
    assert response.json() == {
        "code": "invalid_request",
        "fields": {
            "name_en": "missing",
            "name_pt": "missing",
            "icon": "missing",
            "color": "missing",
        },
    }


def test_every_category_needs_a_portuguese_name(admin: TestClient) -> None:
    before = listed(admin)
    without = {key: value for key, value in TRAVEL.items() if key != "name_pt"}
    for method, path in (
        ("post", "/api/admin/categories"),
        ("put", f"/api/admin/categories/{before[0]['id']}"),
    ):
        response = admin.request(method, path, json=without)
        assert response.status_code == 422, method
        assert response.json() == {"code": "invalid_request", "fields": {"name_pt": "missing"}}
    assert listed(admin) == before


def test_admins_delete_unused_categories(admin: TestClient) -> None:
    sleep = category_id(admin, "sleep")
    response = admin.delete(f"/api/admin/categories/{sleep}")
    assert response.status_code == 204
    assert response.content == b""
    assert sleep not in category_ids(admin)
    assert len(category_ids(admin)) == len(CATEGORIES) - 1
    again = admin.delete(f"/api/admin/categories/{sleep}")
    assert again.status_code == 404
    assert again.json() == {"code": "category_not_found"}


def test_categories_used_by_events_cannot_be_deleted(admin: TestClient) -> None:
    general, sleep, feeding = (category_id(admin, key) for key in ("general", "sleep", "feeding"))
    add_event(admin, category_ids=[sleep, general])
    add_event(admin, category_ids=[general], deleted=True)
    add_event(admin, category_ids=[feeding], deleted=True)

    for used, events in ((general, 2), (sleep, 1), (feeding, 1)):
        response = admin.delete(f"/api/admin/categories/{used}")
        assert response.status_code == 409
        assert response.json() == {"code": "category_in_use", "detail": {"events": events}}
    assert len(category_ids(admin)) == len(CATEGORIES)


def test_a_category_tagged_meanwhile_is_reported_in_use(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sleep = category_id(admin, "sleep")
    add_event(admin, category_ids=[sleep])
    count = categories.events_using
    calls: list[int] = []

    async def stale_first_count(db: AsyncSession, used: int) -> int:
        # The first check misses the event, as if it was saved right after the check.
        calls.append(used)
        return 0 if len(calls) == 1 else await count(db, used)

    monkeypatch.setattr(categories, "events_using", stale_first_count)
    response = admin.delete(f"/api/admin/categories/{sleep}")
    assert response.status_code == 409
    assert response.json() == {"code": "category_in_use", "detail": {"events": 1}}
    assert calls == [sleep, sleep]
    assert sleep in category_ids(admin)


def test_admins_reorder_categories(admin: TestClient) -> None:
    wanted = category_ids(admin)[::-1]
    response = admin.put("/api/admin/categories/order", json={"ids": wanted})
    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == wanted
    assert [item["sort_order"] for item in body] == list(range(len(CATEGORIES)))
    assert listed(admin) == body

    created = admin.post("/api/admin/categories", json=TRAVEL).json()
    assert created["sort_order"] == len(CATEGORIES)
    moved = [wanted[1], created["id"], wanted[0], *wanted[2:]]
    response = admin.put("/api/admin/categories/order", json={"ids": moved})
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == moved
    assert [item["id"] for item in listed(admin)] == moved
    assert [item["sort_order"] for item in listed(admin)] == list(range(len(moved)))


def test_reordering_bumps_only_the_moved_categories(admin: TestClient) -> None:
    current = category_ids(admin)
    started = utcnow()
    swapped = [current[1], current[0], *current[2:]]
    assert admin.put("/api/admin/categories/order", json={"ids": swapped}).status_code == 200

    async def updated(db: AsyncSession) -> dict[int, dt.datetime]:
        rows = await db.scalars(select(Category))
        return {row.id: aware(row.updated_at) for row in rows}

    stamps = run_db(admin, updated)
    assert {cid for cid, stamp in stamps.items() if stamp >= started} == set(current[:2])


@pytest.mark.parametrize(
    "change",
    [
        pytest.param(lambda ids: ids[:-1], id="missing"),
        pytest.param(lambda ids: [*ids, 999999], id="unknown"),
        pytest.param(lambda ids: [*ids[:-1], ids[0]], id="duplicate-instead-of-one"),
        pytest.param(lambda ids: [*ids, ids[0]], id="duplicate-extra"),
        pytest.param(lambda ids: [], id="empty"),
    ],
)
def test_an_order_must_list_every_category_once(
    admin: TestClient, change: Callable[[list[int]], list[int]]
) -> None:
    before = listed(admin)
    response = admin.put(
        "/api/admin/categories/order", json={"ids": change([item["id"] for item in before])}
    )
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_order"}
    assert listed(admin) == before


@pytest.mark.parametrize(
    ("body", "error"),
    [
        ({"ids": [0]}, "greater_than_equal"),
        ({"ids": ["one"]}, "int_parsing"),
        ({"ids": 1}, "list_type"),
        ({}, "missing"),
    ],
)
def test_order_input_is_validated(admin: TestClient, body: dict[str, Any], error: str) -> None:
    response = admin.put("/api/admin/categories/order", json=body)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {"ids": error}}


def test_deleted_default_categories_stay_deleted(admin: TestClient) -> None:
    sleep = category_id(admin, "sleep")
    assert admin.delete(f"/api/admin/categories/{sleep}").status_code == 204
    run_db(admin, seed)
    assert "sleep" not in [item["key"] for item in listed(admin)]
    assert len(listed(admin)) == len(CATEGORIES) - 1


def test_positions_restart_once_every_category_is_gone(admin: TestClient) -> None:
    for existing in category_ids(admin):
        assert admin.delete(f"/api/admin/categories/{existing}").status_code == 204
    assert listed(admin) == []
    empty = admin.put("/api/admin/categories/order", json={"ids": []})
    assert (empty.status_code, empty.json()) == (200, [])
    created = admin.post("/api/admin/categories", json=TRAVEL)
    assert created.json()["sort_order"] == 0
    assert listed(admin) == [created.json()]
