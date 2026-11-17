"""Memories: the last day each user was told about their memories and looked at them
(``/api/memories``), only ever their own, never moving back, and only for a day that is today
somewhere in the world."""

import datetime as dt
from typing import Any

import pytest
from fastapi.testclient import TestClient

from timelife import contracts

from .conftest import login_as

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
