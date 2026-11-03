"""Import of a backup: the upload sessions (``/api/admin/backup/imports``) and both import modes
("merge" and "replace"), with their failures, cancellation and restarts."""

import asyncio
import datetime as dt
import io
import json
import os
import time
import uuid
import zipfile
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image as Pillow
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from timelife import backup_import, media, middleware
from timelife.config import Settings
from timelife.db import Image, User
from timelife.passwords import hash_password_now
from timelife.seed import CATEGORIES, seed_categories

from .conftest import app_client, login_as, run_db
from .helpers_backup import (
    IMPORTS,
    counts,
    export_bytes,
    library,
    make_archive,
    manifest_of,
    run_import,
    start_import,
    state,
    upload_archive,
)
from .helpers_events import add_child, category_ids, create_event, listed_titles, trash
from .helpers_media import clip, image_bytes, requires_ffmpeg, upload, uploaded, wait_for_videos


def put(client: TestClient, session: dict[str, Any], offset: int, data: bytes) -> Any:
    return client.put(
        f"{IMPORTS}/{session['id']}/content",
        params={"offset": offset},
        content=data,
        headers={"content-type": "application/octet-stream"},
    )


def create(client: TestClient, size: int, **extra: Any) -> Any:
    return client.post(IMPORTS, json={"filename": "copia.zip", "size": size, **extra})


def image_folders(config: Settings) -> set[str]:
    return {path.name for path in config.media_dir.iterdir() if not path.name.startswith(".")}


def image_rows(client: TestClient, *, pending: bool = False) -> int:
    async def count(db: AsyncSession) -> int:
        query = select(func.count()).select_from(Image)
        if pending:
            query = query.where(Image.expires_at.is_not(None))
        return await db.scalar(query) or 0

    return run_db(client, count)


def rebuild(
    data: bytes, *, drop: frozenset[str] = frozenset(), replace: dict[str, bytes] | None = None
) -> bytes:
    """``data`` (an archive) without the files ``drop`` and with ``replace``d contents."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(buffer, "w") as target:
        for info in source.infolist():
            if info.filename not in drop:
                content = (replace or {}).get(info.filename) or source.read(info)
                target.writestr(info.filename, content)
    return buffer.getvalue()


# Sessions -----------------------------------------------------------------------------------


def test_a_backup_is_uploaded_in_pieces_then_checked(admin: TestClient) -> None:
    library(admin)
    data = export_bytes(admin)
    created = create(admin, len(data), last_modified=1700000000000)
    assert created.status_code == 201, created.text
    session = created.json()
    assert {key: session[key] for key in ("status", "filename", "size", "received")} == {
        "status": "uploading",
        "filename": "copia.zip",
        "size": len(data),
        "received": 0,
    }
    assert (session["chunk_size"], session["last_modified"]) == (32 * 1024 * 1024, 1700000000000)
    assert admin.get(IMPORTS).json() == [session]
    assert admin.delete(f"{IMPORTS}/{session['id']}").status_code == 204
    ready = upload_archive(admin, data, chunk=1000)
    assert ready["status"] == "ready" and ready["received"] == len(data) and ready["error"] is None
    archive = ready["archive"]
    assert (archive["app_version"], archive["missing_files"]) == ("test", 0)
    summary = archive["summary"]
    assert (summary["events"], summary["trashed_events"], summary["photos"]) == (2, 1, 3)
    assert (summary["children"], summary["users"], summary["admins"]) == (2, 2, 1)
    assert summary["background"] is True and summary["media_bytes"] > 0


def test_pieces_must_follow_what_arrived(admin: TestClient) -> None:
    session = create(admin, 300).json()
    response = put(admin, session, 10, b"x" * 10)
    assert (response.status_code, response.json()) == (
        409,
        {"code": "import_offset_mismatch", "detail": {"received": 0}},
    )
    assert put(admin, session, 0, b"x" * 100).json()["received"] == 100
    # A piece sent twice (its answer was lost): resume from what arrived.
    response = put(admin, session, 0, b"x" * 100)
    assert response.json() == {"code": "import_offset_mismatch", "detail": {"received": 100}}
    assert put(admin, session, 100, b"x" * 201).json() == {"code": "import_size_mismatch"}
    assert put(admin, session, 100, b"").json() == {"code": "import_size_mismatch"}
    finished = put(admin, session, 100, b"x" * 200).json()
    assert (finished["status"], finished["error"]) == ("invalid", "invalid_import")
    response = put(admin, session, 300, b"x")
    assert (response.status_code, response.json()) == (409, {"code": "import_not_uploading"})


def test_one_session_at_a_time(admin: TestClient) -> None:
    session = create(admin, 100).json()
    response = create(admin, 100)
    assert (response.status_code, response.json()) == (
        409,
        {"code": "import_busy", "detail": {"id": session["id"]}},
    )
    assert admin.delete(f"{IMPORTS}/{session['id']}").status_code == 204
    response = admin.get(f"{IMPORTS}/{session['id']}")
    assert (response.status_code, response.json()) == (404, {"code": "import_not_found"})
    assert admin.get(IMPORTS).json() == []
    assert create(admin, 100).status_code == 201


def test_malformed_ids_and_bodies_are_refused(admin: TestClient) -> None:
    assert admin.get(f"{IMPORTS}/not-an-id").json()["code"] == "invalid_request"
    assert admin.get(f"{IMPORTS}/{'0' * 32}").json() == {"code": "import_not_found"}
    for body in ({"filename": "x.zip", "size": 0}, {"filename": "", "size": 10}, {"size": 10}):
        assert admin.post(IMPORTS, json=body).json()["code"] == "invalid_request"
    session = create(admin, 10).json()
    response = admin.put(f"{IMPORTS}/{session['id']}/content", content=b"x")
    assert response.json()["fields"] == {"offset": "missing"}
    start = admin.post(f"{IMPORTS}/{session['id']}/start", json={"mode": "everything"})
    assert start.json()["code"] == "invalid_request"


def test_pieces_above_the_limit_are_refused(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(middleware, "IMPORT_CHUNK_BYTES", 1024)
    session = create(admin, 5000).json()
    response = put(admin, session, 0, b"x" * 2048)
    assert (response.status_code, response.json()) == (413, {"code": "request_too_large"})
    assert put(admin, session, 0, b"x" * 1024).json()["received"] == 1024


def test_an_import_needs_room_on_disk(admin: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(backup_import, "free_space", lambda path: 1000)
    response = create(admin, 100)
    assert response.status_code == 507
    assert response.json() == {
        "code": "import_no_space",
        "detail": {"required": 200 + backup_import.SPACE_RESERVE, "available": 1000},
    }
    assert admin.get(IMPORTS).json() == []


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"PK\x03\x04 not really a zip file", "invalid_import"),
        (b"hello", "invalid_import"),
        (make_archive(None, raw=b"{not json"), "invalid_import"),
        (make_archive({"format": "timelife-backup", "version": 1}), "invalid_import"),
        (make_archive({"format": "other", "version": 1}), "invalid_import"),
        (make_archive({"format": "timelife-backup", "version": 9}), "import_version_unsupported"),
    ],
)
def test_invalid_files_cannot_be_imported(admin: TestClient, data: bytes, code: str) -> None:
    session = upload_archive(admin, data)
    assert (session["status"], session["error"], session["archive"]) == ("invalid", code, None)
    response = admin.post(f"{IMPORTS}/{session['id']}/start", json={"mode": "merge"})
    assert (response.status_code, response.json()) == (409, {"code": "import_not_ready"})
    assert admin.delete(f"{IMPORTS}/{session['id']}").status_code == 204


def test_imports_need_an_administrator(client: TestClient, viewer: TestClient) -> None:
    session_id = "0" * 32
    requests = [
        ("GET", IMPORTS, None),
        ("POST", IMPORTS, {"filename": "x.zip", "size": 10}),
        ("GET", f"{IMPORTS}/{session_id}", None),
        ("POST", f"{IMPORTS}/{session_id}/start", {"mode": "merge"}),
        ("POST", f"{IMPORTS}/{session_id}/cancel", None),
        ("DELETE", f"{IMPORTS}/{session_id}", None),
    ]
    for method, path, body in requests:
        assert viewer.request(method, path, json=body).json() == {"code": "admin_required"}
    response = viewer.put(f"{IMPORTS}/{session_id}/content?offset=0", content=b"x")
    assert response.json() == {"code": "admin_required"}
    client.cookies.clear()
    for method, path, body in requests:
        response = client.request(method, path, json=body)
        assert response.json() == {"code": "authentication_required"}


def test_writes_need_the_same_origin(admin: TestClient) -> None:
    response = admin.post(
        IMPORTS, json={"filename": "x.zip", "size": 10}, headers={"x-timelife-request": "0"}
    )
    assert (response.status_code, response.json()) == (403, {"code": "invalid_origin"})


def test_runs_cannot_be_cancelled_or_discarded_out_of_turn(admin: TestClient) -> None:
    session = create(admin, 10).json()
    response = admin.post(f"{IMPORTS}/{session['id']}/cancel")
    assert (response.status_code, response.json()) == (409, {"code": "import_not_running"})
    app: Any = admin.app
    app.state.backups.state.status = "running"
    response = admin.delete(f"{IMPORTS}/{session['id']}")
    assert (response.status_code, response.json()) == (409, {"code": "import_running"})
    app.state.backups.state.status = "uploading"
    assert admin.delete(f"{IMPORTS}/{session['id']}").status_code == 204


# Replace ------------------------------------------------------------------------------------


def test_replace_restores_exactly_what_was_exported(
    admin: TestClient, config: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    created = library(admin)
    before = state(admin)
    data = export_bytes(admin)
    old_folders = image_folders(config)
    # Changes made after the export: all gone after the import.
    extra_child = add_child(admin, "Marta")
    create_event(admin, [extra_child], [category_ids(admin)["general"]], title="Después")
    otro = {"email": "otro@example.com", "password": "otro-temporal"}
    assert admin.post("/api/admin/users", json=otro).status_code == 201
    assert admin.delete(f"/api/admin/events/{created['events'][1]}").status_code == 204
    lucia, pablo = created["children"]
    assert admin.delete(f"/api/admin/children/{lucia}/color").status_code == 200
    colour = {"color": "#00ff00"}
    assert admin.put(f"/api/admin/children/{pablo}/color", json=colour).status_code == 200
    # The folders of a whole library are removed in worker threads, never by the after-commit
    # hook, which runs on the event loop.
    hooked: list[int] = []
    register = media.remove_after_commit

    def spy(session: Any, media_dir: Any, ids: Any) -> None:
        hooked.append(len(ids))
        register(session, media_dir, ids)

    monkeypatch.setattr(media, "remove_after_commit", spy)
    session = run_import(admin, data, "replace")
    monkeypatch.undo()
    assert hooked == []
    assert session["status"] == "finished", session
    assert session["mode"] == "replace" and session["error"] is None
    report = session["report"]
    assert report["issues"] == [] and report["more_issues"] == 0
    assert counts(report, "events") == (3, 0, 0)
    assert counts(report, "children") == (2, 0, 0)
    assert counts(report, "categories") == (12, 0, 0)
    # The importing administrator is kept as is.
    assert counts(report, "users") == (1, 1, 0)
    assert counts(report, "media") == (5, 0, 0)
    assert counts(report, "year_colors") == (1, 0, 0)
    assert state(admin) == before
    # The children's line colours and the categories' Portuguese names too.
    assert [child["color"] for child in before["children"]] == ["#aa3366", None]
    assert "Viagens" in [category["name_pt"] for category in before["categories"]]
    # Same ids (links keep working), new image folders, old ones removed, the archive deleted.
    walk = admin.get(f"/api/admin/events/{created['events'][0]}").json()
    assert walk["title"] == "Primeros pasos"
    folders = image_folders(config)
    assert len(folders) == 5 and not folders & old_folders
    assert image_rows(admin) == 5 and image_rows(admin, pending=True) == 0
    journals = config.media_dir / ".imports" / session["id"]
    assert sorted(path.name for path in journals.iterdir()) == ["state.json"]
    # The importing administrator is still signed in.
    assert admin.get("/api/auth/session").json()["authenticated"] is True


def test_replace_keeps_the_importing_administrator_and_their_password(admin: TestClient) -> None:
    library(admin)
    data = export_bytes(admin)

    async def give_password(db: AsyncSession) -> None:
        user = await db.scalar(select(User).where(User.email == "nueva@example.com"))
        assert user is not None
        user.password_hash = hash_password_now("contraseña-de-nueva")
        await db.commit()

    # Signed in as an administrator the backup does not know.
    login_as(admin, email="nueva@example.com", name="Nueva")
    run_db(admin, give_password)
    session = run_import(admin, data, "replace")
    assert session["status"] == "finished", session
    users = {user["email"]: user for user in admin.get("/api/admin/users").json()}
    assert set(users) == {"admin@example.com", "abuela@example.com", "nueva@example.com"}
    assert users["nueva@example.com"]["role"] == "admin"
    assert users["nueva@example.com"]["has_password"] is True
    # Passwords are not part of a backup: the others need a new one (or Google).
    assert users["abuela@example.com"]["has_password"] is False
    assert admin.get("/api/auth/session").json()["user"]["email"] == "nueva@example.com"


def test_replace_does_not_bring_deleted_default_categories_back(admin: TestClient) -> None:
    general = category_ids(admin)["general"]
    assert admin.delete(f"/api/admin/categories/{general}").status_code == 204
    data = export_bytes(admin)
    assert run_import(admin, data, "replace")["status"] == "finished"

    async def reseed(db: AsyncSession) -> int:
        return await seed_categories(db)

    assert run_db(admin, reseed) == 0
    assert "general" not in category_ids(admin)


def reset_id_generators(client: TestClient) -> None:
    """Start the ids of categories, children and events at 1 again, as on a new server."""

    async def reset(db: AsyncSession) -> None:
        if db.get_bind().dialect.name == "postgresql":
            for table in ("categories", "children", "events"):
                await db.execute(text(f"ALTER SEQUENCE {table}_id_seq RESTART WITH 1"))
        else:
            await db.execute(text("DELETE FROM sqlite_sequence"))
        await db.commit()

    run_db(client, reset)


def test_new_rows_after_a_replace_get_new_ids(admin: TestClient) -> None:
    created = library(admin)
    data = export_bytes(admin)
    reset_id_generators(admin)
    assert run_import(admin, data, "replace")["status"] == "finished"
    child = add_child(admin, "Marta")
    assert child > max(created["children"])
    event = create_event(admin, [child], [category_ids(admin)["general"]], title="Nuevo")
    assert event["id"] > max([*created["events"], created["trashed"]])
    category = admin.post(
        "/api/admin/categories",
        json={
            "name_es": "Otra",
            "name_en": "Other",
            "name_pt": "Outra",
            "icon": "star",
            "color": "#000000",
        },
    )
    assert category.status_code == 201 and category.json()["id"] > created["category"]


# Merge --------------------------------------------------------------------------------------


def test_merge_adds_only_what_is_missing(admin: TestClient) -> None:
    created = library(admin)
    data = export_bytes(admin)
    tooth = created["events"][1]
    assert admin.delete(f"/api/admin/events/{tooth}").status_code == 204
    assert admin.delete(f"/api/admin/trash/{tooth}").status_code == 204
    users = admin.get("/api/admin/users").json()
    grandma = next(user for user in users if user["role"] == "viewer")
    assert admin.delete(f"/api/admin/users/{grandma['id']}").status_code == 204
    assert admin.delete("/api/admin/year-colors/2025").status_code == 200
    sleep = category_ids(admin)["sleep"]
    later = create_event(admin, [created["children"][1]], [sleep], title="Gatea")
    session = run_import(admin, data, "merge")
    assert session["status"] == "finished", session
    report = session["report"]
    assert counts(report, "events") == (1, 2, 0)
    assert counts(report, "users") == (1, 1, 0)
    assert counts(report, "children") == (0, 2, 0)
    assert counts(report, "categories") == (0, 12, 0)
    assert counts(report, "media") == (1, 4, 0)
    assert counts(report, "year_colors") == (1, 0, 0)
    titles = listed_titles(admin)
    assert sorted(titles) == ["Gatea", "Primer diente", "Primeros pasos"]
    restored = admin.get("/api/admin/events", params={"q": "diente"}).json()["items"][0]
    assert restored["id"] not in {tooth, later["id"]} and restored["image_count"] == 1
    assert [item["title"] for item in trash(admin)] == ["Duerme solo"]
    emails = [user["email"] for user in admin.get("/api/admin/users").json()]
    assert "abuela@example.com" in emails
    colours = admin.get("/api/appearance").json()["year_colors"]
    assert colours == [{"year": 2025, "color": "#aa5500"}]
    # Importing it again finds everything.
    again = run_import(admin, data, "merge")["report"]
    assert counts(again, "events") == (0, 3, 0) and counts(again, "media") == (0, 5, 0)


def test_merge_recognises_what_already_exists(admin: TestClient) -> None:
    created = library(admin)
    data = export_bytes(admin)
    walk = admin.get(f"/api/admin/events/{created['events'][0]}").json()
    renamed = {
        "title": "PRIMEROS PASÓS",
        "date": walk["date"],
        "child_ids": walk["child_ids"],
        "category_ids": walk["category_ids"],
        "images": [{"id": image["id"], "name": image["name"]} for image in walk["images"]],
        "version": walk["version"],
    }
    assert admin.put(f"/api/admin/events/{walk['id']}", json=renamed).status_code == 200
    trip = {
        "name_es": "VIAJES",
        "name_en": "Journeys",
        "name_pt": "Passeios",
        "icon": "plane",
        "color": "#123456",
    }
    assert admin.put(f"/api/admin/categories/{created['category']}", json=trip).status_code == 200
    before = state(admin)
    report = run_import(admin, data, "merge")["report"]
    assert counts(report, "events") == (0, 3, 0)
    assert counts(report, "categories") == (0, 12, 0)
    assert state(admin) == before


def test_the_same_title_for_other_children_is_another_milestone(admin: TestClient) -> None:
    created = library(admin)
    data = export_bytes(admin)
    walk = admin.get(f"/api/admin/events/{created['events'][0]}").json()
    only_lucia = {
        "title": walk["title"],
        "date": walk["date"],
        "child_ids": [created["children"][0]],
        "category_ids": walk["category_ids"],
        "images": [],
        "version": walk["version"],
    }
    assert admin.put(f"/api/admin/events/{walk['id']}", json=only_lucia).status_code == 200
    report = run_import(admin, data, "merge")["report"]
    assert counts(report, "events") == (1, 2, 0)
    assert listed_titles(admin).count("Primeros pasos") == 2


def test_merge_never_changes_settings_or_colours(admin: TestClient) -> None:
    created = library(admin)
    data = export_bytes(admin)
    assert admin.put("/api/admin/year-colors/2025", json={"color": "#000000"}).status_code == 200
    # Children's line colours changed after the export: reset and chosen.
    lucia, pablo = created["children"]
    assert admin.delete(f"/api/admin/children/{lucia}/color").status_code == 200
    colour = {"color": "#00ff00"}
    assert admin.put(f"/api/admin/children/{pablo}/color", json=colour).status_code == 200
    current = admin.get("/api/appearance").json()
    changed = {
        "background_image_id": current["background"]["id"],
        "background_opacity": 0.9,
        "default_zoom": "years",
        "direction_desktop": "right_to_left",
        "direction_mobile": "bottom_to_top",
    }
    assert admin.put("/api/admin/settings", json=changed).status_code == 200
    before = admin.get("/api/appearance").json()
    children = admin.get("/api/children").json()
    assert [child["color"] for child in children] == [None, "#00ff00"]
    report = run_import(admin, data, "merge")["report"]
    assert counts(report, "year_colors") == (0, 1, 0)
    assert counts(report, "children") == (0, 2, 0)
    assert admin.get("/api/appearance").json() == before
    assert admin.get("/api/children").json() == children


def test_merged_milestones_go_first_of_their_day(admin: TestClient) -> None:
    created = library(admin)
    data = export_bytes(admin)
    tooth = created["events"][1]
    assert admin.delete(f"/api/admin/events/{tooth}").status_code == 204
    assert admin.delete(f"/api/admin/trash/{tooth}").status_code == 204
    create_event(admin, created["children"], [category_ids(admin)["feeding"]], title="Merienda")
    assert listed_titles(admin) == ["Merienda", "Primeros pasos"]
    run_import(admin, data, "merge")
    assert listed_titles(admin) == ["Primer diente", "Merienda", "Primeros pasos"]


def test_merge_into_an_emptied_timeline(admin: TestClient) -> None:
    created = library(admin)
    data = export_bytes(admin)
    before = state(admin)
    for event_id in [*created["events"], created["trashed"]]:
        admin.delete(f"/api/admin/events/{event_id}")
        assert admin.delete(f"/api/admin/trash/{event_id}").status_code == 204
    for child_id in created["children"]:
        assert admin.delete(f"/api/admin/children/{child_id}").status_code == 204
    assert admin.delete(f"/api/admin/categories/{created['category']}").status_code == 204
    keys = ("background_opacity", "default_zoom", "direction_desktop", "direction_mobile")
    settings = {key: before["appearance"][key] for key in keys}
    response = admin.put("/api/admin/settings", json={**settings, "background_image_id": None})
    assert response.status_code == 200
    session = run_import(admin, data, "merge")
    report = session["report"]
    assert counts(report, "events") == (3, 0, 0)
    assert counts(report, "children") == (2, 0, 0)
    assert counts(report, "categories") == (1, 11, 0)
    assert counts(report, "media") == (5, 0, 0)
    after = state(admin)
    assert [child["slug"] for child in after["children"]] == ["lucia", "pablo"]
    # The children it creates get their line colours back.
    assert [child["color"] for child in after["children"]] == ["#aa3366", None]
    assert after["children"][0]["avatar"] == before["children"][0]["avatar"]
    # The category it creates again, with a new id: Portuguese name included.
    trip = {**before["categories"][-1], "id": after["categories"][-1]["id"]}
    assert trip["name_pt"] == "Viagens"
    assert after["categories"] == [*before["categories"][:-1], trip]
    assert after["appearance"]["background"] == before["appearance"]["background"]
    assert after["trash"][0]["title"] == "Duerme solo"

    def logical(event: dict[str, Any]) -> tuple[Any, ...]:
        return (event["title"], event["date"], event["notes"], event["location"], event["images"])

    assert sorted(map(logical, after["events"])) == sorted(map(logical, before["events"]))


# Copies made by older versions ----------------------------------------------------------------


def version_1(data: bytes) -> bytes:
    """``data`` (an archive) as made before children's line colours and the categories'
    Portuguese names existed (format 1)."""
    manifest = manifest_of(data)
    manifest["version"] = 1
    for category in manifest["categories"]:
        del category["name_pt"]
    for child in manifest["children"]:
        del child["color"]
    return rebuild(data, replace={"manifest.json": json.dumps(manifest).encode()})


def portuguese_names(client: TestClient) -> dict[str, str]:
    """The Portuguese name of every category, by key (by Spanish name for the others)."""
    return {
        category["key"] or category["name_es"]: category["name_pt"]
        for category in client.get("/api/categories").json()
    }


def test_version_1_backups_still_import(admin: TestClient) -> None:
    library(admin)
    # A default category renamed in Spanish, and a new one called like a default one.
    sleep = category_ids(admin)["sleep"]
    renamed = {
        "name_es": "Dormir",
        "name_en": "Sleep",
        "name_pt": "Sono",
        "icon": "moon",
        "color": "#8b5cf6",
    }
    assert admin.put(f"/api/admin/categories/{sleep}", json=renamed).status_code == 200
    naps = {
        "name_es": "Sueño",
        "name_en": "Naps",
        "name_pt": "Sestas",
        "icon": "bed",
        "color": "#000000",
    }
    assert admin.post("/api/admin/categories", json=naps).status_code == 201
    data = version_1(export_bytes(admin))
    assert manifest_of(data)["version"] == 1

    # Merge: a default category it creates again gets its translation; children keep theirs.
    feeding = category_ids(admin)["feeding"]
    assert admin.delete(f"/api/admin/categories/{feeding}").status_code == 204
    session = run_import(admin, data, "merge")
    assert session["status"] == "finished", session
    assert counts(session["report"], "categories") == (1, 12, 0)
    assert portuguese_names(admin)["feeding"] == "Alimentação"
    children = admin.get("/api/children").json()
    assert [child["color"] for child in children] == ["#aa3366", None]

    # Replace: default categories still called as when they were created get their
    # translation, any other one its Spanish name; the children, the automatic colour.
    session = run_import(admin, data, "replace")
    assert session["status"] == "finished", session
    assert session["report"]["issues"] == []
    assert counts(session["report"], "categories") == (13, 0, 0)
    assert portuguese_names(admin) == {
        **{item.key: item.name_pt for item in CATEGORIES},
        "sleep": "Dormir",
        "Viajes": "Viajes",
        "Sueño": "Sueño",
    }
    children = admin.get("/api/children").json()
    assert [(child["slug"], child["color"]) for child in children] == [
        ("lucia", None),
        ("pablo", None),
    ]


# Media, failures and restarts ----------------------------------------------------------------


def test_damaged_or_missing_files_are_reported_and_skipped(admin: TestClient) -> None:
    created = library(admin)
    data = export_bytes(admin)
    folder = "events/2025/2025-03-22 Primeros pasos"
    broken = rebuild(
        data,
        drop=frozenset({f"{folder}/IMG_0001.jpg"}),
        replace={"events/2025/2025-03-22 Primer diente/IMG_0003.jpg": b"not a picture"},
    )
    ready = upload_archive(admin, broken)
    assert ready["archive"]["missing_files"] == 1
    session = start_import(admin, ready, "replace")
    assert session["status"] == "finished", session
    report = session["report"]
    assert counts(report, "media") == (3, 0, 2)
    assert counts(report, "events") == (3, 0, 0)
    assert sorted((issue["kind"], issue["name"], issue["code"]) for issue in report["issues"]) == [
        ("media", "Primer diente · Diente", "unsupported_media"),
        ("media", "Primeros pasos · Andando", "import_file_missing"),
    ]
    walk = admin.get(f"/api/admin/events/{created['events'][0]}").json()
    assert [image["name"] for image in walk["images"]] == ["Riendo"]
    assert walk["cover_image_id"] == walk["images"][0]["id"]
    assert admin.get(f"/api/admin/events/{created['events'][1]}").json()["images"] == []


def test_imports_accept_files_beyond_the_upload_limits(config_factory: Any) -> None:
    config = config_factory(max_upload_mb=1)
    with app_client(config) as client:
        login_as(client)
        child = add_child(client, "Lucía")
        event = create_event(client, [child], [category_ids(client)["general"]])
        data = export_bytes(client)
        noise = Pillow.frombytes("RGB", (1100, 1000), os.urandom(1100 * 1000 * 3))
        buffer = io.BytesIO()
        noise.save(buffer, "PNG")
        big = buffer.getvalue()
        assert len(big) > 1024 * 1024
        assert upload(client, data=big, filename="big.png").json() == {"code": "upload_too_large"}
        manifest = manifest_of(data)
        manifest["events"][0]["images"] = [
            {"file": "events/big.png", "name": "Grande", "original_filename": "big.png"}
        ]
        archive = make_archive(manifest, {"events/big.png": big})
        session = run_import(client, archive, "replace")
        assert session["report"]["issues"] == []
        [image] = client.get(f"/api/admin/events/{event['id']}").json()["images"]
        assert (image["name"], image["width"], image["height"]) == ("Grande", 1100, 1000)


def test_a_failed_save_changes_nothing(
    admin: TestClient, config: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    library(admin)
    data = export_bytes(admin)
    create_event(admin, [add_child(admin, "Marta")], [category_ids(admin)["general"]], title="Hoy")
    before = state(admin)
    folders = image_folders(config)

    async def broken(*args: Any) -> None:
        raise RuntimeError("database gone")

    monkeypatch.setattr(backup_import.Importer, "save_settings", broken)
    session = run_import(admin, data, "replace")
    assert (session["status"], session["error"], session["report"]) == (
        "ready",
        "import_failed",
        None,
    )
    assert state(admin) == before
    assert image_folders(config) == folders
    assert image_rows(admin, pending=True) == 0
    # The archive stays: once fixed, the import can run again.
    monkeypatch.undo()
    assert start_import(admin, session, "replace")["status"] == "finished"


def test_cancelling_stops_before_anything_changes(
    admin: TestClient, config: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    library(admin)
    data = export_bytes(admin)
    create_event(admin, [add_child(admin, "Marta")], [category_ids(admin)["general"]], title="Hoy")
    before = state(admin)
    folders = image_folders(config)
    app: Any = admin.app
    store = media.store_upload

    async def store_then_cancel(*args: Any, **kwargs: Any) -> Image:
        image = await store(*args, **kwargs)
        app.state.backups.cancel(app.state.backups.state.id)
        return image

    monkeypatch.setattr(media, "store_upload", store_then_cancel)
    session = run_import(admin, data, "replace")
    assert (session["status"], session["error"]) == ("ready", "import_cancelled")
    assert state(admin) == before
    assert image_folders(config) == folders
    assert image_rows(admin, pending=True) == 0


def test_a_restart_during_an_import_undoes_it(admin: TestClient, config: Settings) -> None:
    library(admin)
    session = upload_archive(admin, export_bytes(admin))
    prepared = uploaded(admin, "event")
    folder = config.media_dir / ".imports" / session["id"]
    saved = json.loads((folder / "state.json").read_text())
    saved.update(status="running", mode="replace")
    (folder / "state.json").write_text(json.dumps(saved))
    # What the run had prepared, the last line cut short by the crash.
    (folder / "prepared.txt").write_text(f"{prepared['id']}\n{prepared['id'][:20]}")
    with app_client(config) as restarted:
        login_as(restarted)
        [after] = restarted.get(IMPORTS).json()
        assert (after["status"], after["error"]) == ("ready", "import_interrupted")
        assert not (config.media_dir / prepared["id"]).exists()
        assert restarted.get(f"/api/media/{prepared['id']}/thumb").status_code == 404
        assert not (folder / "prepared.txt").exists()
        assert start_import(restarted, after, "merge")["status"] == "finished"


def test_folders_a_committed_import_removed_are_cleaned_up_after_a_crash(
    admin: TestClient, config: Settings
) -> None:
    session = upload_archive(admin, make_archive({"format": "x", "version": 1}))
    gone = uploaded(admin, "event")
    kept = uploaded(admin, "event")

    async def drop_row(db: AsyncSession) -> None:
        await db.execute(delete(Image).where(Image.id == uuid.UUID(gone["id"])))
        await db.commit()

    run_db(admin, drop_row)
    folder = config.media_dir / ".imports" / session["id"]
    (folder / "obsolete.txt").write_text(f"{gone['id']}\n{kept['id']}\n")
    with app_client(config) as restarted:
        login_as(restarted)
        # Its row was deleted by the committed transaction: the folder goes. The other one,
        # whose row still exists (no commit happened), stays.
        assert not (config.media_dir / gone["id"]).exists()
        assert (config.media_dir / kept["id"]).exists()
        assert not (folder / "obsolete.txt").exists()


def test_uploads_continue_after_a_restart(admin: TestClient, config: Settings) -> None:
    library(admin)
    data = export_bytes(admin)
    session = create(admin, len(data)).json()
    assert put(admin, session, 0, data[:1000]).status_code == 200
    archive = config.media_dir / ".imports" / session["id"] / "archive.zip"
    # A write a crash cut short: dropped at the next start.
    with open(archive, "ab") as handle:
        handle.write(b"garbage")
    with app_client(config) as restarted:
        login_as(restarted)
        [after] = restarted.get(IMPORTS).json()
        assert (after["status"], after["received"]) == ("uploading", 1000)
        assert archive.stat().st_size == 1000
        assert put(restarted, after, 1000, data[1000:]).json()["status"] == "ready"


def test_abandoned_sessions_are_removed_at_startup(admin: TestClient, config: Settings) -> None:
    session = create(admin, 100).json()
    state_file = config.media_dir / ".imports" / session["id"] / "state.json"
    saved = json.loads(state_file.read_text())
    saved["updated_at"] = (dt.datetime.now(dt.UTC) - dt.timedelta(days=2)).isoformat()
    state_file.write_text(json.dumps(saved))
    with app_client(config) as restarted:
        login_as(restarted)
        assert restarted.get(IMPORTS).json() == []
        assert not state_file.parent.exists()
        assert create(restarted, 100).status_code == 201


def test_a_finished_import_gives_way_to_the_next_one(admin: TestClient) -> None:
    library(admin)
    data = export_bytes(admin)
    finished = run_import(admin, data, "merge")
    assert admin.get(IMPORTS).json()[0]["status"] == "finished"
    created = create(admin, len(data))
    assert created.status_code == 201 and created.json()["id"] != finished["id"]


@requires_ffmpeg
def test_videos_and_live_photos_round_trip(admin: TestClient, tmp_path: Any) -> None:
    tiny = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast"]
    movie = clip(
        tmp_path, "paseo.mp4", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=1", *tiny
    )
    motion = clip(
        tmp_path, "IMG_0007.MOV", "-f", "lavfi", "-i", "testsrc=size=120x90:rate=10:duration=1",
        *tiny, "-brand", "qt  ",
    )
    video = upload(admin, data=movie, filename="paseo.mp4", content_type="video/mp4").json()
    live = upload(
        admin,
        data=image_bytes(size=(120, 90)),
        filename="IMG_0007.jpg",
        motion=("IMG_0007.MOV", motion, "video/quicktime"),
    ).json()
    child = add_child(admin, "Lucía")
    images = [
        {"id": video["id"], "name": "Paseo"},
        {"id": live["id"], "name": "Vivo", "live": False},
    ]
    event = create_event(admin, [child], [category_ids(admin)["general"]], images=images)
    wait_for_videos(admin)
    data = export_bytes(admin)
    folder = "events/2025/2025-03-22 Primeros pasos"
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert archive.read(f"{folder}/paseo.mp4") == movie
        assert archive.read(f"{folder}/IMG_0007.mov") == motion
    images = manifest_of(data)["events"][0]["images"]
    assert [(image["kind"], image["motion"], image["live"]) for image in images] == [
        ("video", None, False),
        ("image", f"{folder}/IMG_0007.mov", False),
    ]
    session = run_import(admin, data, "replace")
    assert session["report"]["issues"] == []
    wait_for_videos(admin)
    imported = admin.get(f"/api/admin/events/{event['id']}").json()["images"]
    assert [(image["kind"], image["video_status"], image["live"]) for image in imported] == [
        ("video", "ready", False),
        ("image", "ready", False),
    ]
    assert imported[0]["duration"] == pytest.approx(1.0, abs=0.2)
    response = admin.get(f"/api/media/{imported[0]['id']}/video")
    assert response.status_code == 200 and response.headers["content-type"] == "video/mp4"


def test_an_import_that_fails_after_saving_is_still_finished(
    admin: TestClient, config: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    library(admin)
    data = export_bytes(admin)
    old = image_folders(config)
    save = backup_import.Importer.save

    async def save_then_fail(self: backup_import.Importer, *args: Any) -> None:
        await save(self, *args)
        raise RuntimeError("connection lost after the commit")

    async def no_cleanup(media_dir: Any, ids: Any) -> None:
        raise OSError("media volume unavailable")

    monkeypatch.setattr(backup_import.Importer, "save", save_then_fail)
    monkeypatch.setattr(backup_import, "remove_image_folders", no_cleanup)
    session = run_import(admin, data, "replace")
    # Applied: reported as finished, never as "nothing changed".
    assert (session["status"], session["error"]) == ("finished", None)
    assert counts(session["report"], "events") == (3, 0, 0)
    journals = config.media_dir / ".imports" / session["id"]
    assert (journals / "obsolete.txt").exists()
    assert old <= image_folders(config)
    monkeypatch.undo()
    with app_client(config) as restarted:
        login_as(restarted)
        # The next start removes what the clean-up could not, and keeps what was imported.
        assert not old & image_folders(config)
        assert sorted(path.name for path in journals.iterdir()) == ["state.json"]
        assert image_rows(restarted) == 5 and image_rows(restarted, pending=True) == 0
        assert len(image_folders(config)) == 5
        assert restarted.get(IMPORTS).json()[0]["status"] == "finished"


def test_closing_the_report_while_old_folders_are_still_removed(
    admin: TestClient, config: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    library(admin)
    data = export_bytes(admin)
    app: Any = admin.app
    remove = backup_import.remove_image_folders
    gate: dict[str, asyncio.Event] = {}

    async def slow(media_dir: Any, ids: Any) -> None:
        if ids:
            gate.setdefault("open", asyncio.Event())
            await gate["open"].wait()
        await remove(media_dir, ids)

    monkeypatch.setattr(backup_import, "remove_image_folders", slow)
    session = upload_archive(admin, data)
    started = admin.post(f"{IMPORTS}/{session['id']}/start", json={"mode": "replace"})
    assert started.status_code == 200, started.text
    for _ in range(200):
        if "open" in gate:
            break
        time.sleep(0.05)
    else:
        pytest.fail("The old folders were never removed")
    assert admin.get(f"{IMPORTS}/{session['id']}").json()["status"] == "finished"
    # Closed while the old folders are still being removed: gone at once (a restart would not
    # bring it back), its folder with the clean-up's journal only once the clean-up is over.
    assert admin.delete(f"{IMPORTS}/{session['id']}").status_code == 204
    assert admin.get(IMPORTS).json() == []
    folder = config.media_dir / ".imports" / session["id"]
    assert sorted(path.name for path in folder.iterdir()) == ["obsolete.txt", "prepared.txt"]
    # A new import waits for that clean-up too; discarding it deletes its file at once.
    waiting = upload_archive(admin, data)
    response = admin.post(f"{IMPORTS}/{waiting['id']}/start", json={"mode": "merge"})
    assert (response.status_code, response.json()) == (409, {"code": "backup_busy"})
    assert admin.delete(f"{IMPORTS}/{waiting['id']}").status_code == 204
    assert not (config.media_dir / ".imports" / waiting["id"]).exists()
    ready = upload_archive(admin, data)
    assert admin.portal is not None
    admin.portal.call(gate["open"].set)
    admin.portal.call(app.state.backups.idle)
    assert not folder.exists()
    assert start_import(admin, ready, "merge")["status"] == "finished"


def test_a_closed_import_whose_clean_up_a_restart_cut_short_stays_closed(
    admin: TestClient, config: Settings
) -> None:
    gone = uploaded(admin, "event")

    async def drop_row(db: AsyncSession) -> None:
        await db.execute(delete(Image).where(Image.id == uuid.UUID(gone["id"])))
        await db.commit()

    run_db(admin, drop_row)
    # What a session closed during that clean-up leaves: its journal, no state.
    folder = config.media_dir / ".imports" / uuid.uuid4().hex
    folder.mkdir(parents=True)
    (folder / "obsolete.txt").write_text(f"{gone['id']}\n")
    with app_client(config) as restarted:
        login_as(restarted)
        assert restarted.get(IMPORTS).json() == []
        assert not (config.media_dir / gone["id"]).exists()
        assert not folder.exists()
