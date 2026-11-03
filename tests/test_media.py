"""Media: pending-upload helpers, uploads and image processing, authenticated serving."""

import datetime as dt
import io
import re
import shutil
import struct
import uuid
import zlib
from collections.abc import Callable, Sequence
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import ExifTags, ImageCms
from PIL import Image as Pillow
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from timelife import media
from timelife.app import create_app
from timelife.config import Settings
from timelife.db import Child, Event, Image, aware, utcnow
from timelife.errors import AppError
from timelife.media import (
    VARIANTS,
    attach_pending,
    cleanup_orphans,
    delete_images,
    image_name,
    original_filename,
)

from .conftest import app_client, login_as, run_db
from .helpers_media import PHOTO_FIELDS, add_folder, image_bytes, image_row, upload, uploaded

Sessions = async_sessionmaker[AsyncSession]
CACHE_CONTROL = "private, max-age=31536000, immutable"


def event_row(title: str = "Primeros pasos", *, deleted: bool = False) -> Event:
    now = utcnow()
    return Event(
        title=title,
        title_search=title.lower(),
        date=dt.date(2025, 5, 1),
        notes="",
        created_at=now,
        updated_at=now,
        deleted_at=now if deleted else None,
    )


async def add_event(db: AsyncSession, title: str = "Primeros pasos", **options: Any) -> int:
    event = event_row(title, **options)
    db.add(event)
    await db.flush()
    return event.id


async def image_states(db: AsyncSession) -> dict[uuid.UUID, tuple[int | None, bool]]:
    """``id → (event_id, pending)`` of every image row."""
    rows = await db.execute(select(Image.id, Image.event_id, Image.expires_at))
    return {image_id: (event_id, expires is not None) for image_id, event_id, expires in rows}


# Helpers: attach_pending ------------------------------------------------------------------


@pytest.fixture
async def gallery(sessions: Sessions) -> dict[str, Any]:
    """Two events and images in every state; maps names to event ids / image ids."""
    async with sessions() as db:
        first = await add_event(db)
        second = await add_event(db, "Segundo")
        rows = {
            "pending": image_row(),
            "pending2": image_row(),
            "expired": image_row(expires_at=utcnow() - timedelta(hours=1)),
            "avatar": image_row("avatar"),
            "attached_avatar": image_row("avatar", expires_at=None),
            "background": image_row("background"),
            "first": image_row(event_id=first, expires_at=None),
            "second": image_row(event_id=second, expires_at=None),
        }
        db.add_all(rows.values())
        await db.commit()
    return {"first_event": first, "second_event": second} | {
        name: row.id for name, row in rows.items()
    }


async def test_attach_pending_attaches_event_images_in_order(
    sessions: Sessions, gallery: dict[str, Any]
) -> None:
    event_id = gallery["first_event"]
    ids = [gallery["pending2"], gallery["first"], gallery["expired"], gallery["pending"]]
    async with sessions() as db:
        attached = await attach_pending(db, ids, purpose="event", event_id=event_id)
        assert [image.id for image in attached] == ids
        assert all(image.expires_at is None and image.event_id == event_id for image in attached)
        await db.commit()

    async with sessions() as db:
        states = await image_states(db)
    assert {image_id: states[image_id] for image_id in ids} == {
        image_id: (event_id, False) for image_id in ids
    }
    assert states[gallery["second"]] == (gallery["second_event"], False)
    assert states[gallery["avatar"]] == (None, True)


@pytest.mark.parametrize(
    ("names", "purpose", "keep"),
    [
        (["avatar"], "avatar", []),
        (["avatar"], "avatar", ["attached_avatar"]),
        (["attached_avatar"], "avatar", ["attached_avatar"]),
        (["attached_avatar", "avatar"], "avatar", ["attached_avatar"]),
        (["background"], "background", []),
    ],
)
async def test_attach_pending_avatars_and_backgrounds(
    sessions: Sessions,
    gallery: dict[str, Any],
    names: list[str],
    purpose: str,
    keep: list[str],
) -> None:
    ids = [gallery[name] for name in names]
    async with sessions() as db:
        attached = await attach_pending(
            db, ids, purpose=purpose, keep=[gallery[name] for name in keep]
        )
        await db.commit()
    assert [image.id for image in attached] == ids
    async with sessions() as db:
        states = await image_states(db)
    assert [states[image_id] for image_id in ids] == [(None, False)] * len(ids)


@pytest.mark.parametrize(
    ("names", "purpose", "keep"),
    [
        (["unknown"], "event", []),
        (["pending", "pending"], "event", []),
        (["pending", "unknown"], "event", []),
        (["pending", "second"], "event", []),
        (["avatar"], "event", []),
        (["pending"], "avatar", []),
        (["attached_avatar"], "avatar", []),
        (["attached_avatar"], "avatar", ["avatar"]),
        (["first"], "avatar", ["first"]),
        (["background", "avatar"], "background", []),
    ],
)
async def test_attach_pending_rejects_unusable_images_without_changes(
    sessions: Sessions,
    gallery: dict[str, Any],
    names: list[str],
    purpose: str,
    keep: list[str],
) -> None:
    gallery["unknown"] = uuid.uuid4()
    event_id = gallery["first_event"] if purpose == "event" else None
    async with sessions() as db:
        before = await image_states(db)
        with pytest.raises(AppError) as error:
            await attach_pending(
                db,
                [gallery[name] for name in names],
                purpose=purpose,
                event_id=event_id,
                keep=[gallery[name] for name in keep],
            )
        assert (error.value.code, error.value.status) == ("invalid_image", 422)
        await db.commit()
    async with sessions() as db:
        assert await image_states(db) == before


async def test_attach_pending_only_reuses_images_of_the_same_event(
    sessions: Sessions, gallery: dict[str, Any]
) -> None:
    async with sessions() as db:
        with pytest.raises(AppError):
            await attach_pending(
                db, [gallery["first"]], purpose="event", event_id=gallery["second_event"]
            )
        attached = await attach_pending(
            db, [gallery["first"]], purpose="event", event_id=gallery["first_event"]
        )
        assert [image.id for image in attached] == [gallery["first"]]


async def test_attach_pending_argument_errors_and_empty_lists(sessions: Sessions) -> None:
    async with sessions() as db:
        assert await attach_pending(db, [], purpose="avatar") == []
        assert await attach_pending(db, [], purpose="event", event_id=1) == []
        assert not db.in_transaction()
        for purpose, event_id in (("event", None), ("avatar", 1), ("cover", None)):
            with pytest.raises(ValueError):
                await attach_pending(db, [uuid.uuid4()], purpose=purpose, event_id=event_id)


# Helpers: delete_images / cleanup_orphans ---------------------------------------------------


async def test_deleted_images_lose_their_folders_once_committed(
    sessions: Sessions, config: Settings
) -> None:
    media = config.media_dir
    async with sessions() as db:
        event_id = await add_event(db)
        doomed = [
            image_row(event_id=event_id, expires_at=None),
            image_row("avatar", expires_at=None),
        ]
        survivor = image_row(event_id=event_id, expires_at=None)
        db.add_all([*doomed, survivor])
        await db.flush()
        db.add(Child(name="Ana", slug="ana", sort_order=0, avatar_image_id=doomed[1].id))
        await db.commit()
    folders = {row.id: add_folder(media, row.id) for row in [*doomed, survivor]}

    async with sessions() as db:
        await delete_images(db, [*doomed, doomed[0]], media)
        assert await db.scalar(select(func.count()).select_from(Image)) == 1
        assert all(folder.is_dir() for folder in folders.values())
        await db.commit()
        assert [folders[row.id].exists() for row in doomed] == [False, False]
        assert folders[survivor.id].is_dir()

    async with sessions() as db:
        assert list(await db.scalars(select(Image.id))) == [survivor.id]
        assert await db.scalar(select(Child.avatar_image_id)) is None


async def test_uncommitted_deletions_keep_the_files(sessions: Sessions, config: Settings) -> None:
    async with sessions() as db:
        image = image_row()
        db.add(image)
        await db.commit()
    folder = add_folder(config.media_dir, image.id)

    async with sessions() as db:
        await delete_images(db, [image], config.media_dir)
        await db.rollback()
        await db.commit()  # a later commit of the same session must not remove them
        assert folder.is_dir()
        await delete_images(db, [image], config.media_dir)
    assert folder.is_dir()  # closed without committing

    async with sessions() as db:
        await delete_images(db, [], config.media_dir)
        assert not db.in_transaction()
        assert await db.get(Image, image.id) is not None


async def test_deletions_inside_savepoints_follow_the_outer_transaction(
    sessions: Sessions, config: Settings
) -> None:
    images = [image_row() for _ in range(3)]
    async with sessions() as db:
        db.add_all(images)
        await db.commit()
    folders = [add_folder(config.media_dir, image.id) for image in images]

    async with sessions() as db:
        savepoint = await db.begin_nested()
        await delete_images(db, [images[0]], config.media_dir)
        await savepoint.rollback()
        async with db.begin_nested():
            await delete_images(db, [images[1]], config.media_dir)
        assert folders[1].is_dir()  # a released savepoint is not a commit yet
        await db.commit()
    assert [folder.exists() for folder in folders] == [True, False, True]

    async with sessions() as db:
        assert set(await db.scalars(select(Image.id))) == {images[0].id, images[2].id}
        async with db.begin_nested():
            await delete_images(db, [images[2]], config.media_dir)
        await db.rollback()
    assert folders[2].is_dir()


async def test_cleanup_orphans_purges_expired_pending_uploads(
    sessions: Sessions, config: Settings
) -> None:
    past = utcnow() - timedelta(minutes=1)
    async with sessions() as db:
        event_id = await add_event(db)
        expired = [image_row(expires_at=past), image_row("avatar", expires_at=past)]
        kept = [
            image_row(),
            image_row("background", expires_at=None),
            image_row(event_id=event_id, expires_at=past),  # attached to an event: never purged
        ]
        db.add_all([*expired, *kept])
        await db.commit()
    folders = {row.id: add_folder(config.media_dir, row.id) for row in [*expired, *kept]}

    async with sessions() as db:
        assert await cleanup_orphans(db, config.media_dir) == 2
        assert await cleanup_orphans(db, config.media_dir) == 0
        assert set(await db.scalars(select(Image.id))) == {row.id for row in kept}
    assert [folders[row.id].exists() for row in expired] == [False, False]
    assert all(folders[row.id].is_dir() for row in kept)


async def test_expired_uploads_are_purged_at_startup(sessions: Sessions, config: Settings) -> None:
    async with sessions() as db:
        image = image_row(expires_at=utcnow() - timedelta(seconds=1))
        db.add(image)
        await db.commit()
    folder = add_folder(config.media_dir, image.id)

    with TestClient(create_app(config)):
        pass

    assert not folder.exists()
    async with sessions() as db:
        assert await db.get(Image, image.id) is None


# Uploads ------------------------------------------------------------------------------------


def encode(image: Pillow.Image, image_format: str, **options: Any) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, image_format, **options)
    return buffer.getvalue()


def halves(mode: str, size: tuple[int, int], left: Any, right: Any) -> Pillow.Image:
    """``size`` image filled with ``left`` on its left half and ``right`` on its right half."""
    image = Pillow.new(mode, size, left)
    image.paste(right, (size[0] // 2, 0, size[0], size[1]))
    return image


def png_header(width: int, height: int) -> bytes:
    """A tiny PNG that only claims to be ``width`` × ``height`` (8-bit grayscale)."""

    def chunk(kind: bytes, payload: bytes) -> bytes:
        crc = struct.pack(">I", zlib.crc32(kind + payload))
        return struct.pack(">I", len(payload)) + kind + payload + crc

    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b"\0"))
        + chunk(b"IEND", b"")
    )


def swapped_primaries_profile() -> bytes:
    """An RGB ICC profile equal to sRGB but with the red and green primaries swapped."""
    data = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
    (count,) = struct.unpack(">I", data[128:132])
    entries = {bytes(data[132 + 12 * i : 136 + 12 * i]): 132 + 12 * i for i in range(count)}
    red, green = entries[b"rXYZ"] + 4, entries[b"gXYZ"] + 4
    data[red : red + 8], data[green : green + 8] = data[green : green + 8], data[red : red + 8]
    return bytes(data)


def variant(config: Settings, image_id: str, name: str) -> Pillow.Image:
    image = Pillow.open(config.media_dir / image_id / f"{name}.webp")
    image.load()
    assert image.format == "WEBP"
    return image


def pixel(image: Pillow.Image, x: int, y: int) -> tuple[int, ...]:
    value = image.getpixel((x, y))
    assert isinstance(value, tuple)
    return value


def close_to(actual: Sequence[int], expected: Sequence[int], tolerance: int = 16) -> bool:
    return len(actual) == len(expected) and all(
        abs(a - b) <= tolerance for a, b in zip(actual, expected, strict=True)
    )


def rgb(color: str) -> tuple[int, ...]:
    assert re.fullmatch(r"#[0-9a-f]{6}", color), color
    return tuple(int(color[index : index + 2], 16) for index in (1, 3, 5))


def stored(client: TestClient, image_id: str) -> Image:
    async def load(db: AsyncSession) -> Image | None:
        return await db.get(Image, uuid.UUID(image_id))

    image = run_db(client, load)
    assert image is not None
    return image


async def count_images(db: AsyncSession) -> int:
    return await db.scalar(select(func.count()).select_from(Image)) or 0


def folder_names(config: Settings, image_id: str) -> set[str]:
    return {path.name for path in (config.media_dir / image_id).iterdir()}


def test_an_upload_is_stored_as_a_pending_image_with_its_variants(
    client: TestClient, config: Settings
) -> None:
    admin_id = login_as(client, "admin")
    data = image_bytes("JPEG", (640, 480), (30, 120, 200), quality=95)
    response = upload(client, data=data, filename="Cumpleaños de Ana.JPG")

    assert response.status_code == 201, response.text
    body = response.json()
    image_id = body["id"]
    assert body == {
        "id": image_id,
        "name": "Cumpleaños de Ana",
        "width": 640,
        "height": 480,
        "dominant_color": body["dominant_color"],
        "crop": None,
        "thumb_url": f"/api/media/{image_id}/thumb",
        "display_url": f"/api/media/{image_id}/display",
        **PHOTO_FIELDS,
        "progress": None,
    }
    assert close_to(rgb(body["dominant_color"]), (30, 120, 200), 4)

    row = stored(client, image_id)
    assert (row.purpose, row.event_id, row.position, row.uploaded_by_id) == (
        "event",
        None,
        0,
        admin_id,
    )
    assert (row.name, row.original_filename, row.original_ext, row.content_type) == (
        "Cumpleaños de Ana",
        "Cumpleaños de Ana.JPG",
        "jpg",
        "image/jpeg",
    )
    assert (row.byte_size, row.width, row.height, row.dominant_color) == (
        len(data),
        640,
        480,
        body["dominant_color"],
    )
    assert row.expires_at is not None
    lifetime = aware(row.expires_at) - utcnow()
    assert timedelta(hours=23, minutes=59) < lifetime <= timedelta(hours=24)

    assert folder_names(config, image_id) == {"original.jpg", "thumb.webp", "display.webp"}
    assert (config.media_dir / image_id / "original.jpg").read_bytes() == data
    thumb, display = variant(config, image_id, "thumb"), variant(config, image_id, "display")
    assert (thumb.size, thumb.mode) == ((512, 512), "RGB")
    assert (display.size, display.mode) == ((640, 480), "RGB")
    assert close_to(pixel(display, 320, 240), (30, 120, 200))


def multi_picture() -> bytes:
    frames = [Pillow.new("RGB", (120, 80), (40, 160, 60)), Pillow.new("RGB", (120, 80), "yellow")]
    return encode(frames[0], "MPO", save_all=True, append_images=frames[1:])


def solid(image_format: str, **options: Any) -> Callable[[], bytes]:
    return lambda: image_bytes(image_format, (120, 80), (40, 160, 60), **options)


SUPPORTED: dict[str, tuple[Callable[[], bytes], str, str]] = {
    "jpeg": (solid("JPEG", quality=95), "jpg", "image/jpeg"),
    "mpo": (multi_picture, "jpg", "image/jpeg"),
    "png": (solid("PNG"), "png", "image/png"),
    "webp": (solid("WEBP", quality=95), "webp", "image/webp"),
    "gif": (solid("GIF"), "gif", "image/gif"),
    "heic": (solid("HEIF", quality=90), "heic", "image/heic"),
}


@pytest.mark.parametrize("kind", list(SUPPORTED))
def test_supported_formats_are_detected_from_their_content(
    admin: TestClient, config: Settings, kind: str
) -> None:
    make, extension, content_type = SUPPORTED[kind]
    data = make()
    response = upload(
        admin, "background", data=data, filename="upload.bin", content_type="text/plain"
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["name"], body["width"], body["height"]) == ("upload", 120, 80)
    assert close_to(rgb(body["dominant_color"]), (40, 160, 60))
    row = stored(admin, body["id"])
    assert (row.purpose, row.original_ext, row.content_type, row.byte_size) == (
        "background",
        extension,
        content_type,
        len(data),
    )
    assert row.original_filename == "upload.bin"
    assert (config.media_dir / body["id"] / f"original.{extension}").read_bytes() == data
    assert close_to(pixel(variant(config, body["id"], "display"), 60, 40), (40, 160, 60))


@pytest.mark.parametrize("image_format", ["GIF", "WEBP"])
def test_animations_keep_their_first_frame(
    admin: TestClient, config: Settings, image_format: str
) -> None:
    first, second = Pillow.new("RGB", (60, 40), (220, 30, 30)), Pillow.new("RGB", (60, 40), "blue")
    data = encode(first, image_format, save_all=True, append_images=[second], duration=100, loop=0)
    body = uploaded(admin, data=data, filename="animation.gif")
    assert close_to(pixel(variant(config, body["id"], "display"), 30, 20), (220, 30, 30), 20)
    assert close_to(rgb(body["dominant_color"]), (220, 30, 30), 20)


@pytest.mark.parametrize("image_format", ["JPEG", "PNG", "WEBP", "HEIF"])
def test_exif_orientation_is_applied_once(
    admin: TestClient, config: Settings, image_format: str
) -> None:
    exif = Pillow.Exif()
    exif[ExifTags.Base.Orientation] = 6  # stored sideways: rotate 90° clockwise to display
    sideways = halves("RGB", (300, 200), (220, 30, 30), (30, 30, 220))
    body = uploaded(admin, data=encode(sideways, image_format, exif=exif.tobytes(), quality=95))

    assert (body["width"], body["height"]) == (200, 300)
    for name in VARIANTS:
        image = variant(config, body["id"], name)
        width, height = image.size
        assert close_to(pixel(image, width // 2, height // 6), (220, 30, 30), 24), name
        assert close_to(pixel(image, width // 2, height * 5 // 6), (30, 30, 220), 24), name


def test_cmyk_images_are_converted_to_rgb(admin: TestClient, config: Settings) -> None:
    data = image_bytes("JPEG", (80, 60), (0, 255, 255, 0), mode="CMYK", quality=95)
    body = uploaded(admin, data=data)
    display = variant(config, body["id"], "display")
    assert display.mode == "RGB"
    assert close_to(pixel(display, 40, 30), (255, 0, 0), 20)
    assert close_to(rgb(body["dominant_color"]), (255, 0, 0), 8)


def transparent(kind: str) -> bytes:
    rgba = halves("RGBA", (64, 64), (255, 0, 0, 0), (0, 200, 0, 255))
    palette = halves("P", (64, 64), 0, 1)
    palette.putpalette([255, 0, 0, 0, 200, 0])
    if kind == "png-rgba":
        return encode(rgba, "PNG")
    if kind == "png-la":
        return encode(halves("LA", (64, 64), (90, 0), (200, 255)), "PNG")
    if kind == "png-palette":
        return encode(palette, "PNG", transparency=0)
    if kind == "gif":
        return encode(palette, "GIF", transparency=0)
    return encode(rgba, "WEBP", lossless=True)


@pytest.mark.parametrize("kind", ["png-rgba", "png-la", "png-palette", "gif", "webp"])
def test_transparency_is_kept(admin: TestClient, config: Settings, kind: str) -> None:
    body = uploaded(admin, data=transparent(kind), filename="sticker.png")
    opaque = (200, 200, 200) if kind == "png-la" else (0, 200, 0)
    for name in VARIANTS:
        image = variant(config, body["id"], name)
        width, height = image.size
        assert image.mode == "RGBA", name
        assert pixel(image, width // 8, height // 2)[3] == 0, name
        right = pixel(image, width * 7 // 8, height // 2)
        assert right[3] == 255 and close_to(right[:3], opaque), name
    # The average colour ignores fully transparent pixels.
    assert close_to(rgb(body["dominant_color"]), opaque)


@pytest.mark.parametrize(
    ("data", "level"),
    [
        (image_bytes("JPEG", (40, 40), 90, mode="L", quality=95), 90),
        (image_bytes("PNG", (40, 40), 128 * 257, mode="I;16"), 128),
    ],
    ids=["8-bit", "16-bit"],
)
def test_grayscale_images_become_rgb(
    admin: TestClient, config: Settings, data: bytes, level: int
) -> None:
    body = uploaded(admin, data=data)
    display = variant(config, body["id"], "display")
    assert display.mode == "RGB"
    assert close_to(pixel(display, 20, 20), (level,) * 3, 6)


def test_variants_carry_no_metadata(admin: TestClient, config: Settings) -> None:
    exif = Pillow.Exif()
    exif[ExifTags.Base.Make] = "Timelife Cam"
    exif[ExifTags.IFD.GPSInfo] = {
        ExifTags.GPS.GPSLatitudeRef: "N",
        ExifTags.GPS.GPSLatitude: (40.0, 25.0, 1.5),
        ExifTags.GPS.GPSLongitudeRef: "W",
        ExifTags.GPS.GPSLongitude: (3.0, 42.0, 9.5),
    }
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    xmp = (
        b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
        b'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description '
        b'xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="40,25.0N"/>'
        b"</rdf:RDF></x:xmpmeta>"
    )
    data = image_bytes(
        "JPEG", (200, 100), (10, 90, 160), exif=exif.tobytes(), icc_profile=profile, xmp=xmp
    )
    original = Pillow.open(io.BytesIO(data))
    assert original.getexif().get_ifd(ExifTags.IFD.GPSInfo)
    assert {"exif", "icc_profile", "xmp"} <= set(original.info)

    body = uploaded(admin, data=data)

    assert (config.media_dir / body["id"] / "original.jpg").read_bytes() == data
    for name in VARIANTS:
        raw = (config.media_dir / body["id"] / f"{name}.webp").read_bytes()
        image = Pillow.open(io.BytesIO(raw))
        assert not {"exif", "icc_profile", "xmp"} & set(image.info), name
        assert len(image.getexif()) == 0, name
        assert not [chunk for chunk in (b"EXIF", b"ICCP", b"XMP ") if chunk in raw], name


def test_embedded_colour_profiles_are_converted_to_srgb(
    admin: TestClient, config: Settings
) -> None:
    profile = swapped_primaries_profile()
    cases = [
        (image_bytes("JPEG", (40, 40), (255, 0, 0), quality=95, icc_profile=profile), (0, 255, 0)),
        (
            encode(halves("RGBA", (40, 40), (0, 0, 255, 0), "red"), "PNG", icc_profile=profile),
            (0, 255, 0),
        ),
        (image_bytes("PNG", (40, 40), (255, 0, 0), icc_profile=b"not a profile"), (255, 0, 0)),
    ]
    for data, expected in cases:
        body = uploaded(admin, data=data)
        display = variant(config, body["id"], "display")
        assert "icc_profile" not in display.info
        assert close_to(pixel(display, 30, 20)[:3], expected, 24), expected
        assert close_to(rgb(body["dominant_color"]), expected, 24), expected
        if display.mode == "RGBA":
            assert pixel(display, 5, 20)[3] == 0


@pytest.mark.parametrize(
    ("size", "display"),
    [
        ((3000, 1000), (2048, 683)),
        ((1000, 3000), (683, 2048)),
        ((4500, 4200), (2048, 1911)),  # decoded at half scale first
        ((2048, 1500), (2048, 1500)),
        ((20, 10), (20, 10)),  # never enlarged
    ],
)
def test_display_fits_2048_pixels_and_the_thumbnail_is_512_square(
    admin: TestClient, config: Settings, size: tuple[int, int], display: tuple[int, int]
) -> None:
    body = uploaded(admin, data=image_bytes("JPEG", size, (120, 60, 30)))
    assert (body["width"], body["height"]) == display
    assert variant(config, body["id"], "display").size == display
    assert variant(config, body["id"], "thumb").size == (512, 512)


@pytest.mark.parametrize(
    ("size", "decoded"),
    [
        ((6000, 4000), (3000, 2000)),
        ((4000, 6000), (2000, 3000)),
        ((8000, 1000), (8000, 1000)),  # the short edge must still fill a thumbnail
        ((2000, 1000), (2000, 1000)),
    ],
)
def test_large_jpegs_are_decoded_at_a_reduced_scale(
    size: tuple[int, int], decoded: tuple[int, int]
) -> None:
    working, upright, profile = media.decode(
        media.open_picture(io.BytesIO(image_bytes("JPEG", size)))
    )
    assert (working.size, working.mode, upright, profile) == (decoded, "RGB", None, None)


def test_thumbnails_are_centre_crops(admin: TestClient, config: Settings) -> None:
    wide = Pillow.new("RGB", (900, 300), "red")
    wide.paste((0, 160, 0), (300, 0, 600, 300))
    body = uploaded(admin, data=encode(wide, "PNG"))
    thumb = variant(config, body["id"], "thumb")
    for x in (10, 256, 500):
        assert close_to(pixel(thumb, x, 256), (0, 160, 0)), x


@pytest.mark.parametrize(
    "kind", ["text", "svg", "empty", "fake-jpeg", "truncated", "bmp", "tiff", "avif"]
)
@pytest.mark.parametrize(
    ("purpose", "code"), [("event", "unsupported_media"), ("avatar", "unsupported_image")]
)
def test_unsupported_files_are_rejected(
    admin: TestClient, config: Settings, kind: str, purpose: str, code: str
) -> None:
    # Event uploads may also be videos: neither a photo nor a video is "unsupported_media".
    jpeg = image_bytes("JPEG", (300, 200), quality=95)
    data = {
        "text": b"just some notes\n",
        "svg": b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
        "empty": b"",
        "fake-jpeg": b"\xff\xd8\xff" + bytes(100),
        "truncated": jpeg[: len(jpeg) // 2],
        "bmp": image_bytes("BMP"),
        "tiff": image_bytes("TIFF"),
        "avif": image_bytes("AVIF"),
    }[kind]
    response = upload(admin, purpose, data=data, filename="photo.jpg", content_type="image/jpeg")
    assert (response.status_code, response.json()) == (422, {"code": code})
    assert run_db(admin, count_images) == 0
    assert not list(config.media_dir.iterdir())


@pytest.mark.filterwarnings("ignore::PIL.Image.DecompressionBombWarning")
@pytest.mark.parametrize("size", [(10_000, 8_001), (20_000, 20_000)])
def test_images_over_80_megapixels_are_rejected(
    admin: TestClient, config: Settings, size: tuple[int, int]
) -> None:
    response = upload(admin, data=png_header(*size), filename="huge.png")
    assert (response.status_code, response.json()) == (
        422,
        {"code": "image_dimensions_too_large"},
    )
    assert run_db(admin, count_images) == 0


def test_files_over_max_upload_mb_are_rejected(config_factory: Any) -> None:
    limit = 1024 * 1024
    jpeg = image_bytes("JPEG", (64, 48))
    with app_client(config_factory(max_upload_mb=1)) as client:
        login_as(client, "admin")
        too_large = upload(client, data=jpeg + bytes(limit + 1 - len(jpeg)))
        assert (too_large.status_code, too_large.json()) == (413, {"code": "upload_too_large"})
        assert run_db(client, count_images) == 0
        assert upload(client, data=jpeg + bytes(limit - len(jpeg))).status_code == 201


def test_upload_requests_are_validated(admin: TestClient) -> None:
    for purpose in ("cover", "Event", ""):
        response = upload(admin, purpose)
        assert (response.status_code, response.json()) == (422, {"code": "invalid_purpose"})
    no_purpose = admin.post("/api/admin/uploads", files={"file": ("a.jpg", image_bytes())})
    assert no_purpose.status_code == 422
    assert no_purpose.json() == {"code": "invalid_request", "fields": {"purpose": "missing"}}
    no_file = admin.post("/api/admin/uploads?purpose=event", data={"other": "x"})
    assert (no_file.status_code, no_file.json()["code"]) == (422, "invalid_request")
    assert run_db(admin, count_images) == 0


def test_uploads_need_an_administrator_and_the_csrf_headers(client: TestClient) -> None:
    anonymous = upload(client)
    assert (anonymous.status_code, anonymous.json()) == (401, {"code": "authentication_required"})
    login_as(client, "viewer")
    viewer = upload(client)
    assert (viewer.status_code, viewer.json()) == (403, {"code": "admin_required"})

    login_as(client, "admin")
    for headers in ({"x-timelife-request": "0"}, {"origin": "https://evil.example.com"}):
        forged = client.post(
            "/api/admin/uploads",
            params={"purpose": "event"},
            files={"file": ("photo.jpg", image_bytes(), "image/jpeg")},
            headers=headers,
        )
        assert (forged.status_code, forged.json()) == (403, {"code": "invalid_origin"})
    assert run_db(client, count_images) == 0


@pytest.mark.parametrize(
    ("filename", "name", "original"),
    [
        ("Cumpleaños de Ana.JPG", "Cumpleaños de Ana", "Cumpleaños de Ana.JPG"),
        ("C:\\fakepath\\vacaciones\\playa.heic", "playa", "playa.heic"),
        ("../../etc/passwd", "passwd", "passwd"),
        ("  Mi \t foto\n de\x00 verano .png ", "Mi foto de verano", "Mi foto de verano .png"),
        ("archivo.tar.gz", "archivo.tar", "archivo.tar.gz"),
        ("Dr. House", "Dr. House", "Dr. House"),
        (".hidden", ".hidden", ".hidden"),
        ("Pe\u0301rez\u202egpj.exe.jpg", "Pérezgpj.exe", "Pérezgpj.exe.jpg"),
        ("x" * 300 + ".png", "x" * 160, "x" * 255),
        ("carpeta/", "image", "image.jpg"),
        ("", "image", "image.jpg"),
        (None, "image", "image.jpg"),
    ],
)
def test_upload_names_are_sanitised(filename: str | None, name: str, original: str) -> None:
    assert image_name(filename) == name
    assert original_filename(filename, "jpg") == original


def test_upload_names_come_from_the_file_name(admin: TestClient) -> None:
    body = uploaded(admin, data=image_bytes("PNG"), filename="vacaciones/2024/Primer día.png")
    assert body["name"] == "Primer día"
    assert stored(admin, body["id"]).original_filename == "Primer día.png"


def test_each_upload_purges_expired_pending_uploads(admin: TestClient, config: Settings) -> None:
    expired = image_row(expires_at=utcnow() - timedelta(minutes=5))

    async def add(db: AsyncSession) -> None:
        db.add(expired)
        await db.commit()

    run_db(admin, add)
    folder = add_folder(config.media_dir, expired.id)
    body = uploaded(admin)

    assert not folder.exists()

    async def ids(db: AsyncSession) -> list[uuid.UUID]:
        return list(await db.scalars(select(Image.id)))

    assert run_db(admin, ids) == [uuid.UUID(body["id"])]


def test_a_failed_write_leaves_neither_row_nor_files(
    config: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    write_file = media.write_file

    def failing(path: Any, content: Any) -> None:
        if path.name == "display.webp":
            raise OSError("disk full")
        write_file(path, content)

    monkeypatch.setattr(media, "write_file", failing)
    with app_client(config, raise_server_exceptions=False) as client:
        login_as(client, "admin")
        response = upload(client)
        assert (response.status_code, response.json()) == (500, {"code": "internal_error"})
        assert run_db(client, count_images) == 0
    assert not list(config.media_dir.iterdir())


# Serving ------------------------------------------------------------------------------------


def test_media_access_depends_on_role_and_image_state(client: TestClient) -> None:
    login_as(client, "admin")
    purposes = {
        "pending": "event",
        "avatar": "avatar",
        "background": "background",
        "live": "event",
        "trashed": "event",
    }
    ids = {name: uploaded(client, purpose)["id"] for name, purpose in purposes.items()}

    async def attach(db: AsyncSession) -> None:
        live, trashed = event_row(), event_row("Papelera", deleted=True)
        db.add_all([live, trashed])
        await db.flush()
        await attach_pending(db, [uuid.UUID(ids["avatar"])], purpose="avatar")
        await attach_pending(db, [uuid.UUID(ids["background"])], purpose="background")
        await attach_pending(db, [uuid.UUID(ids["live"])], purpose="event", event_id=live.id)
        await attach_pending(
            db, [uuid.UUID(ids["trashed"])], purpose="event", event_id=trashed.id
        )
        await db.commit()

    run_db(client, attach)
    viewer_sees = {
        "pending": False,
        "avatar": True,
        "background": True,
        "live": True,
        "trashed": False,
    }

    for role in ("admin", "viewer"):
        login_as(client, role)
        for name, image_id in ids.items():
            for kind in VARIANTS:
                response = client.get(f"/api/media/{image_id}/{kind}")
                if role == "admin" or viewer_sees[name]:
                    assert response.status_code == 200, (role, name, kind)
                else:
                    assert response.status_code == 404, (role, name, kind)
                    assert response.json() == {"code": "image_not_found"}

    client.cookies.clear()
    for image_id in ids.values():
        response = client.get(f"/api/media/{image_id}/thumb")
        assert (response.status_code, response.json()) == (
            401,
            {"code": "authentication_required"},
        )


def test_media_responses_are_private_immutable_webp_with_a_strong_etag(
    admin: TestClient, config: Settings
) -> None:
    image_id = uploaded(admin)["id"]
    url = f"/api/media/{image_id}/display"
    response = admin.get(url)

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    assert response.headers.get_list("cache-control") == [CACHE_CONTROL]
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.content == (config.media_dir / image_id / "display.webp").read_bytes()
    etag = response.headers["etag"]
    assert re.fullmatch(r'"[0-9a-f]{32}"', etag)
    assert admin.get(f"/api/media/{image_id}/thumb").headers["etag"] != etag

    for header in (etag, f"W/{etag}", f'"other", {etag}', "*"):
        cached = admin.get(url, headers={"if-none-match": header})
        assert cached.status_code == 304, header
        assert cached.content == b""
        assert cached.headers["etag"] == etag
        assert cached.headers.get_list("cache-control") == [CACHE_CONTROL]
    assert admin.get(url, headers={"if-none-match": '"other"'}).status_code == 200


def test_unknown_variants_images_and_missing_files_are_not_found(
    admin: TestClient, config: Settings
) -> None:
    image_id = uploaded(admin)["id"]
    for path in (
        f"/api/media/{image_id}/original",
        f"/api/media/{image_id}/original.jpg",
        f"/api/media/{image_id}/THUMB",
        f"/api/media/{image_id}/display.webp",
        f"/api/media/{uuid.uuid4()}/thumb",
    ):
        response = admin.get(path)
        assert (response.status_code, response.json()) == (404, {"code": "image_not_found"}), path
    assert admin.get("/api/media/not-a-uuid/thumb").json()["code"] == "invalid_request"

    shutil.rmtree(config.media_dir / image_id)
    response = admin.get(f"/api/media/{image_id}/thumb")
    assert (response.status_code, response.json()) == (404, {"code": "image_not_found"})
