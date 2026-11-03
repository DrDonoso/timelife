"""Helpers for the backup (export and import) tests.

* ``library(client)``: a varied timeline built through the API (children with avatars and line
  colours, a custom category, events with photos, framings, a cover, a trashed event, users, year
  colours and settings with a background); returns what it created.
* ``export_bytes(client)``, ``manifest_of(data)``, ``archive_names(data)``, ``make_archive(...)``.
* ``upload_archive(client, data)`` sends a file in pieces and returns the final ``ImportOut``;
  ``run_import(client, data, mode)`` also runs the import and returns the finished session.
* ``wait_for_import(client)``: waits until the background import is over.
* ``state(client)``: everything the API shows, without ids or URLs that an import changes.
"""

import io
import json
import zipfile
from typing import Any

from fastapi.testclient import TestClient

from .helpers_events import add_child, category_ids, create_event
from .helpers_media import image_bytes, uploaded

IMPORTS = "/api/admin/backup/imports"


def library(client: TestClient) -> dict[str, Any]:
    """Populate a timeline through the API (the client is signed in as an administrator)."""
    avatar = uploaded(client, "avatar", data=image_bytes(size=(80, 80), color=(10, 120, 200)))
    lucia = client.post(
        "/api/admin/children",
        json={"name": "Lucía", "birth_date": "2024-03-01", "avatar_image_id": avatar["id"]},
    ).json()
    colour = client.put(f"/api/admin/children/{lucia['id']}/color", json={"color": "#AA3366"})
    assert colour.status_code == 200, colour.text
    pablo = add_child(client, "Pablo")
    seeded = category_ids(client)
    custom = client.post(
        "/api/admin/categories",
        json={
            "name_es": "Viajes",
            "name_en": "Trips",
            "name_pt": "Viagens",
            "icon": "plane",
            "color": "#123456",
        },
    )
    assert custom.status_code == 201, custom.text
    trip = custom.json()["id"]
    photos = [
        uploaded(
            client,
            data=image_bytes(size=(120, 90), color=(20 * number, 80, 160)),
            filename=f"IMG_{number:04d}.jpg",
        )
        for number in range(1, 4)
    ]
    first = create_event(
        client,
        [lucia["id"], pablo],
        [seeded["gross-motor"], trip],
        title="Primeros pasos",
        date="2025-03-22",
        notes="En el parque\ncon los abuelos",
        location="Madrid",
        images=[
            {"id": photos[0]["id"], "name": "Andando", "crop": {"x": 0.3, "y": 0.5, "zoom": 2}},
            {"id": photos[1]["id"], "name": "Riendo"},
        ],
        cover_image_id=photos[1]["id"],
    )
    second = create_event(
        client,
        [lucia["id"]],
        [seeded["teething"]],
        title="Primer diente",
        date="2025-03-22",
        images=[{"id": photos[2]["id"], "name": "Diente"}],
    )
    trashed = create_event(
        client, [pablo], [seeded["sleep"]], title="Duerme solo", date="2024-11-02"
    )
    assert client.delete(f"/api/admin/events/{trashed['id']}").status_code == 204
    viewer = client.post(
        "/api/admin/users",
        json={
            "email": "abuela@example.com",
            "role": "viewer",
            "name": "Abuela",
            "password": "abuela-temporal",
        },
    )
    assert viewer.status_code == 201, viewer.text
    assert client.put("/api/admin/year-colors/2025", json={"color": "#AA5500"}).status_code == 200
    background = uploaded(client, "background", data=image_bytes(size=(200, 100), color="#336699"))
    settings = client.put(
        "/api/admin/settings",
        json={
            "background_image_id": background["id"],
            "background_opacity": 0.4,
            "default_zoom": "months",
            "direction_desktop": "left_to_right",
            "direction_mobile": "top_to_bottom",
        },
    )
    assert settings.status_code == 200, settings.text
    return {
        "children": [lucia["id"], pablo],
        "category": trip,
        "events": [first["id"], second["id"]],
        "trashed": trashed["id"],
    }


def export_bytes(client: TestClient) -> bytes:
    response = client.get("/api/admin/backup/export")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    return response.content


def manifest_of(data: bytes) -> dict[str, Any]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        manifest: dict[str, Any] = json.loads(archive.read("manifest.json"))
    return manifest


def archive_names(data: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return archive.namelist()


def make_archive(
    manifest: Any, files: dict[str, bytes] | None = None, *, raw: bytes | None = None
) -> bytes:
    """A ZIP with ``manifest.json`` (``manifest`` as JSON, or ``raw`` bytes) and ``files``."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("manifest.json", raw if raw is not None else json.dumps(manifest))
        for name, content in (files or {}).items():
            archive.writestr(name, content)
    return buffer.getvalue()


def upload_archive(
    client: TestClient, data: bytes, *, chunk: int | None = None, filename: str = "copia.zip"
) -> dict[str, Any]:
    """Open an import session and send ``data`` in pieces; the final ``ImportOut``."""
    created = client.post(
        IMPORTS, json={"filename": filename, "size": len(data), "last_modified": 1700000000000}
    )
    assert created.status_code == 201, created.text
    session: dict[str, Any] = created.json()
    size = chunk or session["chunk_size"]
    for offset in range(0, len(data), size):
        response = client.put(
            f"{IMPORTS}/{session['id']}/content",
            params={"offset": offset},
            content=data[offset : offset + size],
            headers={"content-type": "application/octet-stream"},
        )
        assert response.status_code == 200, response.text
        session = response.json()
    return session


def wait_for_import(client: TestClient) -> None:
    assert client.portal is not None
    app: Any = client.app
    client.portal.call(app.state.backups.idle)


def start_import(client: TestClient, session: dict[str, Any], mode: str) -> dict[str, Any]:
    response = client.post(f"{IMPORTS}/{session['id']}/start", json={"mode": mode})
    assert response.status_code == 200, response.text
    wait_for_import(client)
    finished = client.get(f"{IMPORTS}/{session['id']}")
    assert finished.status_code == 200, finished.text
    body: dict[str, Any] = finished.json()
    return body


def run_import(client: TestClient, data: bytes, mode: str = "merge") -> dict[str, Any]:
    """Upload ``data``, import it with ``mode`` and return the session once the run is over."""
    session = upload_archive(client, data)
    assert session["status"] == "ready", session
    return start_import(client, session, mode)


def counts(report: dict[str, Any], kind: str) -> tuple[int, int, int]:
    item = report[kind]
    return item["created"], item["skipped"], item["failed"]


def without_urls(image: dict[str, Any]) -> dict[str, Any]:
    """An ``ImageOut`` without what changes when it is imported again (id and URLs)."""
    return {
        key: value
        for key, value in image.items()
        if key not in {"id", "thumb_url", "display_url", "video_url"}
    }


def state(client: TestClient) -> dict[str, Any]:
    """What the API shows, with image ids and URLs left out (an import makes new images)."""
    children = client.get("/api/children").json()
    for child in children:
        child["avatar"] = child["avatar"] and without_urls(child["avatar"])
    events = []
    listed = client.get("/api/admin/events", params={"page_size": 100}).json()["items"]
    trashed = client.get("/api/admin/trash").json()
    for item in [*listed, *trashed]:
        event = client.get(f"/api/admin/events/{item['id']}").json()
        cover = next(
            (image["name"] for image in event["images"] if image["id"] == event["cover_image_id"]),
            None,
        )
        event["images"] = [without_urls(image) for image in event["images"]]
        event["cover_image_id"] = cover
        events.append(event)
    appearance = client.get("/api/appearance").json()
    appearance["background"] = appearance["background"] and without_urls(appearance["background"])
    # A backup holds neither the Google link nor the passwords (only meaningful on one server).
    private = {"id", "google_linked", "has_password", "must_change_password"}
    users = [
        {key: value for key, value in user.items() if key not in private}
        for user in client.get("/api/admin/users").json()
    ]
    return {
        "children": children,
        "categories": client.get("/api/categories").json(),
        "events": sorted(events, key=lambda event: event["id"]),
        "trash": [{**item, "cover": None} for item in trashed],
        "appearance": appearance,
        "users": users,
    }
