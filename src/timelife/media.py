"""Images and videos: uploads, processing, storage, authenticated serving and the helpers other
modules use.

Every image lives in ``media_dir/<uuid>/``: ``original.<ext>`` (the uploaded bytes, never served),
``thumb.webp`` (512×512 centre crop) and ``display.webp`` (long edge ≤ 2048), both upright, sRGB
and without metadata. An event image with a thumbnail framing (``crops``) also gets
``thumb-<key>.webp``, rendered from ``display.webp`` the first time ``thumb?v=<key>`` is requested
and removed once the framing changes. Event uploads may also be videos (``kind`` "video": the
variants show a poster frame) and Live Photos (a photo with ``motion.<ext>``, its clip); both get
``video.mp4``, converted in the background by ``video.VideoJobs``. A new upload is *pending*
(``expires_at`` set, no event) until a module attaches it with ``attach_pending``;
``cleanup_orphans`` purges pending uploads once expired."""

import hashlib
import io
import logging
import os
import re
import shutil
import stat
import time
import unicodedata
import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import partial
from pathlib import Path as FilePath
from typing import Annotated, BinaryIO

import pillow_heif
from fastapi import APIRouter, File, Path, Query, Request, Response, UploadFile
from PIL import ExifTags, ImageCms, ImageFile
from PIL import Image as Pillow
from sqlalchemy import delete, event, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, SessionTransaction
from starlette.concurrency import run_in_threadpool
from starlette.responses import FileResponse

from . import crops, video
from .auth import DB, UNSYNCHRONIZED, AdminUser, CurrentUser, settings
from .config import Settings
from .contracts import ImageOut, ImagePurpose, MediaKind, UploadOut
from .db import Event, Image, utcnow
from .errors import AppError

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Media"])
admin_router = APIRouter(prefix="/api/admin", tags=["Media"])

PURPOSES: tuple[ImagePurpose, ...] = ("event", "avatar", "background")
PURPOSE_NAMES: dict[str, ImagePurpose] = {purpose: purpose for purpose in PURPOSES}
# WebP variants of every image; videos and Live Photos also have ``video`` (``video.mp4``).
VARIANTS = ("thumb", "display")
MEDIA_VARIANTS = (*VARIANTS, "video")
PENDING_LIFETIME = timedelta(hours=24)
MAX_PIXELS = 80_000_000
THUMB_SIZE = 512
DISPLAY_EDGE = 2048
THUMB_QUALITY = 80
DISPLAY_QUALITY = 82
NAME_LENGTH = 160
FILENAME_LENGTH = 255
CACHE_CONTROL = "private, max-age=31536000, immutable"
# Decoders tried on every upload, whatever its file name or declared type say. Multi-picture
# JPEGs (MPO, e.g. photos with a depth or gain map) open through the JPEG decoder.
DECODERS = ("JPEG", "PNG", "WEBP", "GIF", "HEIF")
# Pillow format → (extension of the stored original, content type).
FILE_TYPES = {
    "JPEG": ("jpg", "image/jpeg"),
    "MPO": ("jpg", "image/jpeg"),
    "PNG": ("png", "image/png"),
    "WEBP": ("webp", "image/webp"),
    "GIF": ("gif", "image/gif"),
    "HEIF": ("heic", "image/heic"),
}
# EXIF orientation → transposition that makes the image upright (as ImageOps.exif_transpose).
ORIENTATIONS = {
    2: Pillow.Transpose.FLIP_LEFT_RIGHT,
    3: Pillow.Transpose.ROTATE_180,
    4: Pillow.Transpose.FLIP_TOP_BOTTOM,
    5: Pillow.Transpose.TRANSPOSE,
    6: Pillow.Transpose.ROTATE_270,
    7: Pillow.Transpose.TRANSVERSE,
    8: Pillow.Transpose.ROTATE_90,
}
# Working modes (decoded images keep their colour space) → mode of their colour channels.
COLOUR_MODES = {"L": "L", "LA": "L", "RGB": "RGB", "RGBA": "RGB", "CMYK": "CMYK"}
# ICC profile colour space → colour mode it describes.
PROFILE_SPACES = {"GRAY": "L", "RGB": "RGB", "CMYK": "CMYK"}
PATH_SEPARATORS = re.compile(r"[\\/]")
EXTENSION = re.compile(r"[A-Za-z0-9]{1,10}")
BIDI_CONTROLS = frozenset(
    "\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"
)
REPLACE_ATTEMPTS = 5
# Session.info key: image folders to remove once the transaction that deleted their rows commits.
REMOVALS = "timelife.media.removals"

Removals = dict[SessionTransaction, list[tuple[FilePath, uuid.UUID]]]

pillow_heif.register_heif_opener(thumbnails=False, depth_images=False, aux_images=False)
Pillow.MAX_IMAGE_PIXELS = MAX_PIXELS


def image_out(image: Image) -> ImageOut:
    return ImageOut.model_validate(image)


def upload_out(image: Image, progress: float | None = None) -> UploadOut:
    out = UploadOut.model_validate(image)
    if progress is None or image.video_status != "processing":
        return out
    return out.model_copy(update={"progress": progress})


async def attach_pending(
    db: AsyncSession,
    ids: Sequence[uuid.UUID],
    *,
    purpose: str,
    event_id: int | None = None,
    keep: Collection[uuid.UUID] = (),
) -> list[Image]:
    """Attach the images ``ids`` (returned in that order) and flush; the caller commits.

    Each id must exist with ``purpose`` and be in ``keep`` (e.g. a child's current avatar), a
    pending upload, or an event image already attached to ``event_id``; duplicates or anything
    else raise 422 ``invalid_image`` before any change. Attaching clears ``expires_at`` and, for
    event images, sets ``event_id`` (required for ``purpose="event"``, refused otherwise)."""
    if purpose not in PURPOSES or (purpose == "event") != (event_id is not None):
        raise ValueError("event_id is required for event images and only for them")
    if not ids:
        return []
    if len(set(ids)) != len(ids):
        raise AppError("invalid_image", 422)
    rows = await db.scalars(
        select(Image)
        .where(Image.id.in_(ids))
        .order_by(Image.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    found = {image.id: image for image in rows}
    kept = set(keep)
    images: list[Image] = []
    for image_id in ids:
        image = found.get(image_id)
        if (
            image is None
            or image.purpose != purpose
            or not (
                image_id in kept
                or (image.expires_at is not None and image.event_id is None)
                or (event_id is not None and image.event_id == event_id)
            )
        ):
            raise AppError("invalid_image", 422)
        images.append(image)
    for image in images:
        image.expires_at = None
        if event_id is not None:
            image.event_id = event_id
    await db.flush()
    return images


async def delete_images(db: AsyncSession, images: Sequence[Image], media_dir: FilePath) -> None:
    """Delete the image rows in the current transaction; their ``media_dir/<id>/`` folders are
    removed only once that transaction commits (a rollback keeps them). Loaded relationship
    collections (e.g. ``Event.images``) are not updated: reload them before reuse."""
    ids = list(dict.fromkeys(image.id for image in images))
    if not ids:
        return
    await db.execute(delete(Image).where(Image.id.in_(ids)))
    remove_after_commit(db.sync_session, media_dir, ids)


def delete_image_files(media_dir: FilePath, image_id: uuid.UUID) -> None:
    video.cancel(media_dir, image_id)
    folder = media_dir / str(image_id)
    shutil.rmtree(folder, ignore_errors=True)
    if folder.exists():
        log.warning("Image folder could not be fully removed")


async def cleanup_orphans(db: AsyncSession, media_dir: FilePath) -> int:
    """Purge expired pending uploads (rows + folders) and commit; returns how many were removed.

    Called by ``app.create_app`` at startup (keep this signature) and on each upload."""
    expired = await db.scalars(
        delete(Image)
        .where(
            Image.expires_at.is_not(None),
            Image.expires_at < utcnow(),
            Image.event_id.is_(None),
        )
        .returning(Image.id),
        execution_options=UNSYNCHRONIZED,
    )
    ids = list(expired)
    remove_after_commit(db.sync_session, media_dir, ids)
    await db.commit()
    return len(ids)


def remove_after_commit(session: Session, media_dir: FilePath, ids: Sequence[uuid.UUID]) -> None:
    """Remove the folders of ``ids`` when the session's current (possibly nested) transaction is
    committed up to the root; forget them if any transaction on the way ends without committing."""
    if not ids:
        return
    transaction = session.get_nested_transaction() or session.get_transaction()
    if transaction is None:
        raise RuntimeError("remove_after_commit needs an active transaction")
    removals: Removals = session.info.setdefault(REMOVALS, {})
    removals.setdefault(transaction, []).extend((media_dir, image_id) for image_id in ids)


@event.listens_for(Session, "after_commit")
def _remove_committed_folders(session: Session) -> None:
    removals: Removals | None = session.info.get(REMOVALS)
    if not removals:
        return
    # Still the committing transaction: it is closed only after this hook.
    transaction = session.get_nested_transaction() or session.get_transaction()
    if transaction is None:
        return
    folders = removals.pop(transaction, [])
    if transaction.nested and transaction.parent is not None:
        # A released savepoint: the enclosing transaction may still roll back.
        removals.setdefault(transaction.parent, []).extend(folders)
        return
    for media_dir, image_id in folders:
        delete_image_files(media_dir, image_id)


@event.listens_for(Session, "after_transaction_end")
def _forget_uncommitted_folders(session: Session, transaction: SessionTransaction) -> None:
    removals: Removals | None = session.info.get(REMOVALS)
    if removals:
        removals.pop(transaction, None)


# Processing (worker threads) ----------------------------------------------------------------


@dataclass(frozen=True)
class Processed:
    """A validated upload: metadata and the encoded ``thumb``/``display`` WebP variants."""

    extension: str
    content_type: str
    byte_size: int
    width: int
    height: int
    dominant_color: str
    thumb: bytes
    display: bytes


def process_upload(source: BinaryIO, max_bytes: int) -> Processed:
    """Identify, check and decode an upload and render its variants. 422 ``unsupported_image``
    or ``image_dimensions_too_large``, 413 ``upload_too_large``."""
    source.seek(0, os.SEEK_END)
    byte_size = source.tell()
    source.seek(0)
    # Identified first (headers only), so a body that is no image at all says so.
    picture = open_picture(source)
    if byte_size > max_bytes:
        raise AppError("upload_too_large", 413)
    extension, content_type = file_type(picture)
    working, upright, profile = decode(picture)
    del picture
    display, thumb = variants(working, upright, profile)
    del working
    return encoded(display, thumb, extension, content_type, byte_size)


def render_poster(frame: bytes, info: video.VideoInfo, byte_size: int) -> Processed:
    """The variants of a video's poster frame (PNG); the other values describe the video."""
    working, upright, profile = decode(open_picture(io.BytesIO(frame)))
    display, thumb = variants(working, upright, profile)
    return encoded(display, thumb, info.extension, info.content_type, byte_size)


def variants(
    working: Pillow.Image, upright: Pillow.Transpose | None, profile: bytes | None
) -> tuple[Pillow.Image, Pillow.Image]:
    """The display and thumbnail images of a decoded picture."""
    transform = srgb_transform(profile, working.mode)
    return (
        finish(scaled(working), upright, transform),
        finish(square(working), upright, transform),
    )


def encoded(
    display: Pillow.Image, thumb: Pillow.Image, extension: str, content_type: str, byte_size: int
) -> Processed:
    return Processed(
        extension=extension,
        content_type=content_type,
        byte_size=byte_size,
        width=display.width,
        height=display.height,
        dominant_color=dominant_color(display),
        thumb=webp(thumb, THUMB_QUALITY),
        display=webp(display, DISPLAY_QUALITY),
    )


def open_picture(source: BinaryIO) -> ImageFile.ImageFile:
    """Open ``source`` with the accepted decoders only and check its dimensions."""
    try:
        picture = Pillow.open(source, formats=DECODERS)
    except (Pillow.DecompressionBombError, Pillow.DecompressionBombWarning):
        raise AppError("image_dimensions_too_large") from None
    except MemoryError:
        raise
    except Exception:
        raise AppError("unsupported_image") from None
    if picture.format not in FILE_TYPES or min(picture.size) < 1:
        raise AppError("unsupported_image")
    if picture.width * picture.height > MAX_PIXELS:
        raise AppError("image_dimensions_too_large")
    return picture


def file_type(picture: ImageFile.ImageFile) -> tuple[str, str]:
    """Extension and content type of the uploaded file, from its decoded format."""
    if picture.format == "HEIF" and picture.get_format_mimetype() == "image/heif":
        return "heif", "image/heif"
    return FILE_TYPES[picture.format or ""]


def decode(
    picture: ImageFile.ImageFile,
) -> tuple[Pillow.Image, Pillow.Transpose | None, bytes | None]:
    """Decode the first frame (large JPEGs at a reduced scale) into a working mode that keeps its
    colour space, with the transposition that makes it upright and its embedded ICC profile."""
    try:
        if picture.format in ("JPEG", "MPO"):
            # The decoder may scale down by 2, 4 or 8 while both edges stay at least this big:
            # the display size, and the thumbnail size for the short edge.
            width, height = display_size(picture.size)
            picture.draft(
                None,
                (
                    max(width, min(THUMB_SIZE, picture.width)),
                    max(height, min(THUMB_SIZE, picture.height)),
                ),
            )
        picture.load()
        profile = picture.info.get("icc_profile")
        return (
            working_mode(picture),
            ORIENTATIONS.get(orientation(picture)),
            profile if isinstance(profile, bytes) and profile else None,
        )
    except (Pillow.DecompressionBombError, Pillow.DecompressionBombWarning):
        raise AppError("image_dimensions_too_large") from None
    except MemoryError:
        raise
    except Exception:
        raise AppError("unsupported_image") from None


def orientation(picture: Pillow.Image) -> int:
    """EXIF (or XMP) orientation; 1 when absent or unreadable."""
    try:
        value = picture.getexif().get(ExifTags.Base.Orientation, 1)
    except Exception:  # malformed metadata never blocks an upload
        return 1
    return value if isinstance(value, int) else 1


def working_mode(image: Pillow.Image) -> Pillow.Image:
    """``image`` as L, LA, RGB, RGBA or CMYK (alpha kept when the image has transparency)."""
    mode = image.mode
    transparent = image.has_transparency_data
    if mode in COLOUR_MODES and not (transparent and mode in ("L", "RGB")):
        return image
    if mode.startswith("I;16") or mode in ("I", "F"):
        # 16-bit samples: scale to 8 bits (a plain conversion would clip them).
        wide = image if mode in ("I", "F") else image.convert("I")
        return wide.point(lambda value: value / 257).convert("L")
    if mode in ("1", "L", "La"):
        return image.convert("LA" if transparent else "L")
    return image.convert("RGBA" if transparent else "RGB")


def srgb_transform(profile: bytes | None, mode: str) -> ImageCms.ImageCmsTransform | None:
    """Colour transform from the embedded ICC ``profile`` to sRGB for the colour channels of
    ``mode``; None without a usable profile (the pixels are then taken as sRGB)."""
    if profile is None:
        return None
    colours = COLOUR_MODES[mode]
    try:
        source = ImageCms.ImageCmsProfile(io.BytesIO(profile))
        if PROFILE_SPACES.get(source.profile.xcolor_space.strip()) != colours:
            return None
        return ImageCms.buildTransform(
            source,
            ImageCms.createProfile("sRGB"),
            colours,
            "RGB",
            renderingIntent=ImageCms.Intent.PERCEPTUAL,
        )
    except (ImageCms.PyCMSError, OSError, ValueError, TypeError):
        log.info("Ignoring an unusable ICC profile")
        return None


def display_size(size: tuple[int, int]) -> tuple[int, int]:
    """``size`` shrunk to a long edge of at most DISPLAY_EDGE pixels (never enlarged)."""
    width, height = size
    longest = max(width, height)
    if longest <= DISPLAY_EDGE:
        return width, height
    ratio = DISPLAY_EDGE / longest
    return max(1, round(width * ratio)), max(1, round(height * ratio))


def scaled(image: Pillow.Image) -> Pillow.Image:
    size = display_size(image.size)
    if size == image.size:
        return image
    return image.resize(size, Pillow.Resampling.LANCZOS, reducing_gap=3.0)


def square(image: Pillow.Image) -> Pillow.Image:
    """THUMB_SIZE × THUMB_SIZE centre crop of ``image`` (enlarged when smaller)."""
    width, height = image.size
    side = min(width, height)
    left, top = (width - side) / 2, (height - side) / 2
    return image.resize(
        (THUMB_SIZE, THUMB_SIZE),
        Pillow.Resampling.LANCZOS,
        box=(left, top, left + side, top + side),
        reducing_gap=3.0,
    )


def finish(
    image: Pillow.Image,
    upright: Pillow.Transpose | None,
    transform: ImageCms.ImageCmsTransform | None,
) -> Pillow.Image:
    """Upright sRGB ``RGB``/``RGBA`` copy of a working-mode image, without any metadata.
    (Cropping and scaling commute with the EXIF transpositions, so they run first.)"""
    if upright is not None:
        image = image.transpose(upright)
    alpha = image.getchannel("A") if image.mode in ("LA", "RGBA") else None
    colours = image.convert(COLOUR_MODES[image.mode]) if alpha is not None else image
    result = transform.apply(colours) if transform is not None else colours.convert("RGB")
    if alpha is not None:
        result.putalpha(alpha)
    result.info.clear()
    return result


def dominant_color(image: Pillow.Image) -> str:
    """Average colour of ``image`` (weighted by opacity) as ``#rrggbb``."""
    pixel = image.resize((1, 1), Pillow.Resampling.BOX).getpixel((0, 0))
    assert isinstance(pixel, tuple)
    red, green, blue = pixel[:3]
    return f"#{red:02x}{green:02x}{blue:02x}"


def webp(image: Pillow.Image, quality: int) -> bytes:
    """Lossy WebP; Pillow only embeds metadata passed explicitly to ``save``."""
    buffer = io.BytesIO()
    image.save(buffer, "WEBP", quality=quality, method=4)
    return buffer.getvalue()


def store_files(
    folder: FilePath,
    source: BinaryIO | FilePath,
    processed: Processed,
    moves: Mapping[str, FilePath] | None = None,
) -> None:
    """Create ``folder`` with the original and both variants, each written atomically; a staged
    original (a path in ``media_dir``) and the staged ``moves`` (name → path, e.g. a Live Photo's
    clip) are moved in. The folder is removed again on any failure."""
    folder.mkdir(parents=True)
    try:
        original = folder / f"original.{processed.extension}"
        if isinstance(source, FilePath):
            os.replace(source, original)
        else:
            source.seek(0)
            write_file(original, source)
        for name, path in (moves or {}).items():
            os.replace(path, folder / name)
        write_file(folder / "thumb.webp", processed.thumb)
        write_file(folder / "display.webp", processed.display)
        sync_directory(folder)
        sync_directory(folder.parent)
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise


def write_file(path: FilePath, content: bytes | BinaryIO, *, unique: bool = False) -> None:
    """Write to a temporary name, flush it to disk, then rename it into place. ``unique``
    temporary names let concurrent writers of the same file each finish (the last one wins)."""
    token = f".{uuid.uuid4().hex}" if unique else ""
    partial = path.with_name(f".{path.name}{token}.partial")
    with open(partial, "xb") as handle:
        if isinstance(content, bytes):
            handle.write(content)
        else:
            shutil.copyfileobj(content, handle)
        handle.flush()
        os.fsync(handle.fileno())
    for attempt in range(REPLACE_ATTEMPTS):
        try:
            os.replace(partial, path)
            return
        except PermissionError:
            # Windows: a virus scanner may briefly hold a file that was just written.
            if attempt == REPLACE_ATTEMPTS - 1:
                raise
            time.sleep(0.05 * (attempt + 1))


def sync_directory(path: FilePath) -> None:
    """Best-effort fsync of a directory's entries (POSIX only)."""
    if os.name != "posix":
        return
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)


# Videos and Live Photos (worker threads) ----------------------------------------------------


class Staging:
    """A staging folder in ``media_dir/.incoming``, created on first use."""

    def __init__(self, media_dir: FilePath) -> None:
        self.media_dir = media_dir
        self.folder: FilePath | None = None

    def directory(self) -> FilePath:
        if self.folder is None:
            self.folder = video.staging_folder(self.media_dir)
        return self.folder

    def path(self, name: str) -> FilePath:
        return self.directory() / name

    def remove(self) -> None:
        if self.folder is not None:
            shutil.rmtree(self.folder, ignore_errors=True)


@dataclass(frozen=True)
class Prepared:
    """An identified upload, ready to be stored."""

    processed: Processed
    # The original to store: the upload itself or a staged file.
    original: BinaryIO | FilePath
    kind: MediaKind = "image"
    duration: float | None = None
    # The staged clip of a Live Photo and the name it is stored under (``motion.<ext>``).
    motion: tuple[FilePath, str] | None = None
    # Name of the stored original when it is not the uploaded file (a ``.livp``'s photo).
    original_filename: str | None = None


def byte_size(source: BinaryIO) -> int:
    source.seek(0, os.SEEK_END)
    size = source.tell()
    source.seek(0)
    return size


def live_motion(
    source: BinaryIO | FilePath, staging: Staging, config: Settings
) -> tuple[FilePath, video.VideoInfo]:
    """Stage and check a Live Photo's clip: 422 ``invalid_live_photo`` unless it is a video of at
    most ``video.LIVE_MOTION_SECONDS``; 413 ``upload_too_large`` beyond the video limit."""
    if isinstance(source, FilePath):
        path = source
    else:
        if not video.looks_like_video(source):
            raise AppError("invalid_live_photo")
        if byte_size(source) > config.max_video_upload_bytes:
            raise AppError("upload_too_large", 413)
        path = staging.path("motion-source")
        video.stage(source, path)
    try:
        info = video.probe(path)
    except AppError as error:
        if error.code == "unsupported_video":
            raise AppError("invalid_live_photo") from None
        raise
    if info.duration > video.LIVE_MOTION_SECONDS:
        raise AppError("invalid_live_photo")
    return path, info


def prepare_upload(
    source: BinaryIO,
    motion: BinaryIO | FilePath | None,
    *,
    event: bool,
    config: Settings,
    staging: Staging,
    staged: FilePath | None = None,
) -> Prepared:
    """Identify an upload: a photo; for events also a video, a Live Photo (photo + ``motion``)
    or an iCloud ``.livp``. ``staged``: the file ``source`` reads when it already is in
    ``media_dir`` (it is then moved in, never copied). 422 ``unsupported_media`` (events) /
    ``unsupported_image``, ``unsupported_video``, ``video_too_long``, ``invalid_live_photo``…;
    413 ``upload_too_large``; 503 ``video_unavailable`` without ffmpeg."""
    original: BinaryIO | FilePath = source if staged is None else staged
    if motion is not None:
        processed = process_upload(source, config.max_upload_bytes)
        path, info = live_motion(motion, staging, config)
        return Prepared(
            processed, original, duration=info.duration, motion=(path, f"motion.{info.extension}")
        )
    if event and video.is_zip(source):
        files = video.extract_livp(
            source, staging.directory(), config.max_upload_bytes, config.max_video_upload_bytes
        )
        with open(files.still, "rb") as still:
            processed = process_upload(still, config.max_upload_bytes)
        path, info = live_motion(files.motion, staging, config)
        return Prepared(
            processed,
            files.still,
            duration=info.duration,
            motion=(path, f"motion.{info.extension}"),
            original_filename=files.still_name,
        )
    try:
        return Prepared(process_upload(source, config.max_upload_bytes), original)
    except AppError as error:
        if not event or error.code != "unsupported_image":
            raise
        if not video.looks_like_video(source):
            raise AppError("unsupported_media") from None
    size = byte_size(source)
    if size > config.max_video_upload_bytes:
        raise AppError("upload_too_large", 413)
    if staged is None:
        staged = staging.path("source")
        video.stage(source, staged)
    info = video.probe(staged)
    if info.duration > config.max_video_seconds:
        raise AppError("video_too_long")
    frame = video.poster(staged, info, DISPLAY_EDGE)
    return Prepared(render_poster(frame, info, size), staged, kind="video", duration=info.duration)


# Framed thumbnails --------------------------------------------------------------------------


def framed_thumb_name(key: str) -> str:
    return f"thumb-{key}.webp"


def render_framed_thumb(folder: FilePath, framing: crops.Framing) -> None:
    """Write ``thumb-<key>.webp`` in ``folder``: the framing's square of ``display.webp`` (already
    upright sRGB without metadata) at the thumbnail size."""
    with Pillow.open(folder / "display.webp", formats=["WEBP"]) as picture:
        picture.load()
        box = crops.box(framing, picture.width, picture.height)
        thumb = picture.resize(
            (THUMB_SIZE, THUMB_SIZE), Pillow.Resampling.LANCZOS, box=box, reducing_gap=3.0
        )
    thumb.info.clear()
    write_file(
        folder / framed_thumb_name(crops.key(framing)), webp(thumb, THUMB_QUALITY), unique=True
    )


def prune_framed_thumbs(media_dir: FilePath, current: Mapping[uuid.UUID, str | None]) -> None:
    """Delete the framed thumbnails of these images except their ``current`` key's (best effort)."""
    for image_id, key in current.items():
        keep = None if key is None else framed_thumb_name(key)
        try:
            for path in (media_dir / str(image_id)).glob("thumb-*.webp"):
                if path.name != keep:
                    path.unlink(missing_ok=True)
        except OSError as error:
            log.warning("Old framed thumbnails not removed (%s)", type(error).__name__)


# Names --------------------------------------------------------------------------------------


def clean_text(value: str) -> str:
    """NFC text without control or bidirectional-formatting characters, whitespace collapsed."""
    characters = (
        ""
        if character in BIDI_CONTROLS or unicodedata.category(character) == "Cs"
        else " "
        if unicodedata.category(character) == "Cc"
        else character
        for character in unicodedata.normalize("NFC", value)
    )
    return " ".join("".join(characters).split())


def file_name(filename: str | None) -> str:
    """Last path segment of the client's file name, cleaned."""
    return clean_text(PATH_SEPARATORS.split(filename or "")[-1])


def image_name(filename: str | None) -> str:
    """Display name of an upload: its file name without folders or extension (≤ 160
    characters), or "image"."""
    name = file_name(filename)
    stem, dot, extension = name.rpartition(".")
    if dot and stem.strip() and EXTENSION.fullmatch(extension):
        name = stem
    return name[:NAME_LENGTH].strip() or "image"


def original_filename(filename: str | None, extension: str) -> str:
    return file_name(filename)[:FILENAME_LENGTH].strip() or f"image.{extension}"


# Serving ------------------------------------------------------------------------------------


def visible_to_viewers(
    purpose: str, expires_at: datetime | None, event_id: int | None, deleted_at: datetime | None
) -> bool:
    """Non-administrators see attached avatars/backgrounds and images of live events only."""
    if expires_at is not None:
        return False
    if purpose == "event":
        return event_id is not None and deleted_at is None
    return True


def entity_tag(image_id: uuid.UUID, variant: str, status: os.stat_result) -> str:
    key = f"{image_id}/{variant}/{status.st_size}/{status.st_mtime_ns}"
    return f'"{hashlib.sha256(key.encode()).hexdigest()[:32]}"'


def none_match(values: list[str], tag: str) -> bool:
    """Whether ``If-None-Match`` header values match ``tag`` (weak comparison, RFC 9110)."""
    candidates = {item.strip().removeprefix("W/") for value in values for item in value.split(",")}
    return "*" in candidates or tag in candidates


# Storing uploads ----------------------------------------------------------------------------


def prepare_source(
    source: BinaryIO | FilePath,
    motion: BinaryIO | FilePath | None,
    *,
    event: bool,
    config: Settings,
    staging: Staging,
) -> Prepared:
    """``prepare_upload`` of an upload or of a file already staged in ``media_dir`` (read here and
    closed again before it is moved in)."""
    if isinstance(source, FilePath):
        with open(source, "rb") as handle:
            return prepare_upload(
                handle, motion, event=event, config=config, staging=staging, staged=source
            )
    return prepare_upload(source, motion, event=event, config=config, staging=staging)


async def store_upload(
    db: AsyncSession,
    config: Settings,
    jobs: video.VideoJobs,
    *,
    purpose: ImagePurpose,
    source: BinaryIO | FilePath,
    filename: str | None,
    motion: BinaryIO | FilePath | None = None,
    uploaded_by_id: int | None = None,
    lifetime: timedelta = PENDING_LIFETIME,
) -> Image:
    """Identify an upload and store it as a pending image of ``purpose`` that expires after
    ``lifetime``: the row is committed first, then its files are written; a video or Live Photo
    is queued for conversion. ``source``/``motion`` may be files already staged in ``media_dir``
    (moved in, not copied). Same errors as ``prepare_upload``."""
    staging = Staging(config.media_dir)
    try:
        prepared = await run_in_threadpool(
            partial(
                prepare_source,
                source,
                motion,
                event=purpose == "event",
                config=config,
                staging=staging,
            )
        )
        processed = prepared.processed
        converts = prepared.kind == "video" or prepared.motion is not None
        now = utcnow()
        image = Image(
            id=uuid.uuid4(),
            purpose=purpose,
            kind=prepared.kind,
            name=image_name(filename),
            original_filename=original_filename(
                prepared.original_filename or filename, processed.extension
            ),
            original_ext=processed.extension,
            content_type=processed.content_type,
            byte_size=processed.byte_size,
            width=processed.width,
            height=processed.height,
            dominant_color=processed.dominant_color,
            position=0,
            video_status="processing" if converts else None,
            duration=prepared.duration,
            live=prepared.motion is not None,
            uploaded_by_id=uploaded_by_id,
            created_at=now,
            expires_at=now + lifetime,
        )
        db.add(image)
        # The pending row goes first: if the process dies while the files are written, the row
        # expires and cleanup_orphans removes whatever was written.
        await db.commit()
        moves = {} if prepared.motion is None else {prepared.motion[1]: prepared.motion[0]}
        try:
            await run_in_threadpool(
                store_files,
                config.media_dir / str(image.id),
                prepared.original,
                processed,
                moves,
            )
        except Exception:
            try:
                await delete_images(db, [image], config.media_dir)
                await db.commit()
            except SQLAlchemyError as error:
                log.error("Failed upload not removed (%s); it expires", type(error).__name__)
            raise
    finally:
        await run_in_threadpool(staging.remove)
    if converts:
        jobs.enqueue(image.id)
    return image


# Routes -------------------------------------------------------------------------------------


def video_jobs(request: Request) -> video.VideoJobs:
    jobs: video.VideoJobs = request.app.state.video_jobs
    return jobs


@admin_router.post("/uploads", response_model=UploadOut, status_code=201)
async def upload_image(
    request: Request,
    admin: AdminUser,
    db: DB,
    purpose: Annotated[str, Query(json_schema_extra={"enum": list(PURPOSES)})],
    file: Annotated[UploadFile, File()],
    motion: Annotated[UploadFile | None, File()] = None,
) -> UploadOut:
    # Stores a pending upload of ``purpose`` (to be attached within 24 hours). Event uploads may
    # also be videos, Live Photos (the photo in ``file`` and its clip in ``motion``) or iCloud
    # ``.livp`` files: their MP4 is converted afterwards (``video_status`` "processing"; poll
    # ``GET /api/admin/uploads/{id}``). No docstring: it would become part of the OpenAPI
    # contract.
    kind = PURPOSE_NAMES.get(purpose)
    if kind is None:
        raise AppError("invalid_purpose", 422)
    if motion is not None and kind != "event":
        raise AppError("invalid_live_photo", 422)
    config = settings(request)
    jobs = video_jobs(request)
    image = await store_upload(
        db,
        config,
        jobs,
        purpose=kind,
        source=file.file,
        filename=file.filename,
        motion=None if motion is None else motion.file,
        uploaded_by_id=admin.id,
    )
    try:
        await cleanup_orphans(db, config.media_dir)
        await run_in_threadpool(video.remove_stale_staging, config.media_dir)
    except (SQLAlchemyError, OSError) as error:
        log.warning("Orphan image cleanup failed (%s)", type(error).__name__)
    return upload_out(image, jobs.progress(image.id))


@admin_router.get("/uploads/{image_id}", response_model=UploadOut)
async def get_upload(image_id: uuid.UUID, request: Request, admin: AdminUser, db: DB) -> UploadOut:
    # Any image, pending or attached: poll it while its ``video_status`` is "processing".
    image = await db.scalar(select(Image).where(Image.id == image_id))
    if image is None:
        raise AppError("image_not_found", 404)
    return upload_out(image, video_jobs(request).progress(image.id))


@router.get(
    "/media/{image_id}/{variant}",
    response_class=Response,
    responses={
        200: {
            "description": "WebP image (thumb, display) or MP4 video (video)",
            "content": {
                "image/webp": {"schema": {"type": "string", "format": "binary"}},
                "video/mp4": {"schema": {"type": "string", "format": "binary"}},
            },
        },
        206: {
            "description": "Requested byte range of the MP4 video",
            "content": {"video/mp4": {"schema": {"type": "string", "format": "binary"}}},
        },
    },
)
async def get_media(
    image_id: uuid.UUID,
    variant: Annotated[str, Path(json_schema_extra={"enum": list(MEDIA_VARIANTS)})],
    request: Request,
    user: CurrentUser,
    db: DB,
    v: Annotated[str | None, Query(pattern=r"^[0-9a-f]{12}$")] = None,
) -> Response:
    # Viewers get attached avatars/backgrounds and images of live events; administrators also
    # pending uploads and images of deleted events; anything else is 404 image_not_found.
    # ``v`` (thumbnails only): the framing key of the image's ``thumb_url``. ``video``: the MP4
    # of a video or Live Photo once ready (byte ranges supported); viewers only get a Live
    # Photo's clip while it is shown (``live``).
    if variant not in MEDIA_VARIANTS or (v is not None and variant != "thumb"):
        raise AppError("image_not_found", 404)
    row = (
        await db.execute(
            select(
                Image.purpose,
                Image.expires_at,
                Event.id,
                Event.deleted_at,
                Image.crop_x,
                Image.crop_y,
                Image.crop_zoom,
                Image.kind,
                Image.video_status,
                Image.live,
            )
            .outerjoin(Event, Event.id == Image.event_id)
            .where(Image.id == image_id)
        )
    ).one_or_none()
    if row is None or not (user.is_admin or visible_to_viewers(*row[:4])):
        raise AppError("image_not_found", 404)
    folder = settings(request).media_dir / str(image_id)
    if variant == "video":
        kind, video_status, live = row[7:]
        if video_status != "ready" or not (user.is_admin or kind == "video" or live):
            raise AppError("image_not_found", 404)
        return await send_file(request, image_id, folder / "video.mp4", "video", "video/mp4")
    tag_variant = variant if v is None else f"thumb-{v}"
    path = folder / f"{tag_variant}.webp"
    crop_x, crop_y, crop_zoom = row[4:7]
    framing = None if crop_x is None or crop_y is None or crop_zoom is None else (
        crop_x, crop_y, crop_zoom
    )
    if (
        v is not None
        and framing is not None
        and crops.key(framing) == v
        and not await run_in_threadpool(path.exists)
    ):
        # The image's current framing: its thumbnail is rendered the first time it is asked for.
        try:
            await run_in_threadpool(render_framed_thumb, folder, framing)
        except (OSError, ValueError) as error:
            log.warning("Framed thumbnail not rendered (%s)", type(error).__name__)
            raise AppError("image_not_found", 404) from None
    return await send_file(request, image_id, path, tag_variant, "image/webp")


async def send_file(
    request: Request, image_id: uuid.UUID, path: FilePath, tag_variant: str, media_type: str
) -> Response:
    """A stored variant with its ETag (304 when it matches) and long-lived private caching;
    ``FileResponse`` answers byte ranges (206)."""
    try:
        status = await run_in_threadpool(os.stat, path)
    except OSError:
        raise AppError("image_not_found", 404) from None
    if not stat.S_ISREG(status.st_mode):
        raise AppError("image_not_found", 404)
    tag = entity_tag(image_id, tag_variant, status)
    headers = {"Cache-Control": CACHE_CONTROL, "ETag": tag}
    if none_match(request.headers.getlist("if-none-match"), tag):
        return Response(status_code=304, headers=headers)
    return FileResponse(path, media_type=media_type, headers=headers, stat_result=status)
