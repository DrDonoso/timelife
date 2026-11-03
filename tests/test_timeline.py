"""Timelines: a child's (scoping, order, filters, totals, output and query count) and the family
one with every child together."""

import datetime as dt
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event as sa_event
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from timelife.db import Event, EventCategory, EventChild, Image, utcnow

from .conftest import login_as, run_db
from .helpers_events import (
    add_child,
    category_ids,
    create_event,
    image_items,
    pending_images,
    reorder_day,
    set_day_order,
    set_event_times,
    timeline,
    timeline_titles,
    update_event,
    utc,
)


@pytest.fixture
def family(admin: TestClient) -> dict[str, int]:
    return {"lucia": add_child(admin, "Lucía"), "mateo": add_child(admin, "Mateo")} | category_ids(
        admin
    )


def test_the_timeline_requires_a_session(client: TestClient) -> None:
    response = client.get("/api/children/1/timeline")
    assert (response.status_code, response.json()) == (401, {"code": "authentication_required"})


def test_signed_in_users_read_a_childs_timeline(admin: TestClient, family: dict[str, int]) -> None:
    lucia, mateo = family["lucia"], family["mateo"]
    images = pending_images(admin, 3)
    shared = create_event(
        admin,
        [mateo, lucia],
        [family["social-emotional"], family["general"]],
        title="Primer encuentro entre hermanos",
        date="2025-09-19",
        images=image_items(images),
        cover_image_id=images[1],
    )
    first_steps = create_event(admin, [lucia], [family["gross-motor"]], title="Primeros pasos",
                               date="2025-03-22")
    mateo_only = create_event(admin, [mateo], [family["general"]], title="Bienvenido, Mateo",
                              date="2025-09-18")
    trashed = create_event(admin, [lucia], [family["teething"]], title="Primer diente",
                           date="2024-10-02")
    admin.delete(f"/api/admin/events/{trashed['id']}")
    cover = shared["images"][1]

    for role in ("admin", "viewer"):
        login_as(admin, role)
        body = timeline(admin, lucia)
        assert body == {
            "child_id": lucia,
            "total": 2,
            "events": [
                {
                    "id": shared["id"],
                    "title": "Primer encuentro entre hermanos",
                    "date": "2025-09-19",
                    "day_order": 0,
                    "category_ids": [family["social-emotional"], family["general"]],
                    "child_ids": sorted([lucia, mateo]),
                    "cover": {
                        "id": cover["id"],
                        "thumb_url": cover["thumb_url"],
                        "dominant_color": cover["dominant_color"],
                    },
                    "image_count": 3,
                    "created_at": shared["created_at"],
                },
                {
                    "id": first_steps["id"],
                    "title": "Primeros pasos",
                    "date": "2025-03-22",
                    "day_order": 0,
                    "category_ids": [family["gross-motor"]],
                    "child_ids": [lucia],
                    "cover": None,
                    "image_count": 0,
                    "created_at": first_steps["created_at"],
                },
            ],
        }
        # Shared events show in every linked child's timeline.
        assert [item["id"] for item in timeline(admin, mateo)["events"]] == [
            shared["id"],
            mateo_only["id"],
        ]
    assert cover["thumb_url"] == f"/api/media/{cover['id']}/thumb"


def test_a_child_without_events_has_an_empty_timeline(
    admin: TestClient, family: dict[str, int]
) -> None:
    create_event(admin, [family["lucia"]], [family["general"]])
    assert timeline(admin, family["mateo"]) == {
        "child_id": family["mateo"],
        "total": 0,
        "events": [],
    }


def test_unknown_children_are_not_found(viewer: TestClient) -> None:
    response = viewer.get("/api/children/999999/timeline")
    assert (response.status_code, response.json()) == (404, {"code": "child_not_found"})


@pytest.mark.parametrize(
    ("value", "error"),
    [("0", "greater_than_equal"), ("2147483648", "less_than_equal"), ("lucia", "int_parsing")],
)
def test_child_ids_are_validated(viewer: TestClient, value: str, error: str) -> None:
    response = viewer.get(f"/api/children/{value}/timeline")
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {"child_id": error}}


def test_trashed_events_leave_the_timeline_and_come_back_when_restored(
    admin: TestClient, family: dict[str, int]
) -> None:
    event = create_event(admin, [family["lucia"]], [family["general"]], title="Primeros pasos")
    admin.delete(f"/api/admin/events/{event['id']}")
    assert timeline(admin, family["lucia"])["total"] == 0
    admin.post(f"/api/admin/trash/{event['id']}/restore")
    body = timeline(admin, family["lucia"])
    assert (body["total"], [item["title"] for item in body["events"]]) == (1, ["Primeros pasos"])


def test_newest_first_with_ties_by_creation_then_id(
    admin: TestClient, family: dict[str, int]
) -> None:
    lucia = family["lucia"]
    ids = {
        title: create_event(admin, [lucia], [family["general"]], title=title, date=date)["id"]
        for title, date in (
            ("Antes", "2024-12-31"),
            ("Mismo día A", "2025-01-01"),
            ("Mismo día B", "2025-01-01"),
            ("Mismo día C", "2025-01-01"),
            ("Después", "2025-01-02"),
        )
    }
    # Each new event goes first of its day.
    assert timeline_titles(admin, lucia) == [
        "Después",
        "Mismo día C",
        "Mismo día B",
        "Mismo día A",
        "Antes",
    ]
    # Same day order (events saved before it existed): the most recently created, then the id.
    for title in ("Mismo día A", "Mismo día B", "Mismo día C"):
        set_day_order(admin, ids[title], 0)
    set_event_times(admin, ids["Mismo día A"], created_at=utc(2025, 1, 1, 22))
    set_event_times(admin, ids["Mismo día B"], created_at=utc(2025, 1, 1, 20))
    set_event_times(admin, ids["Mismo día C"], created_at=utc(2025, 1, 1, 20))
    assert timeline_titles(admin, lucia) == [
        "Después",
        "Mismo día A",
        "Mismo día C",
        "Mismo día B",
        "Antes",
    ]


def test_the_timeline_follows_the_order_of_each_day(
    admin: TestClient, family: dict[str, int]
) -> None:
    lucia, mateo = family["lucia"], family["mateo"]
    first = create_event(admin, [lucia], [family["general"]], title="Primero", date="2025-05-05")
    second = create_event(admin, [lucia, mateo], [family["general"]], title="Segundo",
                          date="2025-05-05")
    third = create_event(admin, [mateo], [family["general"]], title="Tercero", date="2025-05-05")
    response = reorder_day(admin, "2025-05-05", [first["id"], second["id"], third["id"]])
    assert response.status_code == 200, response.text
    events = timeline(admin, lucia)["events"]
    assert [(item["title"], item["day_order"]) for item in events] == [
        ("Primero", 0),
        ("Segundo", 1),
    ]
    assert timeline_titles(admin, mateo) == ["Segundo", "Tercero"]


def test_text_search_ignores_accents_case_and_word_order(
    admin: TestClient, family: dict[str, int]
) -> None:
    lucia = family["lucia"]
    for title, date in (
        ("Primer día de guardería", "2025-03-03"),
        ("Día de playa", "2025-07-12"),
        ("Primeros pasos", "2025-03-22"),
        ("Cumpleaños de la abuela", "2025-05-01"),
        ("ÉXITO con la cuchara", "2025-04-01"),
    ):
        create_event(admin, [lucia], [family["general"]], title=title, date=date)

    cases: list[tuple[str, list[str]]] = [
        ("dia", ["Día de playa", "Primer día de guardería"]),
        ("DÍA", ["Día de playa", "Primer día de guardería"]),
        ("Día", ["Día de playa", "Primer día de guardería"]),
        ("guarderia primer", ["Primer día de guardería"]),
        ("  PASOS   primeros ", ["Primeros pasos"]),
        ("primer", ["Primeros pasos", "Primer día de guardería"]),
        ("cumpleanos", ["Cumpleaños de la abuela"]),
        ("CUMPLEAÑOS", ["Cumpleaños de la abuela"]),
        ("exito", ["ÉXITO con la cuchara"]),
        ("dia playa", ["Día de playa"]),
        ("dia zzz", []),
        ("", ["Día de playa", "Cumpleaños de la abuela", "ÉXITO con la cuchara",
              "Primeros pasos", "Primer día de guardería"]),
    ]
    for q, titles in cases:
        body = timeline(admin, lucia, q=q)
        assert [item["title"] for item in body["events"]] == titles, q
        assert body["total"] == 5, q


def test_search_wildcards_match_literally(admin: TestClient, family: dict[str, int]) -> None:
    for title in ("Feliz al 100%", "Hora_de_dormir", "Otro hito"):
        create_event(admin, [family["lucia"]], [family["general"]], title=title)
    assert timeline_titles(admin, family["lucia"], q="%") == ["Feliz al 100%"]
    assert timeline_titles(admin, family["lucia"], q="_") == ["Hora_de_dormir"]


def test_the_date_range_is_inclusive(admin: TestClient, family: dict[str, int]) -> None:
    lucia = family["lucia"]
    for date in ("2025-01-01", "2025-01-15", "2025-01-31", "2025-02-01"):
        create_event(admin, [lucia], [family["general"]], title=date, date=date)

    cases: list[tuple[dict[str, str], list[str]]] = [
        ({"date_from": "2025-01-15", "date_to": "2025-01-31"}, ["2025-01-31", "2025-01-15"]),
        ({"date_from": "2025-01-15"}, ["2025-02-01", "2025-01-31", "2025-01-15"]),
        ({"date_to": "2025-01-15"}, ["2025-01-15", "2025-01-01"]),
        ({"date_from": "2025-01-31", "date_to": "2025-01-31"}, ["2025-01-31"]),
        ({"date_from": "2025-01-02", "date_to": "2025-01-14"}, []),
        ({"date_from": "2024-01-01", "date_to": "2026-01-01"},
         ["2025-02-01", "2025-01-31", "2025-01-15", "2025-01-01"]),
    ]
    for params, titles in cases:
        body = timeline(admin, lucia, **params)
        assert [item["title"] for item in body["events"]] == titles, params
        assert body["total"] == 4


def test_a_reversed_date_range_is_rejected(viewer: TestClient) -> None:
    response = viewer.get(
        "/api/children/1/timeline", params={"date_from": "2025-02-01", "date_to": "2025-01-31"}
    )
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {"date_to": "value_error"}}


def test_the_category_filter_matches_any(admin: TestClient, family: dict[str, int]) -> None:
    lucia = family["lucia"]
    sleep, feeding, language, general = (
        family["sleep"],
        family["feeding"],
        family["language"],
        family["general"],
    )
    for title, categories, date in (
        ("Duerme", [sleep], "2025-01-04"),
        ("Papilla", [feeding], "2025-01-03"),
        ("Dice agua", [language, feeding], "2025-01-02"),
        ("General", [general], "2025-01-01"),
    ):
        create_event(admin, [lucia], categories, title=title, date=date)

    cases: list[tuple[dict[str, Any], list[str]]] = [
        ({"category_id": [feeding]}, ["Papilla", "Dice agua"]),
        ({"category_id": [sleep, feeding]}, ["Duerme", "Papilla", "Dice agua"]),
        ({"category_id": [language]}, ["Dice agua"]),
        ({"category_id": [feeding, feeding]}, ["Papilla", "Dice agua"]),
        ({"category_id": [999_999]}, []),
        ({"category_id": [feeding], "q": "agua"}, ["Dice agua"]),
        ({"category_id": [feeding, general], "date_to": "2025-01-02"}, ["Dice agua", "General"]),
        ({"category_id": [sleep], "date_from": "2025-01-05"}, []),
    ]
    for params, titles in cases:
        body = timeline(admin, lucia, **params)
        assert [item["title"] for item in body["events"]] == titles, params
        assert body["total"] == 4, params


def test_categories_keep_their_saved_order(admin: TestClient, family: dict[str, int]) -> None:
    order = [family["self-care"], family["feeding"], family["fine-motor"]]
    event = create_event(admin, [family["lucia"]], order)
    [item] = timeline(admin, family["lucia"])["events"]
    assert item["category_ids"] == order
    update_event(admin, event, category_ids=[family["fine-motor"], family["self-care"]])
    [item] = timeline(admin, family["lucia"])["events"]
    assert item["category_ids"] == [family["fine-motor"], family["self-care"]]


def test_the_total_ignores_filters_but_not_the_child_or_the_trash(
    admin: TestClient, family: dict[str, int]
) -> None:
    lucia, mateo = family["lucia"], family["mateo"]
    for title in ("Uno", "Dos", "Tres"):
        create_event(admin, [lucia], [family["general"]], title=title)
    create_event(admin, [mateo], [family["general"]], title="De Mateo")
    trashed = create_event(admin, [lucia, mateo], [family["general"]], title="Borrado")
    admin.delete(f"/api/admin/events/{trashed['id']}")
    body = timeline(admin, lucia, q="dos", category_id=[family["general"]])
    assert ([item["title"] for item in body["events"]], body["total"]) == (["Dos"], 3)
    assert timeline(admin, mateo)["total"] == 1


@pytest.mark.parametrize(
    ("params", "field", "error"),
    [
        ({"q": "x" * 201}, "q", "string_too_long"),
        ({"date_from": "2025-13-01"}, "date_from", "date_from_datetime_parsing"),
        ({"date_to": "mañana"}, "date_to", "date_from_datetime_parsing"),
        ({"category_id": "0"}, "category_id", "greater_than_equal"),
        ({"category_id": ["1", "sueño"]}, "category_id", "int_parsing"),
    ],
)
def test_timeline_parameters_are_validated(
    viewer: TestClient, params: dict[str, Any], field: str, error: str
) -> None:
    response = viewer.get("/api/children/1/timeline", params=params)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {field: error}}


def test_long_timelines_take_a_fixed_number_of_queries(
    admin: TestClient, family: dict[str, int]
) -> None:
    lucia, mateo = family["lucia"], family["mateo"]
    count = 2100
    categories = [family["general"], family["sleep"], family["feeding"], family["language"]]

    async def fill(db: AsyncSession) -> None:
        now = utcnow()
        events = [
            {
                "id": number,
                "title": f"Hito {number}",
                "title_search": f"hito {number}",
                "date": dt.date(2020, 1, 1) + dt.timedelta(days=number),
                "notes": "",
                "version": 1,
                "created_at": now,
                "updated_at": now,
                "deleted_at": now if number % 50 == 0 else None,
            }
            for number in range(1, count + 1)
        ]
        await db.execute(insert(Event), events)
        children = [{"event_id": number, "child_id": lucia} for number in range(1, count + 1)]
        children += [
            {"event_id": number, "child_id": mateo} for number in range(1, count + 1, 3)
        ]
        await db.execute(insert(EventChild), children)
        await db.execute(
            insert(EventCategory),
            [
                {"event_id": number, "category_id": categories[(number + offset) % 4],
                 "position": offset}
                for number in range(1, count + 1)
                for offset in range(1 + number % 2)
            ],
        )
        images = []
        covers = []
        for number in range(1, count + 1, 2):
            for position in range(2):
                image_id = uuid.uuid4()
                images.append(
                    {
                        "id": image_id,
                        "purpose": "event",
                        "event_id": number,
                        "name": f"Foto {position}",
                        "original_filename": "foto.jpg",
                        "original_ext": "jpg",
                        "content_type": "image/jpeg",
                        "byte_size": 1,
                        "width": 4,
                        "height": 3,
                        "dominant_color": "#aabbcc",
                        "position": position,
                        "created_at": now,
                    }
                )
                if position == 0:
                    covers.append((number, image_id))
        await db.execute(insert(Image), images)
        for number, image_id in covers:
            await db.execute(
                Event.__table__.update()
                .where(Event.__table__.c.id == number)
                .values(cover_image_id=image_id)
            )
        await db.commit()

    run_db(admin, fill)
    app: Any = admin.app
    engine = app.state.sessions.kw["bind"].sync_engine
    statements: list[str] = []

    def record(*args: Any) -> None:
        statements.append(args[2])

    sa_event.listen(engine, "before_cursor_execute", record)
    try:
        body = timeline(admin, lucia)
        unfiltered = len(statements)
        statements.clear()
        filtered = timeline(admin, lucia, q="hito", category_id=categories[:2],
                            date_from="2020-01-01")
        assert len(statements) == unfiltered
    finally:
        sa_event.remove(engine, "before_cursor_execute", record)

    live = count - count // 50
    assert body["total"] == live
    assert len(body["events"]) == live
    # Session check, child check, total, events, categories, children.
    assert unfiltered <= 6
    assert filtered["total"] == live
    newest = body["events"][0]
    assert newest["title"] == "Hito 2099"
    assert newest["child_ids"] == [lucia]
    assert newest["image_count"] == 2
    assert newest["cover"]["dominant_color"] == "#aabbcc"
    assert len(newest["category_ids"]) == 2
    shared = next(item for item in body["events"] if item["title"] == "Hito 1")
    assert (shared["child_ids"], shared["image_count"]) == (sorted([lucia, mateo]), 2)
    assert timeline(admin, mateo)["total"] == len(
        [number for number in range(1, count + 1, 3) if number % 50]
    )

    # The family timeline (every child together) needs no child check.
    statements.clear()
    sa_event.listen(engine, "before_cursor_execute", record)
    try:
        everyone = family_timeline(admin)
    finally:
        sa_event.remove(engine, "before_cursor_execute", record)
    assert everyone["total"] == live
    assert len(statements) <= 5


# The family timeline (every child together) -------------------------------------------------


def family_timeline(client: TestClient, **params: Any) -> dict[str, Any]:
    response = client.get("/api/timeline", params=params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def test_the_family_timeline_requires_a_session(client: TestClient) -> None:
    response = client.get("/api/timeline")
    assert (response.status_code, response.json()) == (401, {"code": "authentication_required"})


def test_the_family_timeline_has_every_childs_events_once(
    admin: TestClient, family: dict[str, int]
) -> None:
    lucia, mateo = family["lucia"], family["mateo"]
    assert family_timeline(admin) == {"child_id": None, "total": 0, "events": []}
    shared = create_event(admin, [mateo, lucia], [family["general"]], title="Juntos",
                          date="2025-09-19")
    hers = create_event(admin, [lucia], [family["general"]], title="De Lucía", date="2025-03-22")
    his = create_event(admin, [mateo], [family["general"]], title="De Mateo", date="2025-09-18")
    trashed = create_event(admin, [lucia], [family["general"]], title="Borrado", date="2024-01-01")
    admin.delete(f"/api/admin/events/{trashed['id']}")

    for role in ("admin", "viewer"):
        login_as(admin, role)
        body = family_timeline(admin)
        assert (body["child_id"], body["total"]) == (None, 3)
        # Newest first, a shared event once, each with the children it belongs to.
        assert [(item["id"], item["child_ids"]) for item in body["events"]] == [
            (shared["id"], sorted([lucia, mateo])),
            (his["id"], [mateo]),
            (hers["id"], [lucia]),
        ]
        # The same events (and fields) as on the children's own timelines.
        own = {item["id"]: item for child in (lucia, mateo) for item in timeline(admin, child)["events"]}
        assert body["events"] == [own[item["id"]] for item in body["events"]]


def test_the_family_timeline_takes_the_same_filters(
    admin: TestClient, family: dict[str, int]
) -> None:
    lucia, mateo = family["lucia"], family["mateo"]
    create_event(admin, [lucia], [family["sleep"]], title="Duerme sola", date="2025-05-01")
    create_event(admin, [mateo], [family["sleep"]], title="Duerme del tirón", date="2025-06-01")
    create_event(admin, [mateo], [family["general"]], title="Sonríe", date="2025-07-01")
    body = family_timeline(admin, q="duerme", category_id=[family["sleep"]], date_to="2025-05-31")
    assert ([item["title"] for item in body["events"]], body["total"]) == (["Duerme sola"], 3)
    response = admin.get("/api/timeline", params={"date_from": "2025-02-01", "date_to": "2025-01-31"})
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {"date_to": "value_error"}}
    response = admin.get("/api/timeline", params={"category_id": "0"})
    assert response.json() == {"code": "invalid_request", "fields": {"category_id": "greater_than_equal"}}
