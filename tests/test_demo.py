"""Demo data (``python -m timelife.demo``): local development only, deterministic, idempotent,
stored through the upload pipeline and saved with the event rules."""

import datetime as dt
import io
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from timelife import demo, media
from timelife.config import Settings
from timelife.db import Child, Event, Image
from timelife.seed import CATEGORIES

from .conftest import run_db
from .helpers_children import add_image
from .helpers_events import (
    add_child,
    admin_event,
    category_ids,
    create_event,
    image_items,
    listed,
    timeline,
)

TODAY = dt.date(2026, 10, 20)
VARIANTS = ("original.jpg", "thumb.webp", "display.webp")


def media_root(client: TestClient) -> Path:
    app: Any = client.app
    root: Path = app.state.settings.media_dir
    return root


def counts(client: TestClient) -> tuple[int, int, int]:
    """Children, events and images in the database."""

    async def count(db: AsyncSession) -> tuple[int, int, int]:
        return (
            await db.scalar(select(func.count()).select_from(Child)) or 0,
            await db.scalar(select(func.count()).select_from(Event)) or 0,
            await db.scalar(select(func.count()).select_from(Image)) or 0,
        )

    return run_db(client, count)


def folders(client: TestClient) -> set[str]:
    root = media_root(client)
    return {path.name for path in root.iterdir()} if root.exists() else set()


def load(client: TestClient, **options: Any) -> demo.Summary:
    """``demo.load`` on the app's database with tiny pictures."""
    root = media_root(client)

    async def run(db: AsyncSession) -> demo.Summary:
        return await demo.load(db, root, scale=0.08, **options)

    return run_db(client, run)


def sample() -> list[demo.PlannedEvent]:
    """The first planned event, a same-day pair, a shared event and one without photos."""
    planned = demo.plan()
    dates = Counter(item.milestone.date for item in planned)
    pair = [item for item in planned if dates[item.milestone.date] > 1][:2]
    shared = next(item for item in planned if len(item.milestone.children) == 2)
    bare = next(item for item in planned if not item.photos)
    picked = [planned[0], *pair, shared, bare]
    assert len({id(item) for item in picked}) == 5
    return picked


def rgb(value: str) -> tuple[int, int, int]:
    return (int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16))


# The plan ------------------------------------------------------------------------------------


def test_the_plan_tells_the_whole_story() -> None:
    planned = demo.plan()
    births = {child.slug: child.birth_date for child in demo.CHILDREN}
    assert [child.name for child in demo.CHILDREN] == ["Lucía", "Mateo"]
    assert births == {"lucia": dt.date(2024, 3, 10), "mateo": dt.date(2025, 9, 18)}
    assert 75 <= len(planned) <= 90
    dates = [item.milestone.date for item in planned]
    assert dates == sorted(dates)
    assert dates[0] == dt.date(2024, 3, 10) and dt.date(2026, 10, 1) <= dates[-1] <= TODAY
    # Uneven: busy first months, quieter later on.
    per_year = Counter(date.year for date in dates)
    assert per_year[2024] > 15 and per_year[2025] > per_year[2024]

    keys = {category.key for category in CATEGORIES}
    used: set[str] = set()
    for item in planned:
        milestone = item.milestone
        assert 1 <= len(milestone.categories) <= 3, milestone.title
        assert len(set(milestone.categories)) == len(milestone.categories)
        used.update(milestone.categories)
        assert milestone.children and set(milestone.children) <= set(births)
        assert all(milestone.date >= births[slug] for slug in milestone.children)
        assert 1 <= len(milestone.title) <= 120 and len(milestone.notes) <= 5000
        assert milestone.location is None or len(milestone.location) <= 200
        assert 0 <= len(item.photos) <= 6
        names = [photo.name for photo in item.photos]
        assert len(set(names)) == len(names) and all(0 < len(name) <= 160 for name in names)
        assert item.cover == 0 or 0 < item.cover < len(item.photos)
        assert item.recorded.tzinfo is not None
        assert item.recorded.date() >= milestone.date - dt.timedelta(days=1)
    assert used == keys

    without_photos = sum(1 for item in planned if not item.photos) / len(planned)
    assert 0.1 <= without_photos <= 0.2
    shared = [item for item in planned if len(item.milestone.children) == 2]
    assert len(shared) >= 4
    assert "Primer encuentro entre hermanos" in [item.milestone.title for item in shared]
    assert sum(1 for count in Counter(dates).values() if count > 1) >= 3
    assert sum(1 for item in planned if item.milestone.location) >= 10
    assert sum(1 for item in planned if item.milestone.notes) >= len(planned) // 2
    sizes = {photo.size for item in planned for photo in item.photos}
    assert any(width > height for width, height in sizes)
    assert any(width < height for width, height in sizes)
    assert any(width == height for width, height in sizes)
    assert len({photo.scene for item in planned for photo in item.photos}) == len(demo.PAINTERS)
    assert demo.plan() == planned


def test_spread_picks_milestones_over_the_whole_period() -> None:
    planned = demo.plan()
    assert demo.spread(planned, None) == planned
    assert demo.spread(planned, 1000) == planned
    picked = demo.spread(planned, 5)
    assert len(picked) == 5
    assert (picked[0], picked[-1]) == (planned[0], planned[-1])
    assert demo.spread(planned, 1) == [planned[0]]


def test_photos_are_deterministic_and_varied() -> None:
    photos = [photo for item in demo.plan() for photo in item.photos][::5][:30]
    colours = []
    for photo in photos:
        data = demo.render_photo(photo, 0.05)
        assert data == demo.render_photo(photo, 0.05)
        processed = media.process_upload(io.BytesIO(data), 10_000_000)
        assert (processed.extension, processed.content_type) == ("jpg", "image/jpeg")
        width, height = photo.size
        assert (processed.width > processed.height) == (width > height)
        colours.append(processed.dominant_color)
    # Clearly different dominant colours, not 30 shades of one.
    assert len({tuple(channel // 32 for channel in rgb(colour)) for colour in colours}) >= 10
    for child in demo.CHILDREN:
        assert demo.render_avatar(child, 0.1) == demo.render_avatar(child, 0.1)


# Loading -----------------------------------------------------------------------------------


def test_demo_data_goes_through_the_upload_pipeline_and_event_rules(admin: TestClient) -> None:
    planned = sample()
    summary = load(admin, events=planned)
    photos = sum(len(item.photos) for item in planned)
    assert summary == demo.Summary(loaded=True, children=2, events=len(planned), images=photos)
    assert counts(admin) == (2, len(planned), photos + 2)

    children = admin.get("/api/children").json()
    assert [(child["name"], child["slug"], child["birth_date"]) for child in children] == [
        ("Lucía", "lucia", "2024-03-10"),
        ("Mateo", "mateo", "2025-09-18"),
    ]
    for child in children:
        assert child["avatar"]["name"] == child["name"]
        assert admin.get(child["avatar"]["thumb_url"]).status_code == 200
        assert all((media_root(admin) / child["avatar"]["id"] / name).is_file() for name in VARIANTS)
    ids = {child["slug"]: child["id"] for child in children}
    categories = category_ids(admin)

    items = {(item["title"], item["date"]): item for item in listed(admin)["items"]}
    assert len(items) == len(planned)
    for plan_item in planned:
        milestone = plan_item.milestone
        event = admin_event(admin, items[milestone.title, milestone.date.isoformat()]["id"])
        assert event["notes"] == milestone.notes
        assert event["location"] == milestone.location
        assert event["child_ids"] == sorted(ids[slug] for slug in milestone.children)
        assert event["category_ids"] == [categories[key] for key in milestone.categories]
        assert [image["name"] for image in event["images"]] == [
            photo.name for photo in plan_item.photos
        ]
        cover = event["images"][plan_item.cover]["id"] if event["images"] else None
        assert event["cover_image_id"] == cover
        for image, photo in zip(event["images"], plan_item.photos, strict=True):
            width, height = photo.size
            assert (image["width"] > image["height"], image["width"] == image["height"]) == (
                width > height,
                width == height,
            )
            response = admin.get(image["display_url"])
            assert (response.status_code, response.headers["content-type"]) == (200, "image/webp")
            assert all((media_root(admin) / image["id"] / name).is_file() for name in VARIANTS)
        assert event["created_at"] == event["updated_at"]

    lucia, mateo = timeline(admin, ids["lucia"]), timeline(admin, ids["mateo"])
    assert lucia["total"] == sum("lucia" in item.milestone.children for item in planned)
    assert mateo["total"] == sum("mateo" in item.milestone.children for item in planned)
    shared = {item["id"] for item in lucia["events"]} & {item["id"] for item in mateo["events"]}
    assert len(shared) == sum(len(item.milestone.children) == 2 for item in planned)

    async def image_rows(db: AsyncSession) -> list[Image]:
        return list(await db.scalars(select(Image)))

    for row in run_db(admin, image_rows):
        assert row.expires_at is None
        assert row.original_filename == f"{row.name}.jpg"
        assert (row.original_ext, row.content_type) == ("jpg", "image/jpeg")


def test_loading_is_idempotent_and_reset_replaces_everything(admin: TestClient) -> None:
    planned = sample()
    assert load(admin, events=planned[:2]).loaded
    before = counts(admin), folders(admin)
    assert load(admin, events=planned) == demo.Summary(loaded=False)
    assert (counts(admin), folders(admin)) == before

    # The developer's own child and event, and a pending upload.
    ana = add_child(admin, "Ana")
    own = str(add_image(admin, purpose="event", name="propia"))
    create_event(admin, [ana], [category_ids(admin)["general"]], images=image_items([own]))
    pending = str(add_image(admin, purpose="event"))
    old = folders(admin) - {pending}

    summary = load(admin, events=planned[2:], reset=True)
    assert summary.loaded
    assert (summary.deleted_events, summary.deleted_children, summary.events) == (3, 3, 3)
    assert not old & folders(admin)
    # A pending upload is no demo data: it stays (and expires as usual).
    assert pending in folders(admin)
    assert [child["name"] for child in admin.get("/api/children").json()] == ["Lucía", "Mateo"]
    assert listed(admin)["total"] == 3


def test_a_failed_load_leaves_nothing_behind(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = 0
    real = demo.insert_event

    async def failing(*args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("disk full")
        return await real(*args, **kwargs)

    monkeypatch.setattr(demo, "insert_event", failing)
    with pytest.raises(RuntimeError, match="disk full"):
        load(admin, events=sample())
    assert counts(admin) == (0, 0, 0)
    assert folders(admin) == set()


def test_existing_children_stay(admin: TestClient) -> None:
    add_child(admin, "Ana")
    assert load(admin, events=sample()[:1]).children == 2
    assert [child["slug"] for child in admin.get("/api/children").json()] == [
        "ana",
        "lucia",
        "mateo",
    ]


# Command line ------------------------------------------------------------------------------


def command(config: Settings, tmp_path: Path, *args: str, **env: str) -> subprocess.CompletedProcess[str]:
    """``python -m timelife.demo`` as a developer runs it, outside the repository (no ``.env``)
    and on the test database."""
    environment = {
        name: value
        for name, value in os.environ.items()
        if name.lower() not in Settings.model_fields
    }
    environment.update(
        DATABASE_URL=config.database_url,
        AUTH_SECRET=config.auth_secret.get_secret_value(),
        PUBLIC_ORIGIN="http://localhost:7779",
        AUTH_COOKIE_SECURE="false",
        MEDIA_DIR=str(config.media_dir),
        PYTHONIOENCODING="utf-8",
        **env,
    )
    return subprocess.run(
        [sys.executable, "-m", "timelife.demo", *args],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        encoding="utf-8",
        timeout=300,
    )


@pytest.mark.parametrize("flag", [None, "false"])
def test_the_command_refuses_outside_local_development(
    admin: TestClient, config: Settings, tmp_path: Path, flag: str | None
) -> None:
    result = command(config, tmp_path, **({} if flag is None else {"ALLOW_INSECURE_LOCAL_LOGIN": flag}))
    assert result.returncode == 1
    assert "local development" in result.stderr
    assert result.stdout == ""
    assert counts(admin) == (0, 0, 0)


def test_the_command_loads_once_and_reloads_with_reset(
    admin: TestClient, config: Settings, tmp_path: Path
) -> None:
    result = command(config, tmp_path, "--events", "3", ALLOW_INSECURE_LOCAL_LOGIN="true")
    assert result.returncode == 0, result.stderr
    assert "demo data loaded: 2 children, 3 events" in result.stdout
    loaded = counts(admin)
    assert loaded[:2] == (2, 3)
    titles = sorted(item["title"] for item in listed(admin)["items"])
    assert titles == sorted(item.milestone.title for item in demo.spread(demo.plan(), 3))

    again = command(config, tmp_path, ALLOW_INSECURE_LOCAL_LOGIN="true")
    assert again.returncode == 0, again.stderr
    assert "already loaded" in again.stdout
    assert counts(admin) == loaded

    reset = command(config, tmp_path, "--reset", "--events", "2", ALLOW_INSECURE_LOCAL_LOGIN="true")
    assert reset.returncode == 0, reset.stderr
    assert "after deleting 3 events and 2 children" in reset.stdout
    assert counts(admin)[:2] == (2, 2)
    assert listed(admin)["total"] == 2


def test_the_command_validates_its_arguments(config: Settings, tmp_path: Path) -> None:
    result = command(config, tmp_path, "--events", "0", ALLOW_INSECURE_LOCAL_LOGIN="true")
    assert result.returncode == 2
    assert "--events" in result.stderr
