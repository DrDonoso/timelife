"""Appearance: year colour overrides, the years that have events, the background image, its
opacity, the default zoom and how corrupted settings fall back to their defaults."""

import asyncio
import datetime as dt
import uuid
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from timelife import appearance
from timelife.auth import SessionUser
from timelife.config import Settings
from timelife.contracts import SettingsIn
from timelife.db import AppSetting, Child, Event, Image, YearColor, aware, utcnow

from .conftest import login_as, run_db
from .helpers_media import PHOTO_FIELDS, add_folder, image_row, uploaded

Sessions = async_sessionmaker[AsyncSession]

DEFAULTS: dict[str, Any] = {
    "year_colors": [],
    "event_years": [],
    "background": None,
    "background_opacity": 0.18,
    "default_zoom": "events",
    "direction_desktop": "right_to_left",
    "direction_mobile": "bottom_to_top",
}
SETTINGS: dict[str, Any] = {
    "background_image_id": None,
    "background_opacity": 0.18,
    "default_zoom": "events",
    "direction_desktop": "right_to_left",
    "direction_mobile": "bottom_to_top",
}
DIRECTIONS = ["left_to_right", "right_to_left", "top_to_bottom", "bottom_to_top"]
# Each request would change the state that ``customise`` leaves.
ADMIN_REQUESTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("put", "/api/admin/year-colors/2024", {"color": "#112233"}),
    ("put", "/api/admin/year-colors/2025", {"color": "#112233"}),
    ("delete", "/api/admin/year-colors/2024", None),
    ("put", "/api/admin/settings", SETTINGS),
]


def appearance_of(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/appearance")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def set_color(client: TestClient, year: int | str, color: Any) -> httpx.Response:
    return client.put(f"/api/admin/year-colors/{year}", json={"color": color})


def reset_color(client: TestClient, year: int | str) -> httpx.Response:
    return client.delete(f"/api/admin/year-colors/{year}")


def save(client: TestClient, **changes: Any) -> httpx.Response:
    """``PUT /api/admin/settings`` with the default settings overridden by ``changes``."""
    return client.put("/api/admin/settings", json={**SETTINGS, **changes})


def saved(client: TestClient, **changes: Any) -> dict[str, Any]:
    response = save(client, **changes)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def customise(client: TestClient) -> dict[str, Any]:
    """A colour override for 2024, a background and non-default settings; the appearance."""
    assert set_color(client, 2024, "#336699").status_code == 200
    background = uploaded(client, "background")
    return saved(
        client,
        background_image_id=background["id"],
        background_opacity=0.5,
        default_zoom="years",
        direction_desktop="left_to_right",
        direction_mobile="top_to_bottom",
    )


# Rows written directly (as other modules or a hand edit would) --------------------------------


def media_dir(client: TestClient) -> Path:
    app: Any = client.app
    return app.state.settings.media_dir


def folder(client: TestClient, image_id: uuid.UUID | str) -> Path:
    return media_dir(client) / str(image_id)


def add_image(client: TestClient, purpose: str = "background", **options: Any) -> uuid.UUID:
    """An image row (pending unless ``expires_at=None``) with a dummy folder; returns its id."""
    row = image_row(purpose, **options)

    async def insert(db: AsyncSession) -> None:
        db.add(row)
        await db.commit()

    run_db(client, insert)
    add_folder(media_dir(client), row.id)
    return row.id


def image_out(image_id: uuid.UUID) -> dict[str, Any]:
    """``ImageOut`` of an image created by ``add_image``."""
    return {
        "id": str(image_id),
        "name": "photo",
        "width": 640,
        "height": 480,
        "dominant_color": "#336699",
        "crop": None,
        "thumb_url": f"/api/media/{image_id}/thumb",
        "display_url": f"/api/media/{image_id}/display",
        **PHOTO_FIELDS,
    }


def stored_image(client: TestClient, image_id: uuid.UUID | str) -> Image | None:
    async def load(db: AsyncSession) -> Image | None:
        return await db.get(Image, uuid.UUID(str(image_id)))

    return run_db(client, load)


def add_events(client: TestClient, *days: str, deleted: bool = False) -> list[int]:
    """Events on the ISO ``days`` (soft-deleted when ``deleted``); returns their ids."""

    async def insert(db: AsyncSession) -> list[int]:
        now = utcnow()
        events = [
            Event(
                title="Hito",
                title_search="hito",
                date=dt.date.fromisoformat(day),
                notes="",
                version=1,
                created_at=now,
                updated_at=now,
                deleted_at=now if deleted else None,
            )
            for day in days
        ]
        db.add_all(events)
        await db.commit()
        return [event.id for event in events]

    return run_db(client, insert)


def child_avatar(client: TestClient) -> uuid.UUID:
    image_id = add_image(client, "avatar", expires_at=None)

    async def insert(db: AsyncSession) -> None:
        db.add(Child(name="Lucía", slug="lucia", sort_order=0, avatar_image_id=image_id))
        await db.commit()

    run_db(client, insert)
    return image_id


def event_image(client: TestClient) -> uuid.UUID:
    [event_id] = add_events(client, "2025-05-01")
    return add_image(client, "event", event_id=event_id, expires_at=None)


def stored_settings(client: TestClient) -> dict[str, Any]:
    async def load(db: AsyncSession) -> dict[str, Any]:
        rows = await db.execute(
            select(AppSetting.key, AppSetting.value).where(
                AppSetting.key.in_(appearance.SETTING_KEYS)
            )
        )
        return {key: value for key, value in rows}

    return run_db(client, load)


def store(client: TestClient, **values: Any) -> None:
    """Write ``app_settings`` values directly, like a hand edit of the database."""

    async def write(db: AsyncSession) -> None:
        for key, value in values.items():
            await db.merge(AppSetting(key=key, value=value, updated_at=utcnow()))
        await db.commit()

    run_db(client, write)


def year_rows(client: TestClient) -> dict[int, tuple[str, dt.datetime]]:
    async def load(db: AsyncSession) -> dict[int, tuple[str, dt.datetime]]:
        rows = await db.scalars(select(YearColor))
        return {row.year: (row.color, aware(row.updated_at)) for row in rows}

    return run_db(client, load)


# Access ---------------------------------------------------------------------------------------


def test_appearance_requires_a_session(client: TestClient) -> None:
    for method, path, body in [("get", "/api/appearance", None), *ADMIN_REQUESTS]:
        response = client.request(method, path, json=body)
        assert response.status_code == 401, (method, path)
        assert response.json() == {"code": "authentication_required"}


def test_viewers_read_the_appearance_but_cannot_change_it(admin: TestClient) -> None:
    expected = customise(admin)
    login_as(admin, "viewer")
    assert appearance_of(admin) == expected
    for method, path, body in ADMIN_REQUESTS:
        response = admin.request(method, path, json=body)
        assert response.status_code == 403, (method, path)
        assert response.json() == {"code": "admin_required"}
    assert appearance_of(admin) == expected


def test_appearance_changes_need_the_same_origin_headers(admin: TestClient) -> None:
    expected = customise(admin)
    for headers in ({"x-timelife-request": "0"}, {"origin": "http://evil.example"}):
        for method, path, body in ADMIN_REQUESTS:
            response = admin.request(method, path, json=body, headers=headers)
            assert response.status_code == 403, (method, path, headers)
            assert response.json() == {"code": "invalid_origin"}
    assert appearance_of(admin) == expected


def test_defaults_without_any_setting(admin: TestClient) -> None:
    assert appearance_of(admin) == DEFAULTS
    login_as(admin, "viewer")
    assert appearance_of(admin) == DEFAULTS


# Year colours -----------------------------------------------------------------------------


def test_admins_override_year_colors(admin: TestClient) -> None:
    started = utcnow()
    response = set_color(admin, 2024, "#AbCdEf")
    assert response.status_code == 200
    assert response.json() == {**DEFAULTS, "year_colors": [{"year": 2024, "color": "#abcdef"}]}

    for year, color in ((1900, "#000000"), (2200, "#FFFFFF"), (2026, " #112233 ")):
        assert set_color(admin, year, color).status_code == 200
    # Setting a year again replaces its colour.
    response = set_color(admin, 2024, "#445566")
    assert response.status_code == 200
    assert response.json()["year_colors"] == [
        {"year": 2200, "color": "#ffffff"},
        {"year": 2026, "color": "#112233"},
        {"year": 2024, "color": "#445566"},
        {"year": 1900, "color": "#000000"},
    ]
    assert appearance_of(admin) == response.json()
    rows = year_rows(admin)
    assert sorted(rows) == [1900, 2024, 2026, 2200]
    assert rows[2024][0] == "#445566"
    assert all(updated_at >= started for _, updated_at in rows.values())

    login_as(admin, "viewer")
    assert appearance_of(admin) == response.json()


def test_resetting_a_year_color_is_idempotent(admin: TestClient) -> None:
    set_color(admin, 2024, "#336699")
    set_color(admin, 2025, "#996633")
    expected = {**DEFAULTS, "year_colors": [{"year": 2025, "color": "#996633"}]}
    for year in (2024, 2024, 1999):
        response = reset_color(admin, year)
        assert response.status_code == 200, year
        assert response.json() == expected
    assert reset_color(admin, 2025).json() == DEFAULTS
    assert year_rows(admin) == {}
    assert appearance_of(admin) == DEFAULTS


@pytest.mark.parametrize("year", ["1899", "2201", "0", "-2024", "99999999999999999999"])
def test_years_outside_1900_to_2200_are_rejected(admin: TestClient, year: str) -> None:
    set_color(admin, 2024, "#336699")
    before = appearance_of(admin)
    for response in (set_color(admin, year, "#112233"), reset_color(admin, year)):
        assert response.status_code == 422
        assert response.json() == {"code": "invalid_year"}
    assert appearance_of(admin) == before


@pytest.mark.parametrize("year", ["abc", "2024.5", "2024x"])
def test_years_in_paths_must_be_integers(admin: TestClient, year: str) -> None:
    for response in (set_color(admin, year, "#112233"), reset_color(admin, year)):
        assert response.status_code == 422
        assert response.json() == {"code": "invalid_request", "fields": {"year": "int_parsing"}}
    assert appearance_of(admin) == DEFAULTS


@pytest.mark.parametrize(
    ("body", "field", "error"),
    [
        ({"color": "red"}, "color", "string_pattern_mismatch"),
        ({"color": "#abc"}, "color", "string_pattern_mismatch"),
        ({"color": "#abcdeg"}, "color", "string_pattern_mismatch"),
        ({"color": "abcdef"}, "color", "string_pattern_mismatch"),
        ({"color": "#abcdef0"}, "color", "string_pattern_mismatch"),
        ({"color": ""}, "color", "string_pattern_mismatch"),
        ({"color": None}, "color", "string_type"),
        ({"color": 336699}, "color", "string_type"),
        ({}, "color", "missing"),
        ({"color": "#abcdef", "year": 2024}, "year", "extra_forbidden"),
    ],
)
def test_year_colors_must_be_hex(
    admin: TestClient, body: dict[str, Any], field: str, error: str
) -> None:
    response = admin.put("/api/admin/year-colors/2024", json=body)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {field: error}}
    assert appearance_of(admin) == DEFAULTS


# Event years ------------------------------------------------------------------------------


def test_event_years_are_the_distinct_years_of_live_events(admin: TestClient) -> None:
    add_events(admin, "2024-01-01", "2024-12-31", "2023-12-31", "2026-03-01", "2026-03-01")
    add_events(admin, "1850-07-04")
    # Trashed events only count through live events of the same year.
    add_events(admin, "2019-05-05", "2024-06-15", "2031-01-01", deleted=True)
    assert appearance_of(admin)["event_years"] == [2026, 2024, 2023, 1850]
    # Every response carries them.
    assert set_color(admin, 2023, "#336699").json()["event_years"] == [2026, 2024, 2023, 1850]
    assert saved(admin)["event_years"] == [2026, 2024, 2023, 1850]

    login_as(admin, "viewer")
    assert appearance_of(admin) == {
        **DEFAULTS,
        "year_colors": [{"year": 2023, "color": "#336699"}],
        "event_years": [2026, 2024, 2023, 1850],
    }


# Settings and background ------------------------------------------------------------------


def test_a_pending_background_upload_becomes_the_background(admin: TestClient) -> None:
    image = uploaded(admin, "background")
    response = save(
        admin, background_image_id=image["id"], background_opacity=0.35, default_zoom="months"
    )
    assert response.status_code == 200
    expected = {
        **DEFAULTS,
        "background": image,
        "background_opacity": 0.35,
        "default_zoom": "months",
    }
    assert response.json() == expected
    assert appearance_of(admin) == expected
    row = stored_image(admin, image["id"])
    assert row is not None and row.expires_at is None and row.event_id is None
    assert folder(admin, image["id"]).is_dir()
    assert stored_settings(admin) == {
        "background_image_id": image["id"],
        "background_opacity": 0.35,
        "default_zoom": "months",
        "direction_desktop": "right_to_left",
        "direction_mobile": "bottom_to_top",
    }

    login_as(admin, "viewer")
    assert appearance_of(admin) == expected
    assert admin.get(image["display_url"]).status_code == 200


def test_saving_the_current_background_keeps_it(admin: TestClient) -> None:
    image = uploaded(admin, "background")
    saved(admin, background_image_id=image["id"])
    response = save(
        admin, background_image_id=image["id"], background_opacity=1, default_zoom="years"
    )
    assert response.status_code == 200
    assert response.json() == {
        **DEFAULTS,
        "background": image,
        "background_opacity": 1.0,
        "default_zoom": "years",
    }
    row = stored_image(admin, image["id"])
    assert row is not None and row.expires_at is None
    assert folder(admin, image["id"]).is_dir()


def test_replacing_the_background_deletes_the_previous_image(admin: TestClient) -> None:
    old = uploaded(admin, "background")
    saved(admin, background_image_id=old["id"])
    new = uploaded(admin, "background")
    unrelated = uploaded(admin, "background")
    response = save(admin, background_image_id=new["id"], background_opacity=0.25)
    assert response.status_code == 200
    assert response.json() == {**DEFAULTS, "background": new, "background_opacity": 0.25}
    assert stored_image(admin, old["id"]) is None
    assert not folder(admin, old["id"]).exists()
    row = stored_image(admin, new["id"])
    assert row is not None and row.expires_at is None
    assert folder(admin, new["id"]).is_dir()
    # Other pending uploads are left alone.
    other = stored_image(admin, unrelated["id"])
    assert other is not None and other.expires_at is not None
    assert folder(admin, unrelated["id"]).is_dir()
    assert appearance_of(admin) == response.json()


def test_removing_the_background_deletes_the_image(admin: TestClient) -> None:
    image = uploaded(admin, "background")
    saved(admin, background_image_id=image["id"], default_zoom="months")
    response = save(admin, background_image_id=None, background_opacity=0.5)
    assert response.status_code == 200
    assert response.json() == {**DEFAULTS, "background_opacity": 0.5}
    assert stored_image(admin, image["id"]) is None
    assert not folder(admin, image["id"]).exists()
    assert stored_settings(admin) == {
        "background_image_id": None,
        "background_opacity": 0.5,
        "default_zoom": "events",
        "direction_desktop": "right_to_left",
        "direction_mobile": "bottom_to_top",
    }
    # Nothing left to remove.
    assert saved(admin) == DEFAULTS


def test_an_expired_upload_not_purged_yet_can_still_be_used(admin: TestClient) -> None:
    image_id = add_image(admin, expires_at=utcnow() - timedelta(hours=1))
    response = save(admin, background_image_id=str(image_id))
    assert response.status_code == 200
    assert response.json()["background"] == image_out(image_id)
    row = stored_image(admin, image_id)
    assert row is not None and row.expires_at is None
    # Attached, so later uploads no longer purge it.
    uploaded(admin, "background")
    assert stored_image(admin, image_id) is not None
    assert folder(admin, image_id).is_dir()


@pytest.mark.parametrize(
    "make_image",
    [
        pytest.param(lambda client: uuid.uuid4(), id="unknown"),
        pytest.param(lambda client: add_image(client, "avatar"), id="avatar-upload"),
        pytest.param(lambda client: add_image(client, "event"), id="event-upload"),
        pytest.param(child_avatar, id="child-avatar"),
        pytest.param(event_image, id="event-image"),
        pytest.param(
            lambda client: add_image(client, "background", expires_at=None),
            id="attached-background",
        ),
    ],
)
def test_only_pending_background_uploads_are_accepted(
    admin: TestClient, make_image: Callable[[TestClient], uuid.UUID]
) -> None:
    current = customise(admin)["background"]["id"]
    image_id = make_image(admin)
    before = appearance_of(admin)
    before_row = stored_image(admin, image_id)

    response = save(
        admin, background_image_id=str(image_id), background_opacity=0.9, default_zoom="months"
    )
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_image"}

    assert appearance_of(admin) == before
    after_row = stored_image(admin, image_id)
    assert (after_row is None) == (before_row is None)
    if before_row is not None and after_row is not None:
        assert (after_row.expires_at is None) == (before_row.expires_at is None)
        assert after_row.event_id == before_row.event_id
        assert folder(admin, image_id).is_dir()
    assert folder(admin, current).is_dir()


def test_background_files_are_deleted_only_once_committed(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    old = uploaded(admin, "background")
    expected = saved(admin, background_image_id=old["id"])
    new = uploaded(admin, "background")

    async def failing_commit(self: AsyncSession) -> None:
        raise RuntimeError("database unavailable")

    for image_id in (new["id"], None):
        with monkeypatch.context() as patch:
            patch.setattr(AsyncSession, "commit", failing_commit)
            response = save(admin, background_image_id=image_id, default_zoom="years")
        assert (response.status_code, response.json()) == (500, {"code": "internal_error"})
        assert folder(admin, old["id"]).is_dir()
        old_row, new_row = stored_image(admin, old["id"]), stored_image(admin, new["id"])
        assert old_row is not None and old_row.expires_at is None
        assert new_row is not None and new_row.expires_at is not None
        assert appearance_of(admin) == expected


@pytest.mark.parametrize("value", [0, 0.0, 0.18, 0.5, 1, 1.0])
def test_background_opacity_goes_from_0_to_1(admin: TestClient, value: float) -> None:
    assert saved(admin, background_opacity=value)["background_opacity"] == value
    assert appearance_of(admin)["background_opacity"] == value


@pytest.mark.parametrize("zoom", ["years", "months", "events"])
def test_every_zoom_level_can_be_the_default(admin: TestClient, zoom: str) -> None:
    assert saved(admin, default_zoom=zoom)["default_zoom"] == zoom
    assert appearance_of(admin)["default_zoom"] == zoom
    assert stored_settings(admin)["default_zoom"] == zoom


@pytest.mark.parametrize("device", ["direction_desktop", "direction_mobile"])
@pytest.mark.parametrize("value", DIRECTIONS)
def test_the_timeline_runs_in_any_direction_on_each_device(
    admin: TestClient, device: str, value: str
) -> None:
    other = "direction_mobile" if device == "direction_desktop" else "direction_desktop"
    body = saved(admin, **{device: value})
    assert (body[device], body[other]) == (value, DEFAULTS[other])
    assert stored_settings(admin)[device] == value
    login_as(admin, "viewer")
    assert appearance_of(admin) == body


@pytest.mark.parametrize(
    ("changes", "field", "error"),
    [
        ({"background_opacity": -0.01}, "background_opacity", "greater_than_equal"),
        ({"background_opacity": 1.01}, "background_opacity", "less_than_equal"),
        ({"background_opacity": "much"}, "background_opacity", "float_parsing"),
        ({"background_opacity": None}, "background_opacity", "float_type"),
        ({"default_zoom": "days"}, "default_zoom", "literal_error"),
        ({"default_zoom": "Events"}, "default_zoom", "literal_error"),
        ({"default_zoom": None}, "default_zoom", "literal_error"),
        ({"direction_desktop": "ltr"}, "direction_desktop", "literal_error"),
        ({"direction_desktop": "Left_To_Right"}, "direction_desktop", "literal_error"),
        ({"direction_mobile": None}, "direction_mobile", "literal_error"),
        ({"direction_mobile": "diagonal"}, "direction_mobile", "literal_error"),
        ({"background_image_id": "background"}, "background_image_id", "uuid_parsing"),
        ({"background_image_id": 7}, "background_image_id", "uuid_type"),
        ({"theme": "dark"}, "theme", "extra_forbidden"),
    ],
)
def test_settings_input_is_validated(
    admin: TestClient, changes: dict[str, Any], field: str, error: str
) -> None:
    before = customise(admin)
    response = save(admin, **changes)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {field: error}}
    assert appearance_of(admin) == before


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity", "1e309"])
def test_background_opacity_must_be_finite(admin: TestClient, number: str) -> None:
    before = customise(admin)
    response = admin.put(
        "/api/admin/settings",
        content=(
            '{"background_image_id": null, "background_opacity": %s, "default_zoom": "events", '
            '"direction_desktop": "right_to_left", "direction_mobile": "bottom_to_top"}' % number
        ),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 422
    assert response.json() == {
        "code": "invalid_request",
        "fields": {"background_opacity": "finite_number"},
    }
    assert appearance_of(admin) == before


@pytest.mark.parametrize("missing", list(SETTINGS))
def test_every_setting_must_be_sent(admin: TestClient, missing: str) -> None:
    before = customise(admin)
    body = {key: value for key, value in SETTINGS.items() if key != missing}
    response = admin.put("/api/admin/settings", json=body)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {missing: "missing"}}
    assert appearance_of(admin) == before


def test_settings_responses_carry_the_whole_appearance(admin: TestClient) -> None:
    add_events(admin, "2025-02-03")
    set_color(admin, 2025, "#336699")
    image = uploaded(admin, "background")
    assert saved(admin, background_image_id=image["id"], default_zoom="years") == {
        "year_colors": [{"year": 2025, "color": "#336699"}],
        "event_years": [2025],
        "background": image,
        "background_opacity": 0.18,
        "default_zoom": "years",
        "direction_desktop": "right_to_left",
        "direction_mobile": "bottom_to_top",
    }


# Corrupted settings -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("background_image_id", 123),
        ("background_image_id", True),
        ("background_image_id", "not-a-uuid"),
        ("background_image_id", ["d3b07384-d9a0-4c9b-8a3e-0e5f4b3b5d61"]),
        ("background_image_id", {"id": "d3b07384-d9a0-4c9b-8a3e-0e5f4b3b5d61"}),
        ("background_image_id", "d3b07384-d9a0-4c9b-8a3e-0e5f4b3b5d61"),  # no such image
        ("background_opacity", "0.5"),
        ("background_opacity", -0.5),
        ("background_opacity", 1.5),
        ("background_opacity", True),
        ("background_opacity", None),
        ("background_opacity", [0.5]),
        ("default_zoom", "days"),
        ("default_zoom", "YEARS"),
        ("default_zoom", 3),
        ("default_zoom", None),
        ("default_zoom", ["years"]),
        ("direction_desktop", "rtl"),
        ("direction_desktop", "RIGHT_TO_LEFT"),
        ("direction_desktop", 1),
        ("direction_mobile", None),
        ("direction_mobile", ["bottom_to_top"]),
        ("direction_mobile", "upwards"),
    ],
)
def test_unusable_settings_fall_back_to_their_defaults(
    admin: TestClient, key: str, value: Any
) -> None:
    store(admin, **{key: value})
    assert appearance_of(admin) == DEFAULTS
    login_as(admin, "viewer")
    assert appearance_of(admin) == DEFAULTS
    login_as(admin, "admin")
    # Saving replaces the unusable value.
    image_id = add_image(admin)
    response = save(admin, background_image_id=str(image_id), background_opacity=0.3)
    assert response.json() == {
        **DEFAULTS,
        "background": image_out(image_id),
        "background_opacity": 0.3,
    }


@pytest.mark.parametrize(
    ("make_image", "replaced"),
    [
        pytest.param(child_avatar, False, id="child-avatar"),
        pytest.param(event_image, False, id="event-image"),
        # A background image the setting names, even a pending one, is the one being replaced.
        pytest.param(lambda client: add_image(client), True, id="pending-background"),
    ],
)
def test_a_setting_naming_an_unattached_or_foreign_image_is_ignored(
    admin: TestClient, make_image: Callable[[TestClient], uuid.UUID], replaced: bool
) -> None:
    image_id = make_image(admin)
    store(admin, background_image_id=str(image_id))
    assert appearance_of(admin)["background"] is None

    replacement = add_image(admin)
    response = save(admin, background_image_id=str(replacement))
    assert response.status_code == 200
    assert response.json()["background"] == image_out(replacement)
    assert (stored_image(admin, image_id) is None) == replaced
    assert folder(admin, image_id).exists() != replaced


def test_other_images_named_by_the_setting_survive_a_removal(admin: TestClient) -> None:
    avatar = child_avatar(admin)
    store(admin, background_image_id=str(avatar))
    assert saved(admin) == DEFAULTS
    row = stored_image(admin, avatar)
    assert row is not None and row.purpose == "avatar"
    assert folder(admin, avatar).is_dir()
    # Nor can it be adopted as the background.
    response = save(admin, background_image_id=str(avatar))
    assert (response.status_code, response.json()) == (422, {"code": "invalid_image"})


def test_a_background_deleted_elsewhere_is_ignored(admin: TestClient) -> None:
    image = uploaded(admin, "background")
    saved(admin, background_image_id=image["id"], background_opacity=0.4)

    async def drop(db: AsyncSession) -> None:
        await db.execute(delete(Image).where(Image.id == uuid.UUID(image["id"])))
        await db.commit()

    run_db(admin, drop)
    assert appearance_of(admin) == {**DEFAULTS, "background_opacity": 0.4}
    assert saved(admin, background_opacity=0.4) == {**DEFAULTS, "background_opacity": 0.4}


def test_malformed_json_settings_fall_back_to_their_defaults(
    admin: TestClient, config: Settings
) -> None:
    if not config.database_url.startswith("sqlite"):
        pytest.skip("PostgreSQL json columns only store valid JSON")
    customise(admin)

    async def corrupt(db: AsyncSession) -> None:
        raws = ("not json", "{", '"years', "[", '"left_to_right')
        for key, raw in zip(appearance.SETTING_KEYS, raws, strict=True):
            await db.execute(
                text('UPDATE app_settings SET value = :raw WHERE "key" = :key'),
                {"raw": raw, "key": key},
            )
        await db.commit()

    run_db(admin, corrupt)
    assert appearance_of(admin) == {
        **DEFAULTS,
        "year_colors": [{"year": 2024, "color": "#336699"}],
    }
    image_id = add_image(admin)
    assert saved(admin, background_image_id=str(image_id), default_zoom="months") == {
        **DEFAULTS,
        "year_colors": [{"year": 2024, "color": "#336699"}],
        "background": image_out(image_id),
        "default_zoom": "months",
    }


# Concurrency --------------------------------------------------------------------------------


@pytest.mark.parametrize("existing", [False, True], ids=["first-save", "later-save"])
async def test_settings_saves_take_turns(sessions: Sessions, existing: bool) -> None:
    if existing:
        async with sessions() as db:
            await appearance.store_settings(db, {appearance.BACKGROUND_KEY: None})
            await db.commit()
    image_id = uuid.uuid4()
    async with sessions() as first, sessions() as second:
        assert await appearance.lock_background(first) is None
        waiting = asyncio.create_task(appearance.lock_background(second))
        await asyncio.sleep(0.5)
        assert not waiting.done()
        await appearance.store_settings(first, {appearance.BACKGROUND_KEY: str(image_id)})
        await first.commit()
        assert await asyncio.wait_for(waiting, timeout=10) == image_id
        await second.rollback()


async def test_concurrent_saves_leave_no_orphaned_background(
    sessions: Sessions, config: Settings
) -> None:
    images = [image_row("background") for _ in range(3)]
    async with sessions() as db:
        db.add_all(images)
        await db.commit()
    folders = [add_folder(config.media_dir, image.id) for image in images]
    request: Any = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(settings=config)))
    admin = SessionUser(id=1, email="admin@example.com", name=None, role="admin")

    async def save_with(image: Image) -> None:
        body = SettingsIn(
            background_image_id=image.id,
            background_opacity=0.5,
            default_zoom="events",
            direction_desktop="right_to_left",
            direction_mobile="bottom_to_top",
        )
        async with sessions() as db:
            await appearance.update_settings(body, request, admin, db)

    await asyncio.gather(*(save_with(image) for image in images))

    async with sessions() as db:
        background = (await appearance.appearance_out(db)).background
        remaining = list(await db.scalars(select(Image.id)))
    assert background is not None
    assert remaining == [background.id]
    assert [path.exists() for path in folders] == [image.id == background.id for image in images]
