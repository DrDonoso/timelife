"""The backup archive format: archive paths and manifest reading."""

import io
import json
import zipfile
from typing import Any

import pytest

from timelife.backup_format import (
    VERSION,
    Layout,
    Manifest,
    component,
    read_manifest,
    split_name,
    summarize,
)
from timelife.errors import AppError


def manifest(**changes: Any) -> dict[str, Any]:
    """A small valid manifest: one child, one category and one event with a photo."""
    return {
        "format": "timelife-backup",
        "version": 1,
        "exported_at": "2026-10-23T08:00:00+00:00",
        "app_version": "test",
        "users": [{"email": "Admin@Example.com", "role": "admin"}],
        "categories": [
            {
                "id": 7,
                "name_es": "General",
                "name_en": "General",
                "icon": "star",
                "color": "#AABBCC",
            }
        ],
        "children": [{"id": 3, "name": "Lucía", "slug": "lucia"}],
        "events": [
            {
                "id": 11,
                "title": "Primeros  pasos",
                "date": "2025-03-22",
                "child_ids": [3],
                "category_ids": [7],
                "images": [
                    {
                        "file": "events/2025/2025-03-22 Primeros pasos/IMG_1.jpg",
                        "name": "Andando",
                        "original_filename": "IMG_1.jpg",
                    }
                ],
                "cover": 0,
            }
        ],
        **changes,
    }


def archive(data: Any, *, name: str = "manifest.json", raw: bytes | None = None) -> zipfile.ZipFile:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as handle:
        handle.writestr(name, raw if raw is not None else json.dumps(data))
    buffer.seek(0)
    return zipfile.ZipFile(buffer)


def error_code(action: Any) -> str:
    with pytest.raises(AppError) as error:
        action()
    return error.value.code


def test_valid_manifest_is_normalised() -> None:
    parsed = read_manifest(archive(manifest()))
    assert parsed.users[0].email == "admin@example.com"
    assert parsed.categories[0].color == "#aabbcc"
    assert parsed.events[0].title == "Primeros pasos"
    assert [media.file for media in parsed.media()] == [
        "events/2025/2025-03-22 Primeros pasos/IMG_1.jpg"
    ]


@pytest.mark.parametrize(
    ("data", "raw", "name"),
    [
        (None, b"not json", "manifest.json"),
        (None, b"[1, 2]", "manifest.json"),
        (manifest(format="something-else"), None, "manifest.json"),
        (manifest(), None, "other.json"),
        (manifest(version="1"), None, "manifest.json"),
    ],
)
def test_unreadable_manifests_are_invalid(data: Any, raw: bytes | None, name: str) -> None:
    assert error_code(lambda: read_manifest(archive(data, raw=raw, name=name))) == "invalid_import"


def test_newer_versions_are_refused() -> None:
    assert VERSION == 2
    code = error_code(lambda: read_manifest(archive(manifest(version=VERSION + 1))))
    assert code == "import_version_unsupported"


def test_version_1_manifests_have_no_portuguese_names_nor_child_colours() -> None:
    parsed = read_manifest(archive(manifest()))
    assert parsed.version == 1
    assert parsed.categories[0].name_pt is None
    assert parsed.children[0].color is None


def test_portuguese_names_and_child_colours_are_read() -> None:
    data = manifest(version=2)
    data["categories"][0]["name_pt"] = "  Geral  "
    data["children"][0]["color"] = "#AA3366"
    data["children"].append({"id": 4, "name": "Pablo", "slug": "pablo", "color": None})
    parsed = read_manifest(archive(data))
    assert parsed.version == 2
    assert parsed.categories[0].name_pt == "Geral"
    assert [child.color for child in parsed.children] == ["#aa3366", None]


@pytest.mark.parametrize(
    "change",
    [
        # An event naming a child or category the manifest does not list.
        lambda data: data["events"][0].update(child_ids=[99]),
        lambda data: data["events"][0].update(category_ids=[99]),
        # Duplicated identities.
        lambda data: data["children"].append({"id": 4, "name": "Otra", "slug": "lucia"}),
        lambda data: data["users"].append({"email": "admin@example.com", "role": "viewer"}),
        # A file used twice, a path out of the archive, a cover out of range.
        lambda data: data["events"][0]["images"].append(dict(data["events"][0]["images"][0])),
        lambda data: data["events"][0]["images"][0].update(file="../etc/passwd"),
        lambda data: data["events"][0]["images"][0].update(file="/abs/photo.jpg"),
        lambda data: data["events"][0].update(cover=1),
        # Values the API would refuse.
        lambda data: data["events"][0].update(title="x" * 121),
        lambda data: data["children"][0].update(slug="Not A Slug"),
        lambda data: data["children"][0].update(color="red"),
        lambda data: data["children"][0].update(color="#abc"),
        lambda data: data["categories"][0].update(name_pt=""),
        lambda data: data["categories"][0].update(name_pt="x" * 61),
        lambda data: data["users"][0].update(role="owner"),
        lambda data: data.update(unknown=True),
    ],
)
def test_inconsistent_manifests_are_invalid(change: Any) -> None:
    data = manifest()
    change(data)
    with pytest.raises(AppError) as error:
        read_manifest(archive(data))
    assert error.value.code == "invalid_import"
    assert error.value.detail is not None and "location" in error.value.detail


def test_summary_counts_and_missing_files() -> None:
    data = manifest()
    data["events"][0]["images"].append(
        {
            "file": "events/2025/2025-03-22 Primeros pasos/IMG_2.heic",
            "motion": "events/2025/2025-03-22 Primeros pasos/IMG_2.mov",
            "name": "Live",
            "original_filename": "IMG_2.heic",
        }
    )
    data["events"].append(
        {
            "id": 12,
            "title": "Borrado",
            "date": "2024-01-01",
            "child_ids": [3],
            "category_ids": [7],
            "deleted_at": "2024-02-01T00:00:00Z",
            "images": [
                {
                    "file": "trash/2024/clip.mp4",
                    "kind": "video",
                    "name": "Clip",
                    "original_filename": "clip.mp4",
                }
            ],
        }
    )
    parsed = Manifest.model_validate(data)
    sizes = {
        "events/2025/2025-03-22 Primeros pasos/IMG_1.jpg": 100,
        "events/2025/2025-03-22 Primeros pasos/IMG_2.heic": 50,
        "trash/2024/clip.mp4": 1000,
    }
    summary, missing = summarize(parsed, sizes)
    assert (summary.events, summary.trashed_events) == (1, 1)
    assert (summary.photos, summary.live_photos, summary.videos) == (2, 1, 1)
    assert (summary.users, summary.admins, summary.children, summary.categories) == (1, 1, 1, 1)
    assert summary.media_bytes == 1150
    assert missing == 1


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("Primeros pasos", "Primeros pasos"),
        ('a/b\\c:d*e?f"g<h>i|j', "a b c d e f g h i j"),
        ("  ..Fin de año..  ", "Fin de año"),
        ("Tab\there\u200bzero\u202ebidi", "Tab here zero bidi"),
        ("CON", "_CON"),
        ("com1.txt", "_com1.txt"),
        ("...", "fallback"),
        ("x" * 100, "x" * 64),
        ("Cafe\u0301", "Café"),
    ],
)
def test_components_are_safe_on_every_file_system(value: str, expected: str) -> None:
    assert component(value, "fallback", 64) == expected


@pytest.mark.parametrize(
    ("filename", "extension", "expected"),
    [
        ("IMG_1234.HEIC", "heic", ("IMG_1234", "HEIC")),
        ("photo.png", "jpg", ("photo", "jpg")),
        ("no extension", "webp", ("no extension", "webp")),
        (".hidden", "gif", (".hidden", "gif")),
        ("dir/IMG.JPG", "jpg", ("IMG", "JPG")),
    ],
)
def test_file_names_keep_the_stored_extension(
    filename: str, extension: str, expected: tuple[str, str]
) -> None:
    assert split_name(filename, extension) == expected


def test_layout_paths_are_unique_without_case() -> None:
    import datetime as dt

    layout = Layout()
    day = dt.date(2025, 3, 22)
    folder = layout.event_folder("Primeros pasos", day, trashed=False)
    assert folder == "events/2025/2025-03-22 Primeros pasos"
    assert layout.event_folder("PRIMEROS PASOS", day, trashed=False).endswith(" (2)")
    assert layout.event_folder("Borrado", day, trashed=True).startswith("trash/2025/")
    first = layout.file(folder, "IMG_1.JPG", "jpg")
    second = layout.file(folder, "img_1.jpg", "jpg")
    assert (first, second) == (f"{folder}/IMG_1.JPG", f"{folder}/img_1 (2).jpg")
    assert layout.companion(first, "mov") == f"{folder}/IMG_1.mov"
    assert layout.child_folder("lucia") == "children/lucia"
    assert layout.file("appearance", "manifest", "json") == "appearance/manifest.json"
