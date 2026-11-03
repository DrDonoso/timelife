"""Export of the whole timeline as one ZIP (format in ``backup_format``), streamed as it is written.

``snapshot`` reads everything in one database session and a worker thread lays out the archive
paths (checking the files on disk). A dedicated thread then writes the archive into a ``Pipe``,
an unseekable file whose pieces a ``StreamingResponse`` sends: the download starts at once,
nothing is staged on disk, the writer waits while the client is slow and stops when it goes away.
The manifest is written last, from what really went into the archive: a file that vanished
meanwhile is left out of it."""

import asyncio
import datetime as dt
import io
import json
import logging
import shutil
import threading
import uuid
import zipfile
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from . import appearance, events, video
from .backup_format import (
    APPEARANCE_FOLDER,
    FORMAT,
    MANIFEST_NAME,
    README_NAME,
    VERSION,
    Layout,
    readme,
)
from .contracts import BackupSummaryOut
from .db import AppSetting, Category, Child, Event, Image, User, YearColor, aware, utcnow
from .seed import SEEDED_CATEGORIES_KEY

log = logging.getLogger(__name__)

PIECE_BYTES = 1024 * 1024
QUEUED_PIECES = 8
COPY_BYTES = 1024 * 1024
SEND_POLL_SECONDS = 0.5


class ExportStopped(Exception):
    """The client went away: the writer thread stops."""


# Snapshot -----------------------------------------------------------------------------------


def stamp(value: dt.datetime | None) -> str | None:
    return None if value is None else aware(value).isoformat()


@dataclass(frozen=True)
class ImageRow:
    """What the export needs of an image row (plain values: worker threads read them)."""

    id: uuid.UUID
    kind: str
    name: str
    original_filename: str
    original_ext: str
    crop: dict[str, float] | None
    live: bool
    live_photo: bool
    uploaded_by: str | None
    created_at: str | None

    @classmethod
    def of(cls, image: Image, emails: dict[int, str]) -> "ImageRow":
        return cls(
            id=image.id,
            kind=image.kind,
            name=image.name,
            original_filename=image.original_filename,
            original_ext=image.original_ext,
            crop=image.crop,
            live=image.live,
            live_photo=image.is_live_photo,
            uploaded_by=None if image.uploaded_by_id is None else emails.get(image.uploaded_by_id),
            created_at=stamp(image.created_at),
        )


@dataclass
class Rows:
    """Everything to export, read in one database session."""

    exported_at: dt.datetime
    app_version: str
    users: list[dict[str, Any]]
    categories: list[dict[str, Any]]
    children: list[tuple[dict[str, Any], ImageRow | None]]
    events: list[tuple[dict[str, Any], list[ImageRow], uuid.UUID | None, bool]]
    year_colors: list[dict[str, Any]]
    settings: dict[str, Any]
    background: ImageRow | None


@dataclass
class MediaFile:
    """A photo or video to export: its manifest entry and its files (on disk → in the archive)."""

    entry: dict[str, Any]
    source: Path
    path: str
    motion_source: Path | None = None
    motion_path: str | None = None
    written: bool = False


@dataclass
class Snapshot:
    """The archive to write: manifest sections and the files, in archive order."""

    rows: Rows
    children: list[tuple[dict[str, Any], MediaFile | None]] = field(default_factory=list)
    events: list[tuple[dict[str, Any], list[MediaFile], MediaFile | None]] = field(
        default_factory=list
    )
    background: MediaFile | None = None
    files: list[MediaFile] = field(default_factory=list)

    def manifest(self) -> dict[str, Any]:
        """The manifest of what was written (media whose file vanished are left out)."""

        def entry(media: MediaFile | None) -> dict[str, Any] | None:
            if media is None or not media.written:
                return None
            return {**media.entry, "file": media.path, "motion": media.motion_path}

        event_entries = []
        for data, images, cover in self.events:
            written = [image for image in images if image.written]
            event_entries.append(
                {
                    **data,
                    "images": [entry(image) for image in written],
                    "cover": next(
                        (index for index, image in enumerate(written) if image is cover), None
                    ),
                }
            )
        return {
            "format": FORMAT,
            "version": VERSION,
            "exported_at": self.rows.exported_at.isoformat(),
            "app_version": self.rows.app_version,
            "users": self.rows.users,
            "categories": self.rows.categories,
            "children": [{**data, "avatar": entry(avatar)} for data, avatar in self.children],
            "events": event_entries,
            "year_colors": self.rows.year_colors,
            "settings": {**self.rows.settings, "background": entry(self.background)},
        }

    def counts(self) -> list[tuple[str, int]]:
        written = [media for _, images, _ in self.events for media in images if media.written]
        return [
            ("events", len(self.events)),
            ("photos/videos", len(written)),
            ("children", len(self.children)),
            ("categories", len(self.rows.categories)),
            ("users", len(self.rows.users)),
        ]


async def read_rows(db: AsyncSession, app_version: str) -> Rows:
    users = list(await db.scalars(select(User).order_by(User.id)))
    emails = {user.id: user.email for user in users}
    categories = list(await db.scalars(select(Category).order_by(Category.sort_order, Category.id)))
    children = list(
        await db.scalars(
            select(Child).options(selectinload(Child.avatar)).order_by(Child.sort_order, Child.id)
        )
    )
    rows = await db.scalars(
        select(Event)
        .options(*events.DETAIL)
        .order_by(Event.date, Event.day_order, Event.created_at.desc(), Event.id.desc())
    )
    event_rows: list[tuple[dict[str, Any], list[ImageRow], uuid.UUID | None, bool]] = []
    for event in rows:
        images = [
            ImageRow.of(image, emails)
            for image in sorted(event.images, key=lambda item: item.position)
            if image.expires_at is None
        ]
        data = {
            "id": event.id,
            "title": event.title,
            "date": event.date.isoformat(),
            "day_order": event.day_order,
            "notes": event.notes,
            "location": event.location,
            "child_ids": sorted(event.child_ids),
            "category_ids": event.category_ids,
            "version": event.version,
            "created_at": stamp(event.created_at),
            "updated_at": stamp(event.updated_at),
            "deleted_at": stamp(event.deleted_at),
            "created_by": emails.get(event.created_by_id or 0),
            "updated_by": emails.get(event.updated_by_id or 0),
            "deleted_by": emails.get(event.deleted_by_id or 0),
        }
        event_rows.append((data, images, event.cover_image_id, event.deleted_at is not None))
    stored = await appearance.stored_settings(db)
    background = await appearance.background_image(
        db, appearance.background_id(stored.get(appearance.BACKGROUND_KEY))
    )
    marker = await db.get(AppSetting, SEEDED_CATEGORIES_KEY)
    seeded = marker.value if marker is not None and isinstance(marker.value, list) else []
    settings: dict[str, Any] = {
        "background_opacity": appearance.opacity(stored[appearance.OPACITY_KEY])
        if appearance.OPACITY_KEY in stored
        else None,
        "default_zoom": appearance.zoom(stored[appearance.ZOOM_KEY])
        if appearance.ZOOM_KEY in stored
        else None,
        "direction_desktop": appearance.direction(
            stored[appearance.DESKTOP_DIRECTION_KEY], appearance.DEFAULT_DESKTOP_DIRECTION
        )
        if appearance.DESKTOP_DIRECTION_KEY in stored
        else None,
        "direction_mobile": appearance.direction(
            stored[appearance.MOBILE_DIRECTION_KEY], appearance.DEFAULT_MOBILE_DIRECTION
        )
        if appearance.MOBILE_DIRECTION_KEY in stored
        else None,
        "seeded_categories": sorted({str(key) for key in seeded if str(key).strip()}),
    }
    return Rows(
        exported_at=utcnow(),
        app_version=app_version[:64],
        users=[
            {
                "email": user.email,
                "name": user.name,
                "role": user.role,
                "disabled": user.disabled,
                "invited_by": emails.get(user.invited_by_id or 0),
                "created_at": stamp(user.created_at),
                "last_login_at": stamp(user.last_login_at),
            }
            for user in users
        ],
        categories=[
            {
                "id": category.id,
                "key": category.key,
                "name_es": category.name_es,
                "name_en": category.name_en,
                "name_pt": category.name_pt,
                "icon": category.icon,
                "color": category.color,
                "sort_order": category.sort_order,
                "created_at": stamp(category.created_at),
                "updated_at": stamp(category.updated_at),
            }
            for category in categories
        ],
        children=[
            (
                {
                    "id": child.id,
                    "name": child.name,
                    "slug": child.slug,
                    "birth_date": (
                        None if child.birth_date is None else child.birth_date.isoformat()
                    ),
                    "color": child.color,
                    "sort_order": child.sort_order,
                    "created_at": stamp(child.created_at),
                    "updated_at": stamp(child.updated_at),
                },
                None
                if child.avatar is None or child.avatar.expires_at is not None
                else ImageRow.of(child.avatar, emails),
            )
            for child in children
        ],
        events=event_rows,
        year_colors=[
            {"year": row.year, "color": row.color}
            for row in await db.scalars(select(YearColor).order_by(YearColor.year))
        ],
        settings=settings,
        background=None if background is None else ImageRow.of(background, emails),
    )


def media_file(image: ImageRow, folder: str, layout: Layout, media_dir: Path) -> MediaFile | None:
    """The files of ``image`` and their archive paths in ``folder``; None without its original."""
    directory = media_dir / str(image.id)
    source = directory / f"original.{image.original_ext}"
    if not source.is_file():
        log.warning("Export skipped an image whose original is missing")
        return None
    path = layout.file(folder, image.original_filename, image.original_ext)
    media = MediaFile(
        entry={
            "kind": image.kind,
            "name": image.name,
            "original_filename": image.original_filename,
            "crop": image.crop,
            "live": image.live,
            "uploaded_by": image.uploaded_by,
            "created_at": image.created_at,
        },
        source=source,
        path=path,
    )
    if image.live_photo:
        motion = video.source_file(directory, "image", image.original_ext)
        if motion is not None:
            media.motion_source = motion
            media.motion_path = layout.companion(path, motion.suffix.lstrip(".") or "mov")
    return media


def plan_files(rows: Rows, media_dir: Path) -> Snapshot:
    """Archive paths of every file (worker thread: it checks them on disk)."""
    layout = Layout()
    snapshot = Snapshot(rows=rows)
    for data, images, cover_id, trashed in rows.events:
        folder = layout.event_folder(data["title"], dt.date.fromisoformat(data["date"]), trashed)
        files: list[MediaFile] = []
        cover: MediaFile | None = None
        for image in images:
            media = media_file(image, folder, layout, media_dir)
            if media is None:
                continue
            files.append(media)
            if image.id == cover_id:
                cover = media
        snapshot.events.append((data, files, cover))
        snapshot.files.extend(files)
    for data, avatar in rows.children:
        media = None
        if avatar is not None:
            media = media_file(avatar, layout.child_folder(data["slug"]), layout, media_dir)
        snapshot.children.append((data, media))
        if media is not None:
            snapshot.files.append(media)
    if rows.background is not None:
        snapshot.background = media_file(rows.background, APPEARANCE_FOLDER, layout, media_dir)
        if snapshot.background is not None:
            snapshot.files.append(snapshot.background)
    return snapshot


async def summary(db: AsyncSession) -> BackupSummaryOut:
    """What an export holds now (``media_bytes``: originals, without Live Photo clips)."""
    trashed = Event.deleted_at.is_not(None)
    live_events, trashed_events = (
        await db.execute(
            select(func.count().filter(~trashed), func.count().filter(trashed)).select_from(Event)
        )
    ).one()
    attached = (Image.expires_at.is_(None), Image.event_id.is_not(None), Image.purpose == "event")
    photos, live_photos, videos = (
        await db.execute(
            select(
                func.count().filter(Image.kind == "image"),
                func.count().filter(Image.kind == "image", Image.video_status.is_not(None)),
                func.count().filter(Image.kind == "video"),
            ).where(*attached)
        )
    ).one()
    users, admins = (
        await db.execute(select(func.count(), func.count().filter(User.role == "admin")))
    ).one()
    stored = await appearance.stored_settings(db, (appearance.BACKGROUND_KEY,))
    background = await appearance.background_image(
        db, appearance.background_id(stored.get(appearance.BACKGROUND_KEY))
    )
    # Attached images: event images, avatars and the current background.
    exported = Image.purpose != "background"
    if background is not None:
        exported = exported | (Image.id == background.id)
    media_bytes = await db.scalar(
        select(func.coalesce(func.sum(Image.byte_size), 0)).where(
            Image.expires_at.is_(None), exported
        )
    )
    return BackupSummaryOut(
        events=live_events or 0,
        trashed_events=trashed_events or 0,
        photos=photos or 0,
        live_photos=live_photos or 0,
        videos=videos or 0,
        children=await db.scalar(select(func.count()).select_from(Child)) or 0,
        categories=await db.scalar(select(func.count()).select_from(Category)) or 0,
        users=users or 0,
        admins=admins or 0,
        year_colors=await db.scalar(select(func.count()).select_from(YearColor)) or 0,
        background=background is not None,
        media_bytes=int(media_bytes or 0),
    )


# Writing ------------------------------------------------------------------------------------


class Pipe(io.RawIOBase):
    """The unseekable file ``zipfile`` writes to: hands what it gets to the event loop in
    ``PIECE_BYTES`` pieces, waiting while ``QUEUED_PIECES`` are not sent yet; raises
    ``ExportStopped`` once ``stop`` is set."""

    def __init__(
        self,
        loop: asyncio.AbstractEventLoop,
        queue: "asyncio.Queue[bytes | BaseException | None]",
        stop: threading.Event,
    ) -> None:
        super().__init__()
        self.loop = loop
        self.queue = queue
        self.stop = stop
        self.slots = threading.Semaphore(QUEUED_PIECES)
        self.buffer = bytearray()

    def writable(self) -> bool:
        return True

    def write(self, data: Any) -> int:
        self.buffer += data
        while len(self.buffer) >= PIECE_BYTES:
            self.send(bytes(self.buffer[:PIECE_BYTES]))
            del self.buffer[:PIECE_BYTES]
        return memoryview(data).nbytes

    def send(self, piece: bytes | BaseException | None) -> None:
        while not self.slots.acquire(timeout=SEND_POLL_SECONDS):
            if self.stop.is_set():
                raise ExportStopped
        if self.stop.is_set():
            raise ExportStopped
        self.loop.call_soon_threadsafe(self.queue.put_nowait, piece)

    def finish(self) -> None:
        if self.buffer:
            self.send(bytes(self.buffer))
            self.buffer.clear()
        self.send(None)


def add_file(archive: zipfile.ZipFile, source: Path, name: str) -> bool:
    """Store ``source`` (uncompressed: photos and videos are) as ``name``; False when it is gone."""
    try:
        handle = open(source, "rb")
    except FileNotFoundError:
        log.warning("Export skipped a file that is gone")
        return False
    with handle:
        info = zipfile.ZipInfo.from_file(source, name, strict_timestamps=False)
        info.compress_type = zipfile.ZIP_STORED
        with archive.open(info, "w") as target:
            shutil.copyfileobj(handle, target, COPY_BYTES)
    return True


def write_archive(pipe: Pipe, snapshot: Snapshot) -> None:
    """Write the whole archive into ``pipe`` (dedicated thread), then its end (None) — or the
    error that stopped it."""
    try:
        with zipfile.ZipFile(pipe, "w", allowZip64=True, strict_timestamps=False) as archive:
            for media in snapshot.files:
                media.written = add_file(archive, media.source, media.path)
                if (
                    media.written
                    and media.motion_source is not None
                    and media.motion_path is not None
                    and not add_file(archive, media.motion_source, media.motion_path)
                ):
                    media.motion_path = None
            text = readme(snapshot.rows.exported_at, snapshot.counts())
            archive.writestr(README_NAME, text, compress_type=zipfile.ZIP_DEFLATED)
            manifest = json.dumps(snapshot.manifest(), ensure_ascii=False, indent=1)
            archive.writestr(MANIFEST_NAME, manifest, compress_type=zipfile.ZIP_DEFLATED)
        pipe.finish()
    except ExportStopped:
        return
    except Exception as error:
        log.error("Export failed (%s)", type(error).__name__)
        try:
            pipe.send(error)
        except ExportStopped:
            pass


async def archive_pieces(snapshot: Snapshot, stop: threading.Event) -> AsyncIterator[bytes]:
    """The archive's bytes, written by a dedicated thread while they are sent; setting ``stop``
    ends that thread."""
    queue: asyncio.Queue[bytes | BaseException | None] = asyncio.Queue()
    pipe = Pipe(asyncio.get_running_loop(), queue, stop)
    writer = threading.Thread(
        target=write_archive, args=(pipe, snapshot), name="timelife-export", daemon=True
    )
    writer.start()
    try:
        while True:
            piece = await queue.get()
            pipe.slots.release()
            if piece is None:
                return
            if isinstance(piece, BaseException):
                raise RuntimeError("The export stopped") from piece
            yield piece
    finally:
        stop.set()


class ArchiveResponse(StreamingResponse):
    """A streamed archive; once the response is over, however it ends, the writer thread stops
    and ``release`` is called."""

    def __init__(self, snapshot: Snapshot, filename: str, release: Callable[[], None]) -> None:
        self.stop = threading.Event()
        super().__init__(
            archive_pieces(snapshot, self.stop),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
        self.release = release

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.stop.set()
            self.release()
