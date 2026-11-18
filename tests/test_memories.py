"""Memories: the last day each user was told about their memories and looked at them
(``/api/memories``), only ever their own, never moving back, and only for a day that is today
somewhere in the world; and the memories of a day as the server finds them (for the morning
notification), with the same rules as the interface."""

import datetime as dt
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from timelife import contracts
from timelife.memories import Memory, memories_on, memory_age

from .conftest import login_as, run_db
from .helpers_events import add_child, category_ids, create_event

SEEN = "/api/memories/seen"
TODAY = dt.date(2026, 11, 17)
NOTHING = {"announced_on": None, "opened_on": None}


@pytest.fixture(autouse=True)
def today(monkeypatch: pytest.MonkeyPatch) -> dt.date:
    monkeypatch.setattr(contracts, "utc_today", lambda: TODAY)
    return TODAY


def day(offset: int) -> str:
    return (TODAY + dt.timedelta(days=offset)).isoformat()


def mark(client: TestClient, **body: Any) -> Any:
    response = client.post(SEEN, json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_memories_need_a_session(client: TestClient) -> None:
    assert client.get("/api/memories").status_code == 401
    response = client.post(SEEN, json={"opened_on": day(0)})
    assert response.status_code == 401
    assert response.json() == {"code": "authentication_required"}


def test_the_days_are_recorded_and_never_move_back(viewer: TestClient) -> None:
    assert viewer.get("/api/memories").json() == NOTHING
    assert mark(viewer, announced_on=day(0)) == {"announced_on": day(0), "opened_on": None}
    assert mark(viewer, opened_on=day(0)) == {"announced_on": day(0), "opened_on": day(0)}
    # Another device, still on yesterday (another time zone): nothing changes.
    assert mark(viewer, announced_on=day(-1), opened_on=day(-1)) == {
        "announced_on": day(0),
        "opened_on": day(0),
    }
    # One already on tomorrow moves them on; nothing given (or null) keeps what there is.
    assert mark(viewer, opened_on=day(1), announced_on=None) == {
        "announced_on": day(0),
        "opened_on": day(1),
    }
    assert mark(viewer) == {"announced_on": day(0), "opened_on": day(1)}
    assert viewer.get("/api/memories").json() == {"announced_on": day(0), "opened_on": day(1)}


def test_each_user_keeps_their_own_days(client: TestClient) -> None:
    login_as(client, "viewer")
    mark(client, announced_on=day(0), opened_on=day(0))
    login_as(client, "admin")
    assert client.get("/api/memories").json() == NOTHING
    mark(client, announced_on=day(-1))
    assert client.get("/api/memories").json() == {"announced_on": day(-1), "opened_on": None}
    login_as(client, "viewer")
    assert client.get("/api/memories").json() == {"announced_on": day(0), "opened_on": day(0)}


@pytest.mark.parametrize(
    ("body", "field", "error"),
    [
        # Today nowhere in the world: a device with a wrong clock.
        ({"opened_on": day(2)}, "opened_on", "value_error"),
        ({"announced_on": day(-2)}, "announced_on", "value_error"),
        ({"opened_on": "2026-02-30"}, "opened_on", "date_from_datetime_parsing"),
        ({"announced_on": "today"}, "announced_on", "date_from_datetime_parsing"),
        ({"opened_on": day(0), "seen": True}, "seen", "extra_forbidden"),
    ],
)
def test_only_days_that_are_today_somewhere_are_accepted(
    viewer: TestClient, body: dict[str, Any], field: str, error: str
) -> None:
    response = viewer.post(SEEN, json=body)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {field: error}}
    assert viewer.get("/api/memories").json() == NOTHING

# The same cases as frontend/src/memories/memories.test.ts: both must find the same memories.
@pytest.mark.parametrize(
    ("date", "day", "age"),
    [
        ("2026-10-17", "2026-11-17", ("months", 1)),
        ("2025-12-17", "2026-11-17", ("months", 11)),
        ("2025-11-17", "2026-11-17", ("years", 1)),
        ("2023-11-17", "2026-11-17", ("years", 3)),
        *[
            (date, "2026-11-17", None)
            for date in (
                "2026-11-17", "2026-11-16", "2026-10-16", "2025-10-17", "2024-05-17", "2026-12-17"
            )
        ],
        # The 29th to 31st on the last day of shorter months, 29 February on the 28th.
        *[
            (date, "2026-02-28", ("months", 1))
            for date in ("2026-01-28", "2026-01-29", "2026-01-30", "2026-01-31")
        ],
        ("2026-03-31", "2026-04-30", ("months", 1)),
        ("2026-01-31", "2026-03-31", ("months", 2)),
        ("2026-01-31", "2026-03-28", None),
        ("2028-01-31", "2028-02-29", ("months", 1)),
        ("2028-01-31", "2028-02-28", None),
        ("2024-02-29", "2025-02-28", ("years", 1)),
        ("2024-02-29", "2028-02-29", ("years", 4)),
        ("2024-02-29", "2028-02-28", None),
    ],
)
def test_the_server_counts_ages_as_the_interface(
    date: str, day: str, age: tuple[str, int] | None
) -> None:
    assert memory_age(dt.date.fromisoformat(date), dt.date.fromisoformat(day)) == age


def test_the_server_finds_the_memories_of_a_day(admin: TestClient) -> None:
    lucia, mateo = add_child(admin, "Lucía"), add_child(admin, "Mateo")
    category = next(iter(category_ids(admin).values()))
    dates = {
        "Hoy": "2026-11-17",
        "Dos años": "2024-11-17",
        "Un mes": "2026-10-17",
        "Un año": "2025-11-17",
        "Tres meses": "2026-08-17",
        "Otro mes": "2026-10-17",
        "Casi": "2026-10-18",
        "En la papelera": "2025-11-17",
    }
    ids = {
        title: create_event(
            admin, [mateo] if title == "Un año" else [mateo, lucia], [category], title=title,
            date=date,
        )["id"]
        for title, date in dates.items()
    }
    assert admin.delete(f"/api/admin/events/{ids['En la papelera']}").status_code == 204

    async def find(db: AsyncSession) -> list[Memory]:
        return await memories_on(db, dt.date(2026, 11, 17))

    found = run_db(admin, find)
    # The most recent first; those of the same age in the timeline's order.
    timeline = [event["title"] for event in admin.get("/api/timeline").json()["events"]]
    month_old = [title for title in timeline if title in {"Un mes", "Otro mes"}]
    assert [memory.title for memory in found] == [*month_old, "Tres meses", "Un año", "Dos años"]
    assert [(memory.unit, memory.count) for memory in found][2:] == [
        ("months", 3), ("years", 1), ("years", 2),
    ]
    # They open over the timeline of their first child.
    paths = {memory.title: memory.path for memory in found}
    one_year = ids["Un año"]
    assert paths["Un año"] == f"/c/mateo/e/{one_year}?zoom=events&focus=e{one_year}"
    assert paths["Dos años"].startswith(f"/c/lucia/e/{ids['Dos años']}?")
