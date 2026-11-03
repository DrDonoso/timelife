"""Children: the signed-in list, administrator create/edit/delete, permanent slugs, ordering, line
colours, avatars and the in-use guard."""

import uuid
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from timelife import children
from timelife.db import Child, aware, utcnow

from .conftest import login_as, run_db
from .helpers_children import add_event, add_image, avatar_out, image_folder, image_row

ADMIN_REQUESTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("post", "/api/admin/children", {"name": "Lucía"}),
    ("put", "/api/admin/children/order", {"ids": [1]}),
    ("put", "/api/admin/children/1", {"name": "Lucía"}),
    ("delete", "/api/admin/children/1", None),
    ("put", "/api/admin/children/1/color", {"color": "#123456"}),
    ("delete", "/api/admin/children/1/color", None),
]
# Requests on one child: method, path after "/api/admin/children/<id>" and body.
CHILD_REQUESTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("put", "", {"name": "Lucía"}),
    ("delete", "", None),
    ("put", "/color", {"color": "#123456"}),
    ("delete", "/color", None),
]


def create(client: TestClient, **body: Any) -> dict[str, Any]:
    response = client.post("/api/admin/children", json=body)
    assert response.status_code == 201, response.json()
    return response.json()


def update(client: TestClient, child_id: int, **body: Any) -> httpx.Response:
    return client.put(f"/api/admin/children/{child_id}", json=body)


def set_color(client: TestClient, child_id: int, color: Any) -> httpx.Response:
    return client.put(f"/api/admin/children/{child_id}/color", json={"color": color})


def reset_color(client: TestClient, child_id: int) -> httpx.Response:
    return client.delete(f"/api/admin/children/{child_id}/color")


def listed(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/children")
    assert response.status_code == 200
    return response.json()


def stored(client: TestClient, child_id: int) -> Child | None:
    async def load(db: AsyncSession) -> Child | None:
        return await db.scalar(select(Child).where(Child.id == child_id))

    return run_db(client, load)


def first_call_misses(
    monkeypatch: pytest.MonkeyPatch, name: str, missed: Any
) -> list[tuple[Any, ...]]:
    """Make ``children.<name>`` return ``missed`` on its first call only, as if a concurrent
    request committed right after that check; returns the recorded call arguments."""
    real = getattr(children, name)
    calls: list[tuple[Any, ...]] = []

    async def stale_first(*args: Any) -> Any:
        calls.append(args[1:])
        return missed if len(calls) == 1 else await real(*args)

    monkeypatch.setattr(children, name, stale_first)
    return calls


# Access


def test_children_require_a_session(client: TestClient) -> None:
    for method, path, body in [("get", "/api/children", None), *ADMIN_REQUESTS]:
        response = client.request(method, path, json=body)
        assert response.status_code == 401, (method, path)
        assert response.json() == {"code": "authentication_required"}


def test_child_administration_requires_an_admin(admin: TestClient) -> None:
    lucia = create(admin, name="Lucía")
    login_as(admin, "viewer")
    assert listed(admin) == [lucia]
    for method, path, body in ADMIN_REQUESTS:
        response = admin.request(method, path.replace("/1", f"/{lucia['id']}"), json=body)
        assert response.status_code == 403, (method, path)
        assert response.json() == {"code": "admin_required"}
    assert listed(admin) == [lucia]


def test_child_mutations_need_the_same_origin_headers(admin: TestClient) -> None:
    lucia = create(admin, name="Lucía")
    for headers in ({"x-timelife-request": "0"}, {"origin": "http://evil.example"}):
        for method, path, body in ADMIN_REQUESTS:
            response = admin.request(
                method, path.replace("/1", f"/{lucia['id']}"), json=body, headers=headers
            )
            assert response.status_code == 403, (method, path, headers)
            assert response.json() == {"code": "invalid_origin"}
    assert listed(admin) == [lucia]


# Create, edit and slugs


def test_admins_create_children_at_the_end(admin: TestClient) -> None:
    assert listed(admin) == []
    started = utcnow()
    lucia = create(admin, name="Lucía", birth_date="2021-05-04")
    assert lucia == {
        "id": lucia["id"],
        "name": "Lucía",
        "slug": "lucia",
        "birth_date": "2021-05-04",
        "avatar": None,
        "color": None,
        "sort_order": 0,
    }
    mateo = create(admin, name="  Mateo \n José ", birth_date=None)
    assert (mateo["name"], mateo["slug"], mateo["birth_date"], mateo["sort_order"]) == (
        "Mateo José",
        "mateo-jose",
        None,
        1,
    )
    assert listed(admin) == [lucia, mateo]
    row = stored(admin, lucia["id"])
    assert row is not None and row.avatar_image_id is None
    assert aware(row.created_at) >= started and aware(row.updated_at) >= started

    login_as(admin, "viewer")
    assert listed(admin) == [lucia, mateo]


def test_generated_slugs_are_ascii_and_unique(admin: TestClient) -> None:
    names = ["Lucía", "lucia", "LUCÍA!", "Ñandú Pérez-Gómez", "¡¿?!", "👶", "Zoë & Chloé"]
    assert [create(admin, name=name)["slug"] for name in names] == [
        "lucia",
        "lucia-2",
        "lucia-3",
        "nandu-perez-gomez",
        "child",
        "child-2",
        "zoe-chloe",
    ]
    assert [create(admin, name="Ana")["slug"] for _ in range(10)] == [
        "ana",
        *(f"ana-{number}" for number in range(2, 11)),
    ]


def test_generated_slugs_fit_80_characters(admin: TestClient) -> None:
    long_name = "a" * 80
    assert create(admin, name=long_name)["slug"] == "a" * 80
    assert create(admin, name=long_name)["slug"] == "a" * 78 + "-2"
    assert create(admin, name="Á" * 80)["slug"] == "a" * 78 + "-3"
    # A dash left at the cut is dropped before the suffix.
    dashed = "b" * 77 + " cd"
    assert create(admin, name=dashed)["slug"] == "b" * 77 + "-cd"
    assert create(admin, name=dashed)["slug"] == "b" * 77 + "-2"


def test_slugs_cannot_be_chosen_or_changed(admin: TestClient) -> None:
    lucia = create(admin, name="Lucía")
    for method, path in (
        ("post", "/api/admin/children"),
        ("put", f"/api/admin/children/{lucia['id']}"),
    ):
        for slug in ("lu", "lucia", "", None):
            response = admin.request(method, path, json={"name": "Lucía", "slug": slug})
            assert response.status_code == 422, (method, slug)
            assert response.json() == {
                "code": "invalid_request",
                "fields": {"slug": "extra_forbidden"},
            }
    assert listed(admin) == [lucia]


def test_admins_edit_children(admin: TestClient) -> None:
    lucia = create(admin, name="Lucía", birth_date="2021-05-04")
    mateo = create(admin, name="Mateo")
    started = utcnow()

    response = update(admin, lucia["id"], name="Lucía María", birth_date=None)
    assert response.status_code == 200
    edited = {**lucia, "name": "Lucía María", "birth_date": None}
    assert response.json() == edited
    row = stored(admin, lucia["id"])
    assert row is not None and aware(row.updated_at) >= started > aware(row.created_at)

    response = update(admin, lucia["id"], name="Lucía María", birth_date="2021-05-05")
    assert response.json() == {**edited, "birth_date": "2021-05-05"}
    assert listed(admin) == [response.json(), mateo]


def test_renaming_a_child_keeps_its_slug(admin: TestClient) -> None:
    lucia = create(admin, name="Lucía")
    mateo = create(admin, name="Mateo")
    # Links to /c/<slug> keep working: not even another child's name changes it.
    for name in ("Lucía María", "Mateo", "Ana"):
        response = update(admin, lucia["id"], name=name)
        assert response.status_code == 200, name
        assert response.json() == {**lucia, "name": name}
    row = stored(admin, lucia["id"])
    assert row is not None and row.slug == "lucia"
    assert listed(admin) == [{**lucia, "name": "Ana"}, mateo]
    # The slug stays taken; the new name's one is still free.
    assert create(admin, name="Lucía")["slug"] == "lucia-2"
    assert create(admin, name="Ana")["slug"] == "ana"


@pytest.mark.parametrize(("method", "suffix", "body"), CHILD_REQUESTS)
def test_unknown_children_are_not_found(
    admin: TestClient, method: str, suffix: str, body: dict[str, Any] | None
) -> None:
    response = admin.request(method, f"/api/admin/children/999999{suffix}", json=body)
    assert response.status_code == 404
    assert response.json() == {"code": "child_not_found"}


@pytest.mark.parametrize(
    ("value", "error"),
    [("0", "greater_than_equal"), ("2147483648", "less_than_equal"), ("lucia", "int_parsing")],
)
@pytest.mark.parametrize(("method", "suffix", "body"), CHILD_REQUESTS)
def test_child_ids_in_paths_are_validated(
    admin: TestClient,
    method: str,
    suffix: str,
    body: dict[str, Any] | None,
    value: str,
    error: str,
) -> None:
    response = admin.request(method, f"/api/admin/children/{value}{suffix}", json=body)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {"child_id": error}}


@pytest.mark.parametrize(
    ("changes", "field", "error"),
    [
        ({"name": "  "}, "name", "string_too_short"),
        ({"name": "x" * 81}, "name", "string_too_long"),
        ({"name": "a\x00b"}, "name", "value_error"),
        ({"name": None}, "name", "string_type"),
        ({"slug": "lucia"}, "slug", "extra_forbidden"),
        ({"birth_date": "2021-13-01"}, "birth_date", "date_from_datetime_parsing"),
        ({"avatar_image_id": "avatar"}, "avatar_image_id", "uuid_parsing"),
        ({"sort_order": 3}, "sort_order", "extra_forbidden"),
        # The colour has its own endpoint.
        ({"color": "#123456"}, "color", "extra_forbidden"),
    ],
)
def test_child_input_is_validated(
    admin: TestClient, changes: dict[str, Any], field: str, error: str
) -> None:
    lucia = create(admin, name="Lucía")
    for method, path in (
        ("post", "/api/admin/children"),
        ("put", f"/api/admin/children/{lucia['id']}"),
    ):
        response = admin.request(method, path, json={"name": "Mateo", **changes})
        assert response.status_code == 422, method
        assert response.json() == {"code": "invalid_request", "fields": {field: error}}
    assert listed(admin) == [lucia]


def test_a_child_needs_a_name(admin: TestClient) -> None:
    response = admin.post("/api/admin/children", json={"birth_date": "2021-05-04"})
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {"name": "missing"}}


def test_a_slug_taken_meanwhile_is_reported(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    lucia = create(admin, name="Lucía")
    mateo = create(admin, name="Mateo")
    with monkeypatch.context() as patch:
        calls = first_call_misses(patch, "taken_slugs", set())
        response = admin.post("/api/admin/children", json={"name": "Lucía"})
    assert response.status_code == 409
    assert response.json() == {"code": "slug_taken"}
    assert len(calls) == 2
    assert listed(admin) == [lucia, mateo]
    # Edits never look at slugs.
    calls = first_call_misses(monkeypatch, "taken_slugs", set())
    assert update(admin, mateo["id"], name="Lucía").status_code == 200
    assert calls == []


# Order


def test_admins_reorder_children(admin: TestClient) -> None:
    lucia, mateo, ana = (create(admin, name=name) for name in ("Lucía", "Mateo", "Ana"))
    wanted = [ana["id"], lucia["id"], mateo["id"]]
    response = admin.put("/api/admin/children/order", json={"ids": wanted})
    assert response.status_code == 200
    assert response.json() == [
        {**ana, "sort_order": 0},
        {**lucia, "sort_order": 1},
        {**mateo, "sort_order": 2},
    ]
    assert listed(admin) == response.json()
    assert create(admin, name="Leo")["sort_order"] == 3


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
def test_an_order_must_list_every_child_once(
    admin: TestClient, change: Callable[[list[int]], list[int]]
) -> None:
    for name in ("Lucía", "Mateo", "Ana"):
        create(admin, name=name)
    before = listed(admin)
    response = admin.put(
        "/api/admin/children/order", json={"ids": change([child["id"] for child in before])}
    )
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_order"}
    assert listed(admin) == before


def test_ordering_no_children(admin: TestClient) -> None:
    response = admin.put("/api/admin/children/order", json={"ids": []})
    assert (response.status_code, response.json()) == (200, [])
    response = admin.put("/api/admin/children/order", json={"ids": [1]})
    assert (response.status_code, response.json()) == (422, {"code": "invalid_order"})


def test_the_list_breaks_sort_order_ties_by_id(admin: TestClient) -> None:
    lucia, mateo, ana = (create(admin, name=name) for name in ("Lucía", "Mateo", "Ana"))

    async def tie(db: AsyncSession) -> None:
        for child in await db.scalars(select(Child)):
            child.sort_order = 0 if child.id == ana["id"] else 7
        await db.commit()

    run_db(admin, tie)
    assert [child["id"] for child in listed(admin)] == [ana["id"], lucia["id"], mateo["id"]]


# Line colours (the family timeline)


def test_admins_choose_a_childs_line_colour(admin: TestClient) -> None:
    image = add_image(admin)
    lucia = create(admin, name="Lucía", avatar_image_id=str(image))
    mateo = create(admin, name="Mateo")
    started = utcnow()
    response = set_color(admin, lucia["id"], " #AbCdEf ")
    assert response.status_code == 200
    coloured = {**lucia, "color": "#abcdef"}
    assert response.json() == coloured
    assert coloured["avatar"] == avatar_out(image)
    assert listed(admin) == [coloured, mateo]
    row = stored(admin, lucia["id"])
    assert row is not None and row.color == "#abcdef"
    assert aware(row.updated_at) >= started > aware(row.created_at)

    # Choosing another one replaces it.
    response = set_color(admin, lucia["id"], "#112233")
    assert (response.status_code, response.json()) == (200, {**lucia, "color": "#112233"})
    login_as(admin, "viewer")
    assert listed(admin) == [{**lucia, "color": "#112233"}, mateo]


def test_a_childs_colour_survives_edits_and_reordering(admin: TestClient) -> None:
    lucia = create(admin, name="Lucía")
    mateo = create(admin, name="Mateo")
    lucia = set_color(admin, lucia["id"], "#336699").json()
    image = add_image(admin)
    response = update(admin, lucia["id"], name="Lucía María", avatar_image_id=str(image))
    assert response.status_code == 200
    lucia = {**lucia, "name": "Lucía María", "avatar": avatar_out(image)}
    assert response.json() == lucia
    response = admin.put("/api/admin/children/order", json={"ids": [mateo["id"], lucia["id"]]})
    assert response.status_code == 200
    assert response.json() == [{**mateo, "sort_order": 0}, {**lucia, "sort_order": 1}]
    assert listed(admin) == response.json()


def test_resetting_a_childs_colour_is_idempotent(admin: TestClient) -> None:
    image = add_image(admin)
    lucia = create(admin, name="Lucía", avatar_image_id=str(image))
    mateo = create(admin, name="Mateo")
    assert set_color(admin, lucia["id"], "#336699").status_code == 200
    started = utcnow()
    response = reset_color(admin, lucia["id"])
    assert (response.status_code, response.json()) == (200, lucia)
    row = stored(admin, lucia["id"])
    assert row is not None and row.color is None and aware(row.updated_at) >= started

    # Back to the automatic colour already: nothing changes.
    for child in (lucia, mateo):
        before = stored(admin, child["id"])
        response = reset_color(admin, child["id"])
        assert (response.status_code, response.json()) == (200, child)
        after = stored(admin, child["id"])
        assert before is not None and after is not None
        assert aware(after.updated_at) == aware(before.updated_at)
    assert listed(admin) == [lucia, mateo]


@pytest.mark.parametrize(
    ("body", "field", "error"),
    [
        ({"color": "red"}, "color", "string_pattern_mismatch"),
        ({"color": "#abc"}, "color", "string_pattern_mismatch"),
        ({"color": "#abcdeg"}, "color", "string_pattern_mismatch"),
        ({"color": "abcdef"}, "color", "string_pattern_mismatch"),
        ({"color": "#abcdef0"}, "color", "string_pattern_mismatch"),
        ({"color": ""}, "color", "string_pattern_mismatch"),
        # Resetting is DELETE, not a null colour.
        ({"color": None}, "color", "string_type"),
        ({"color": 336699}, "color", "string_type"),
        ({}, "color", "missing"),
        ({"color": "#abcdef", "name": "Lucía"}, "name", "extra_forbidden"),
    ],
)
def test_child_colours_must_be_hex(
    admin: TestClient, body: dict[str, Any], field: str, error: str
) -> None:
    lucia = create(admin, name="Lucía")
    lucia = set_color(admin, lucia["id"], "#336699").json()
    response = admin.put(f"/api/admin/children/{lucia['id']}/color", json=body)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {field: error}}
    assert listed(admin) == [lucia]


# Delete


def test_admins_delete_unused_children(admin: TestClient) -> None:
    lucia = create(admin, name="Lucía")
    mateo = create(admin, name="Mateo")
    response = admin.delete(f"/api/admin/children/{lucia['id']}")
    assert response.status_code == 204
    assert response.content == b""
    assert listed(admin) == [mateo]
    again = admin.delete(f"/api/admin/children/{lucia['id']}")
    assert again.status_code == 404
    assert again.json() == {"code": "child_not_found"}
    # Its slug is free again.
    assert create(admin, name="Lucía")["slug"] == "lucia"


def test_children_linked_to_events_cannot_be_deleted(admin: TestClient) -> None:
    lucia, mateo, ana = (create(admin, name=name) for name in ("Lucía", "Mateo", "Ana"))
    add_event(admin, child_ids=[lucia["id"], mateo["id"]], category_ids=[1])
    add_event(admin, child_ids=[lucia["id"]], category_ids=[1], deleted=True)
    add_event(admin, child_ids=[ana["id"]], category_ids=[2], deleted=True)

    for child, events in ((lucia, 2), (mateo, 1), (ana, 1)):
        response = admin.delete(f"/api/admin/children/{child['id']}")
        assert response.status_code == 409
        assert response.json() == {"code": "child_in_use", "detail": {"events": events}}
    assert listed(admin) == [lucia, mateo, ana]


def test_a_child_linked_meanwhile_is_reported_in_use(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    lucia = create(admin, name="Lucía")
    add_event(admin, child_ids=[lucia["id"]], category_ids=[1])
    calls = first_call_misses(monkeypatch, "events_linked", 0)
    response = admin.delete(f"/api/admin/children/{lucia['id']}")
    assert response.status_code == 409
    assert response.json() == {"code": "child_in_use", "detail": {"events": 1}}
    assert calls == [(lucia["id"],), (lucia["id"],)]
    assert listed(admin) == [lucia]


# Avatars


def test_a_pending_avatar_upload_is_attached(admin: TestClient) -> None:
    image = add_image(admin, name="retrato")
    lucia = create(admin, name="Lucía", avatar_image_id=str(image))
    assert lucia["avatar"] == avatar_out(image, "retrato")
    row = image_row(admin, image)
    assert row is not None and row.expires_at is None and row.event_id is None
    assert image_folder(admin, image).is_dir()
    child = stored(admin, lucia["id"])
    assert child is not None and child.avatar_image_id == image

    login_as(admin, "viewer")
    assert listed(admin) == [lucia]


def test_an_avatar_can_be_set_on_edit_and_kept(admin: TestClient) -> None:
    lucia = create(admin, name="Lucía")
    image = add_image(admin)
    response = update(admin, lucia["id"], name="Lucía", avatar_image_id=str(image))
    assert response.status_code == 200
    assert response.json() == {**lucia, "avatar": avatar_out(image)}

    # Saving again with the current avatar keeps it.
    response = update(admin, lucia["id"], name="Lucía", avatar_image_id=str(image))
    assert response.status_code == 200
    assert response.json()["avatar"] == avatar_out(image)
    row = image_row(admin, image)
    assert row is not None and row.expires_at is None
    assert image_folder(admin, image).is_dir()


def test_replacing_an_avatar_deletes_the_previous_image(admin: TestClient) -> None:
    old = add_image(admin)
    lucia = create(admin, name="Lucía", avatar_image_id=str(old))
    new = add_image(admin, name="nueva")
    response = update(admin, lucia["id"], name="Lucía", avatar_image_id=str(new))
    assert response.status_code == 200
    assert response.json() == {**lucia, "avatar": avatar_out(new, "nueva")}
    assert image_row(admin, old) is None
    assert not image_folder(admin, old).exists()
    row = image_row(admin, new)
    assert row is not None and row.expires_at is None
    assert image_folder(admin, new).is_dir()
    assert listed(admin)[0]["avatar"] == avatar_out(new, "nueva")


def test_removing_an_avatar_deletes_the_image(admin: TestClient) -> None:
    image = add_image(admin)
    lucia = create(admin, name="Lucía", avatar_image_id=str(image))
    response = update(admin, lucia["id"], name="Lucía", avatar_image_id=None)
    assert response.status_code == 200
    assert response.json() == {**lucia, "avatar": None}
    assert image_row(admin, image) is None
    assert not image_folder(admin, image).exists()
    child = stored(admin, lucia["id"])
    assert child is not None and child.avatar_image_id is None


def another_childs_avatar(client: TestClient) -> uuid.UUID:
    image = add_image(client)
    create(client, name="Otra", avatar_image_id=str(image))
    return image


def event_image(client: TestClient) -> uuid.UUID:
    event_id = add_event(client, category_ids=[1])
    return add_image(client, purpose="event", pending=False, event_id=event_id)


@pytest.mark.parametrize(
    "make_image",
    [
        pytest.param(lambda client: uuid.uuid4(), id="unknown"),
        pytest.param(lambda client: add_image(client, purpose="event"), id="event-upload"),
        pytest.param(lambda client: add_image(client, purpose="background"), id="background"),
        pytest.param(event_image, id="event-image"),
        pytest.param(another_childs_avatar, id="another-childs-avatar"),
        pytest.param(lambda client: add_image(client, pending=False), id="not-pending"),
    ],
)
def test_only_pending_avatar_uploads_are_accepted(
    admin: TestClient, make_image: Callable[[TestClient], uuid.UUID]
) -> None:
    current = add_image(admin)
    lucia = create(admin, name="Lucía", avatar_image_id=str(current))
    image = make_image(admin)
    before = listed(admin)
    before_row = image_row(admin, image)

    created = admin.post("/api/admin/children", json={"name": "Mateo", "avatar_image_id": str(image)})
    assert created.status_code == 422
    assert created.json()["code"] == "invalid_image"
    edited = update(admin, lucia["id"], name="Lucía", avatar_image_id=str(image))
    assert edited.status_code == 422
    assert edited.json()["code"] == "invalid_image"

    assert listed(admin) == before
    after_row = image_row(admin, image)
    assert (after_row is None) == (before_row is None)
    if before_row is not None and after_row is not None:
        assert (after_row.expires_at is None) == (before_row.expires_at is None)
        assert after_row.event_id == before_row.event_id
        assert image_folder(admin, image).is_dir()
    assert image_folder(admin, current).is_dir()


def test_a_rejected_child_leaves_the_upload_pending(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    lucia = create(admin, name="Lucía")
    image = add_image(admin)
    with monkeypatch.context() as patch:
        # Another "Lucía" is saved meanwhile: the insert hits the unique slug.
        first_call_misses(patch, "taken_slugs", set())
        response = admin.post(
            "/api/admin/children", json={"name": "Lucía", "avatar_image_id": str(image)}
        )
    assert (response.status_code, response.json()) == (409, {"code": "slug_taken"})
    assert listed(admin) == [lucia]
    row = image_row(admin, image)
    assert row is not None and row.expires_at is not None
    # The upload can still be used.
    assert create(admin, name="Lucía", avatar_image_id=str(image))["avatar"] == avatar_out(image)


def test_deleting_a_child_deletes_its_avatar(admin: TestClient) -> None:
    image = add_image(admin)
    other = add_image(admin)
    lucia = create(admin, name="Lucía", avatar_image_id=str(image))
    mateo = create(admin, name="Mateo", avatar_image_id=str(other))
    assert admin.delete(f"/api/admin/children/{lucia['id']}").status_code == 204
    assert image_row(admin, image) is None
    assert not image_folder(admin, image).exists()
    assert image_row(admin, other) is not None
    assert image_folder(admin, other).is_dir()
    assert listed(admin) == [mateo]


def test_a_child_in_use_keeps_its_avatar(admin: TestClient) -> None:
    image = add_image(admin)
    lucia = create(admin, name="Lucía", avatar_image_id=str(image))
    add_event(admin, child_ids=[lucia["id"]], category_ids=[1], deleted=True)
    assert admin.delete(f"/api/admin/children/{lucia['id']}").status_code == 409
    assert image_row(admin, image) is not None
    assert image_folder(admin, image).is_dir()
    assert listed(admin) == [lucia]


def test_avatar_files_are_deleted_only_once_committed(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    old = add_image(admin)
    lucia = create(admin, name="Lucía", avatar_image_id=str(old))
    new = add_image(admin)

    async def failing_commit(self: AsyncSession) -> None:
        raise RuntimeError("database unavailable")

    for request in (
        lambda: update(admin, lucia["id"], name="Lucía", avatar_image_id=str(new)),
        lambda: update(admin, lucia["id"], name="Lucía", avatar_image_id=None),
        lambda: admin.delete(f"/api/admin/children/{lucia['id']}"),
    ):
        with monkeypatch.context() as patch:
            patch.setattr(AsyncSession, "commit", failing_commit)
            response = request()
        assert (response.status_code, response.json()) == (500, {"code": "internal_error"})
        assert image_folder(admin, old).is_dir()
        old_row, new_row = image_row(admin, old), image_row(admin, new)
        assert old_row is not None and new_row is not None
        assert new_row.expires_at is not None
        assert listed(admin) == [lucia]
