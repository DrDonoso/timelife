"""Export of the whole timeline: ``GET /api/admin/backup/summary`` and ``/export``."""

import asyncio
import io
import os
import threading
import time
import zipfile
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from timelife import backup_export
from timelife.backup_import import ImportState
from timelife.db import utcnow
from timelife.seed import CATEGORIES

from .helpers_backup import archive_names, export_bytes, library, manifest_of
from .helpers_children import media_dir

FOLDER = "events/2025/2025-03-22 Primeros pasos"


def original(client: TestClient, image_id: str) -> Path:
    [path] = (media_dir(client) / image_id).glob("original.*")
    return path


def event_images(client: TestClient, event_id: int) -> list[dict[str, Any]]:
    images: list[dict[str, Any]] = client.get(f"/api/admin/events/{event_id}").json()["images"]
    return images


def test_export_holds_the_whole_timeline(admin: TestClient) -> None:
    created = library(admin)
    response = admin.get("/api/admin/backup/export")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["cache-control"] == "no-store"
    disposition = response.headers["content-disposition"]
    assert disposition.startswith('attachment; filename="timelife-')
    assert disposition.endswith('.zip"')
    data = response.content
    manifest = manifest_of(data)
    assert (manifest["format"], manifest["version"], manifest["app_version"]) == (
        "timelife-backup",
        2,
        "test",
    )
    assert [(user["email"], user["role"], user["name"]) for user in manifest["users"]] == [
        ("admin@example.com", "admin", None),
        ("abuela@example.com", "viewer", "Abuela"),
    ]
    assert manifest["users"][1]["invited_by"] == "admin@example.com"
    trips = [category for category in manifest["categories"] if category["name_es"] == "Viajes"]
    assert trips == [
        {
            "id": created["category"],
            "key": None,
            "name_es": "Viajes",
            "name_en": "Trips",
            "name_pt": "Viagens",
            "icon": "plane",
            "color": "#123456",
            "sort_order": 11,
            "created_at": trips[0]["created_at"],
            "updated_at": trips[0]["updated_at"],
        }
    ]
    defaults = {item["key"]: item["name_pt"] for item in manifest["categories"] if item["key"]}
    assert defaults == {item.key: item.name_pt for item in CATEGORIES}
    lucia, pablo = manifest["children"]
    assert (lucia["slug"], lucia["birth_date"], pablo["avatar"]) == ("lucia", "2024-03-01", None)
    assert (lucia["color"], pablo["color"]) == ("#aa3366", None)
    assert lucia["avatar"]["file"] == "children/lucia/photo.jpg"
    trashed, first, second = manifest["events"]
    assert trashed["title"] == "Duerme solo"
    assert trashed["deleted_by"] == "admin@example.com" and trashed["deleted_at"]
    assert (first["title"], second["title"]) == ("Primer diente", "Primeros pasos")
    walk = second
    assert walk["notes"] == "En el parque\ncon los abuelos" and walk["location"] == "Madrid"
    assert walk["child_ids"] == sorted(created["children"])
    assert [image["name"] for image in walk["images"]] == ["Andando", "Riendo"]
    assert [image["file"] for image in walk["images"]] == [
        f"{FOLDER}/IMG_0001.jpg",
        f"{FOLDER}/IMG_0002.jpg",
    ]
    assert walk["images"][0]["crop"] == {"x": 0.3, "y": 0.5, "zoom": 2.0}
    assert walk["images"][0]["uploaded_by"] == "admin@example.com"
    assert walk["cover"] == 1
    assert trashed["images"] == [] and trashed["cover"] is None
    assert manifest["year_colors"] == [{"year": 2025, "color": "#aa5500"}]
    settings = manifest["settings"]
    assert (
        settings["background_opacity"],
        settings["default_zoom"],
        settings["direction_desktop"],
        settings["direction_mobile"],
    ) == (0.4, "months", "left_to_right", "top_to_bottom")
    assert settings["background"]["file"] == "appearance/photo.jpg"
    assert "general" in settings["seeded_categories"]
    assert sorted(archive_names(data)) == sorted(
        [
            "manifest.json",
            "README.txt",
            "children/lucia/photo.jpg",
            "appearance/photo.jpg",
            f"{FOLDER}/IMG_0001.jpg",
            f"{FOLDER}/IMG_0002.jpg",
            "events/2025/2025-03-22 Primer diente/IMG_0003.jpg",
        ]
    )
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert archive.testzip() is None
        assert "Importar y exportar" in archive.read("README.txt").decode()
        for image in event_images(admin, created["events"][0]):
            name = f"{FOLDER}/IMG_000{1 if image['name'] == 'Andando' else 2}.jpg"
            assert archive.read(name) == original(admin, image["id"]).read_bytes()
            assert archive.getinfo(name).compress_type == zipfile.ZIP_STORED


def test_big_originals_are_streamed_unchanged(admin: TestClient) -> None:
    created = library(admin)
    [image, _] = event_images(admin, created["events"][0])
    content = os.urandom(3 * 1024 * 1024 + 123)
    original(admin, image["id"]).write_bytes(content)
    with zipfile.ZipFile(io.BytesIO(export_bytes(admin))) as archive:
        assert archive.read(f"{FOLDER}/IMG_0001.jpg") == content


def test_a_missing_original_is_left_out(admin: TestClient) -> None:
    created = library(admin)
    first, second = event_images(admin, created["events"][0])
    original(admin, first["id"]).unlink()
    walk = manifest_of(export_bytes(admin))["events"][2]
    assert [image["name"] for image in walk["images"]] == ["Riendo"]
    assert walk["cover"] == 0


def test_summary_counts_what_an_export_holds(admin: TestClient) -> None:
    library(admin)
    response = admin.get("/api/admin/backup/summary")
    assert response.status_code == 200, response.text
    summary = response.json()
    assert summary["media_bytes"] > 0
    assert {key: value for key, value in summary.items() if key != "media_bytes"} == {
        "events": 2,
        "trashed_events": 1,
        "photos": 3,
        "live_photos": 0,
        "videos": 0,
        "children": 2,
        "categories": 12,
        "users": 2,
        "admins": 1,
        "year_colors": 1,
        "background": True,
    }


def test_export_and_summary_need_an_administrator(client: TestClient, viewer: TestClient) -> None:
    for path in ("/api/admin/backup/summary", "/api/admin/backup/export"):
        assert viewer.get(path).json() == {"code": "admin_required"}
    client.cookies.clear()
    for path in ("/api/admin/backup/summary", "/api/admin/backup/export"):
        response = client.get(path)
        assert (response.status_code, response.json()) == (401, {"code": "authentication_required"})


def test_one_export_or_import_at_a_time(admin: TestClient) -> None:
    app: Any = admin.app
    backups = app.state.backups
    backups.exporting = True
    response = admin.get("/api/admin/backup/export")
    assert (response.status_code, response.json()) == (409, {"code": "backup_busy"})
    backups.exporting = False
    now = utcnow()
    backups.state = ImportState(
        id="0" * 32, status="running", filename="x.zip", size=1, created_at=now, updated_at=now
    )
    response = admin.get("/api/admin/backup/export")
    assert (response.status_code, response.json()) == (409, {"code": "backup_busy"})
    backups.state = None
    assert admin.get("/api/admin/backup/export").status_code == 200
    # The lock is released once the download is over.
    assert backups.exporting is False


def test_export_leaves_nothing_on_disk(admin: TestClient) -> None:
    library(admin)
    before = sorted(path.name for path in media_dir(admin).iterdir())
    export_bytes(admin)
    assert sorted(path.name for path in media_dir(admin).iterdir()) == before
    assert not (media_dir(admin) / ".imports").exists()


async def test_the_writer_stops_when_the_download_stops(tmp_path: Path) -> None:
    source = tmp_path / "big.bin"
    source.write_bytes(os.urandom(12 * backup_export.PIECE_BYTES))
    rows = backup_export.Rows(
        exported_at=utcnow(),
        app_version="test",
        users=[],
        categories=[],
        children=[],
        events=[],
        year_colors=[],
        settings={},
        background=None,
    )
    snapshot = backup_export.Snapshot(rows=rows)
    for number in range(4):
        snapshot.files.append(backup_export.MediaFile(entry={}, source=source, path=f"f{number}"))
    stop = threading.Event()
    pieces = backup_export.archive_pieces(snapshot, stop)
    first = await anext(pieces)
    assert first.startswith(b"PK\x03\x04")
    await pieces.aclose()
    assert stop.is_set()
    deadline = time.monotonic() + 10
    while any(thread.name == "timelife-export" for thread in threading.enumerate()):
        assert time.monotonic() < deadline, "the export thread kept running"
        await asyncio.sleep(0.05)
