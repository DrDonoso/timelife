"""What's new: the notes each user has read (``/api/whats-new``), only ever their own, merged
and capped, with the ids' format checked."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from timelife import whats_new
from timelife.db import User

from .conftest import login_as, run_db

SEEN = "/api/whats-new/seen"
LAUNCH = "2026-11-16-novedades"


def mark(client: TestClient, *ids: str) -> Any:
    response = client.post(SEEN, json={"ids": list(ids)})
    assert response.status_code == 200, response.text
    return response.json()


def stored(client: TestClient, user_id: int) -> object:
    async def read(db: AsyncSession) -> object:
        user = await db.get(User, user_id)
        assert user is not None
        return user.whats_new_seen

    return run_db(client, read)


def test_whats_new_needs_a_session(client: TestClient) -> None:
    assert client.get("/api/whats-new").status_code == 401
    response = client.post(SEEN, json={"ids": [LAUNCH]})
    assert response.status_code == 401
    assert response.json() == {"code": "authentication_required"}


def test_new_users_have_read_nothing_yet_then_their_notes_add_up(viewer: TestClient) -> None:
    # NULL until the interface records the notes for the first time.
    assert viewer.get("/api/whats-new").json() == {"seen": None}
    assert mark(viewer, LAUNCH) == {"seen": [LAUNCH]}
    # Repeated ids change nothing; the list stays sorted (oldest first).
    later = "2027-02-03-family-albums"
    earlier = "2026-12-01-zoom"
    assert mark(viewer, later, LAUNCH, earlier, later) == {"seen": [LAUNCH, earlier, later]}
    assert viewer.get("/api/whats-new").json() == {"seen": [LAUNCH, earlier, later]}


def test_each_user_keeps_their_own_notes(client: TestClient) -> None:
    viewer_id = login_as(client, "viewer")
    mark(client, LAUNCH)
    admin_id = login_as(client, "admin")
    assert client.get("/api/whats-new").json() == {"seen": None}
    mark(client, "2026-12-01-backups")
    assert stored(client, viewer_id) == [LAUNCH]
    assert stored(client, admin_id) == ["2026-12-01-backups"]


def test_only_the_newest_notes_are_kept(
    viewer: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(whats_new, "MAX_SEEN", 3)
    mark(viewer, "2026-01-01-a", "2026-02-01-b", "2026-03-01-c")
    assert mark(viewer, "2026-04-01-d", "2025-12-31-z") == {
        "seen": ["2026-02-01-b", "2026-03-01-c", "2026-04-01-d"]
    }


@pytest.mark.parametrize(
    ("body", "field", "error"),
    [
        ({"ids": []}, "ids", "too_short"),
        ({"ids": [f"2026-01-01-n{index}" for index in range(501)]}, "ids", "too_long"),
        ({"ids": "2026-11-16-novedades"}, "ids", "list_type"),
        ({"ids": [7]}, "ids", "string_type"),
        ({"ids": ["novedades"]}, "ids", "string_pattern_mismatch"),
        ({"ids": ["2026-11-16-Novedades"]}, "ids", "string_pattern_mismatch"),
        ({"ids": ["2026-11-16-novedades.json"]}, "ids", "string_pattern_mismatch"),
        ({"ids": ["2026-11-16-" + "a" * 70]}, "ids", "string_too_long"),
        ({}, "ids", "missing"),
        ({"ids": [LAUNCH], "all": True}, "all", "extra_forbidden"),
    ],
)
def test_note_ids_are_checked(
    viewer: TestClient, body: dict[str, Any], field: str, error: str
) -> None:
    response = viewer.post(SEEN, json=body)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {field: error}}
    assert viewer.get("/api/whats-new").json() == {"seen": None}
