"""Import of a backup archive (format in ``backup_format``): upload sessions and the import itself.

Sessions. ``POST /api/admin/backup/imports`` opens one (one at a time); the browser then sends the
file in ``IMPORT_CHUNK_BYTES`` pieces (``PUT …/content?offset=``), below the request limits of
proxies such as Cloudflare's 100 MB, and resumes after a cut from the ``received`` it reads back.
Everything lives in ``media_dir/.imports/<id>/`` (``archive.zip`` and ``state.json``), so an upload
survives restarts. Once every byte has arrived the archive is checked: ``ready`` with what it
holds, or ``invalid``.

The import (``Importer``, run in the background by ``backup.Backups``) has three phases:

1. plan — what to create. "replace": everything; "merge": what is missing, matching categories by
   key or name, children by slug, users by e-mail, events by date, title and children (the trash
   included) and year colours by year; settings only when unset, the background only without one.
2. media — every photo and video to import goes through the upload pipeline
   (``media.store_upload``: re-encoded and checked like an upload) and stays a pending upload; a
   file that fails is reported and skipped.
3. saving — ONE transaction applies everything. "replace" first removes the current content
   (keeping the importing administrator) and keeps the ids of
   events, children and categories, so links keep working. If anything fails it rolls back and
   the prepared media are deleted: nothing changed. A restart in the middle ends the same way.

Image folders the run deletes (a whole library for "replace") are removed after the commit in
worker threads, not by the per-request after-commit hook (which runs on the event loop). The
journals ``prepared.txt`` and ``obsolete.txt`` let the next start finish that clean-up when the
process dies half-way (``recover``)."""

import datetime as dt
import errno
import logging
import os
import shutil
import uuid
import zipfile
import zlib
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.concurrency import run_in_threadpool

from . import appearance, crops, media, video
from .auth import UNSYNCHRONIZED
from .backup_format import (
    MAX_ENTRIES,
    CategoryEntry,
    ChildEntry,
    EventEntry,
    Manifest,
    MediaEntry,
    UserEntry,
    YearColorEntry,
    read_manifest,
    summarize,
    usable_entry,
)
from .config import Settings
from .contracts import (
    ImagePurpose,
    ImportArchiveOut,
    ImportCountsOut,
    ImportIssueOut,
    ImportItemKind,
    ImportMode,
    ImportProgressOut,
    ImportReportOut,
    ImportStatus,
)
from .db import (
    AppSetting,
    Category,
    Child,
    Event,
    EventCategory,
    EventChild,
    Image,
    User,
    YearColor,
    utcnow,
)
from .errors import AppError
from .events import title_search
from .seed import CATEGORIES, SEEDED_CATEGORIES_KEY
from .text import normalize_search

log = logging.getLogger(__name__)

IMPORTS = ".imports"
STATE_FILE = "state.json"
ARCHIVE_FILE = "archive.zip"
WORK_FOLDER = "work"
# Journals of a run, one image id per line: images it prepared (deleted again unless the run
# finishes) and image folders to remove once its transaction has committed. Startup reads them
# to finish what a crash interrupted.
PREPARED_FILE = "prepared.txt"
OBSOLETE_FILE = "obsolete.txt"
# Free space kept on top of what an import needs.
SPACE_RESERVE = 512 * 1024 * 1024
ABANDONED_UPLOAD = dt.timedelta(days=1)
STALE_SESSION = dt.timedelta(days=7)
# Prepared media wait as pending uploads until the import attaches them.
PREPARED_LIFETIME = dt.timedelta(days=2)
MAX_ISSUES = 200
COPY_BYTES = 1024 * 1024
BATCH = 500
# The most an upload may be under any configuration (``config.Settings`` bounds), so that a
# backup made with other limits can still be restored.
IMPORT_LIMITS = {"max_upload_mb": 200, "max_video_upload_mb": 4096, "max_video_minutes": 240}
MAX_ENTRY_BYTES = (IMPORT_LIMITS["max_video_upload_mb"] + 1) * 1024 * 1024
# The default categories by key: an import of a copy without Portuguese names translates them.
DEFAULT_CATEGORIES = {item.key: item for item in CATEGORIES}
ARCHIVE_ERRORS = (
    zipfile.BadZipFile,
    zipfile.LargeZipFile,
    NotImplementedError,
    RuntimeError,
    EOFError,
    zlib.error,
    UnicodeError,
    OSError,
)


class ImportCancelled(Exception):
    """An administrator cancelled the running import."""


# Sessions -----------------------------------------------------------------------------------


class ImportState(BaseModel):
    """``state.json`` of an import session."""

    model_config = ConfigDict(extra="ignore")

    id: str
    status: ImportStatus
    filename: str
    size: int
    received: int = 0
    last_modified: int | None = None
    created_at: dt.datetime
    updated_at: dt.datetime
    archive: ImportArchiveOut | None = None
    mode: ImportMode | None = None
    error: str | None = None
    report: ImportReportOut | None = None
    started_by: int | None = None


def imports_root(media_dir: Path) -> Path:
    return media_dir / IMPORTS


def session_folder(media_dir: Path, import_id: str) -> Path:
    return imports_root(media_dir) / import_id


def archive_path(media_dir: Path, import_id: str) -> Path:
    return session_folder(media_dir, import_id) / ARCHIVE_FILE


def work_folder(media_dir: Path, import_id: str) -> Path:
    return session_folder(media_dir, import_id) / WORK_FOLDER


def append_id(path: Path, image_id: uuid.UUID) -> None:
    """Add a line to a journal, flushed to disk."""
    with open(path, "a", encoding="ascii") as handle:
        handle.write(f"{image_id}\n")
        handle.flush()
        os.fsync(handle.fileno())


def write_ids(path: Path, ids: Sequence[uuid.UUID]) -> None:
    content = "".join(f"{image_id}\n" for image_id in ids).encode("ascii")
    media.write_file(path, content, unique=True)


def read_ids(path: Path) -> list[uuid.UUID]:
    """The ids of a journal (none when it does not exist); a line a crash cut short is skipped."""
    try:
        lines = path.read_text(encoding="ascii", errors="replace").splitlines()
    except FileNotFoundError:
        return []
    ids: list[uuid.UUID] = []
    for line in lines:
        try:
            ids.append(uuid.UUID(line.strip()))
        except ValueError:
            continue
    return list(dict.fromkeys(ids))


def remove_file(path: Path) -> None:
    path.unlink(missing_ok=True)


def save_state(media_dir: Path, state: ImportState) -> None:
    folder = session_folder(media_dir, state.id)
    media.write_file(folder / STATE_FILE, state.model_dump_json().encode(), unique=True)


def load_states(media_dir: Path) -> list[ImportState]:
    """Every readable session; folders without a readable state are removed (run ``recover`` on
    them first: a discarded session can still hold the journals of its run)."""
    root = imports_root(media_dir)
    try:
        folders = [entry for entry in root.iterdir() if entry.is_dir()]
    except OSError:
        return []
    states: list[ImportState] = []
    for folder in folders:
        try:
            state = ImportState.model_validate_json((folder / STATE_FILE).read_bytes())
            if state.id != folder.name:
                raise ValueError("Mismatched session folder")
            states.append(state)
        except FileNotFoundError:
            shutil.rmtree(folder, ignore_errors=True)
        except (OSError, ValueError):
            log.warning("Removing an unreadable import session")
            shutil.rmtree(folder, ignore_errors=True)
    return states


def session_ids(media_dir: Path) -> list[str]:
    """The names of every session folder, readable or not."""
    try:
        return [entry.name for entry in imports_root(media_dir).iterdir() if entry.is_dir()]
    except OSError:
        return []


def remove_session(media_dir: Path, import_id: str) -> None:
    shutil.rmtree(session_folder(media_dir, import_id), ignore_errors=True)


def remove_archive(media_dir: Path, import_id: str) -> None:
    archive_path(media_dir, import_id).unlink(missing_ok=True)
    remove_work(media_dir, import_id)


def remove_work(media_dir: Path, import_id: str) -> None:
    shutil.rmtree(work_folder(media_dir, import_id), ignore_errors=True)


def free_space(path: Path) -> int:
    return shutil.disk_usage(path).free


def ensure_space(path: Path, needed: int) -> None:
    """507 ``import_no_space`` unless ``needed`` bytes (plus a reserve) are free."""
    available = free_space(path)
    if available < needed + SPACE_RESERVE:
        raise AppError(
            "import_no_space",
            507,
            detail={"required": needed + SPACE_RESERVE, "available": available},
        )


def append_chunk(path: Path, offset: int, data: bytes) -> int:
    """Write ``data`` at ``offset`` (dropping anything after it: a write a crash cut short),
    flushed to disk; returns the new size."""
    with open(path, "r+b" if path.exists() else "xb") as handle:
        handle.seek(offset)
        handle.truncate()
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
        return handle.tell()


def truncate(path: Path, size: int) -> None:
    """Cut the archive back to the ``size`` bytes its state counts."""
    try:
        if path.stat().st_size > size:
            with open(path, "r+b") as handle:
                handle.truncate(size)
    except FileNotFoundError:
        pass


def analyze(path: Path) -> ImportArchiveOut:
    """What a complete archive holds; 422 ``invalid_import`` / ``import_version_unsupported``."""
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ENTRIES:
                raise AppError("invalid_import")
            manifest = read_manifest(archive)
            sizes = {entry.filename: entry.file_size for entry in entries if usable_entry(entry)}
    except ARCHIVE_ERRORS:
        raise AppError("invalid_import") from None
    summary, missing = summarize(manifest, sizes)
    return ImportArchiveOut(
        exported_at=manifest.exported_at,
        app_version=manifest.app_version,
        summary=summary,
        missing_files=missing,
    )


# Report -------------------------------------------------------------------------------------

Counted = Literal["users", "categories", "children", "events", "media", "year_colors"]


class Report:
    """Counts per kind of item and the first ``MAX_ISSUES`` issues."""

    def __init__(self, mode: ImportMode) -> None:
        self.mode = mode
        self.counts: dict[Counted, dict[str, int]] = {
            kind: {"created": 0, "skipped": 0, "failed": 0}
            for kind in ("users", "categories", "children", "events", "media", "year_colors")
        }
        self.issues: list[ImportIssueOut] = []
        self.more = 0

    def created(self, kind: Counted, count: int = 1) -> None:
        self.counts[kind]["created"] += count

    def skipped(self, kind: Counted, count: int = 1) -> None:
        self.counts[kind]["skipped"] += count

    def failed(self, kind: Counted, issue: ImportItemKind, name: str, code: str) -> None:
        self.counts[kind]["failed"] += 1
        if len(self.issues) < MAX_ISSUES:
            self.issues.append(ImportIssueOut(kind=issue, name=name[:200], code=code))
        else:
            self.more += 1

    def out(self) -> ImportReportOut:
        return ImportReportOut(
            mode=self.mode,
            users=ImportCountsOut(**self.counts["users"]),
            categories=ImportCountsOut(**self.counts["categories"]),
            children=ImportCountsOut(**self.counts["children"]),
            events=ImportCountsOut(**self.counts["events"]),
            media=ImportCountsOut(**self.counts["media"]),
            year_colors=ImportCountsOut(**self.counts["year_colors"]),
            issues=self.issues,
            more_issues=self.more,
            finished_at=utcnow(),
        )

# Import -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class PreparedImage:
    """A media entry already stored as a pending image."""

    id: uuid.UUID


@dataclass
class Progress:
    phase: Literal["media", "saving"] = "media"
    done: int = 0
    total: int = 0

    def out(self) -> ImportProgressOut:
        return ImportProgressOut(phase=self.phase, done=self.done, total=self.total)


EventKey = tuple[dt.date, str, frozenset[str]]


def event_key(event: EventEntry, slugs: dict[int, str]) -> EventKey:
    """What makes two events the same milestone for a merge: date, title (accents and case
    ignored) and children (by slug)."""
    return (
        event.date,
        title_search(event.title),
        frozenset(slugs[child_id] for child_id in event.child_ids),
    )


@dataclass
class Existing:
    """What the database holds that a merge compares the archive with."""

    emails: set[str]
    category_keys: dict[str, int]
    names_es: dict[str, int]
    names_en: dict[str, int]
    slugs: dict[str, int]
    event_keys: set[EventKey]
    years: set[int]
    settings: set[str]
    background: bool

    def category(self, entry: CategoryEntry) -> int | None:
        if entry.key and entry.key in self.category_keys:
            return self.category_keys[entry.key]
        return self.names_es.get(normalize_search(entry.name_es)) or self.names_en.get(
            normalize_search(entry.name_en)
        )


async def existing(db: AsyncSession) -> Existing:
    category_keys: dict[str, int] = {}
    names_es: dict[str, int] = {}
    names_en: dict[str, int] = {}
    for category in await db.scalars(select(Category).order_by(Category.sort_order, Category.id)):
        if category.key:
            category_keys.setdefault(category.key, category.id)
        names_es.setdefault(normalize_search(category.name_es), category.id)
        names_en.setdefault(normalize_search(category.name_en), category.id)
    slugs = {slug: child_id for child_id, slug in await db.execute(select(Child.id, Child.slug))}
    slug_of = {child_id: slug for slug, child_id in slugs.items()}
    linked: dict[int, set[str]] = {}
    for event_id, child_id in await db.execute(select(EventChild.event_id, EventChild.child_id)):
        linked.setdefault(event_id, set()).add(slug_of[child_id])
    events = await db.execute(select(Event.id, Event.date, Event.title_search))
    stored = await appearance.stored_settings(db)
    background = await appearance.background_image(
        db, appearance.background_id(stored.get(appearance.BACKGROUND_KEY))
    )
    return Existing(
        emails=set(await db.scalars(select(User.email))),
        category_keys=category_keys,
        names_es=names_es,
        names_en=names_en,
        slugs=slugs,
        event_keys={
            (date, search, frozenset(linked.get(event_id, ()))) for event_id, date, search in events
        },
        years=set(await db.scalars(select(YearColor.year))),
        settings={key for key in stored if key != appearance.BACKGROUND_KEY},
        background=background is not None,
    )


@dataclass
class Plan:
    """What an import creates (a merge also maps archive ids to existing rows)."""

    users: list[UserEntry] = field(default_factory=list)
    categories: list[CategoryEntry] = field(default_factory=list)
    children: list[ChildEntry] = field(default_factory=list)
    events: list[EventEntry] = field(default_factory=list)
    year_colors: list[YearColorEntry] = field(default_factory=list)
    settings: dict[str, Any] = field(default_factory=dict)
    background: MediaEntry | None = None
    category_ids: dict[int, int] = field(default_factory=dict)
    child_ids: dict[int, int] = field(default_factory=dict)

    def media(self) -> list[tuple[MediaEntry, ImagePurpose, str]]:
        """The photos and videos to prepare, with their purpose and the name the report uses."""
        items: list[tuple[MediaEntry, ImagePurpose, str]] = [
            (image, "event", f"{event.title} · {image.name}")
            for event in self.events
            for image in event.images
        ]
        items.extend(
            (child.avatar, "avatar", child.name)
            for child in self.children
            if child.avatar is not None
        )
        if self.background is not None:
            items.append((self.background, "background", self.background.name))
        return items


def setting_values(manifest: Manifest) -> dict[str, Any]:
    """The archive's timeline settings that were set (not the background)."""
    values = {
        appearance.OPACITY_KEY: manifest.settings.background_opacity,
        appearance.ZOOM_KEY: manifest.settings.default_zoom,
        appearance.DESKTOP_DIRECTION_KEY: manifest.settings.direction_desktop,
        appearance.MOBILE_DIRECTION_KEY: manifest.settings.direction_mobile,
    }
    return {key: value for key, value in values.items() if value is not None}


def portuguese_name(entry: CategoryEntry) -> str:
    """The category's Portuguese name. Copies made before Portuguese existed (format 1) have
    none: like migration 0006, a default category still called as when it was created gets its
    translation and any other one its Spanish name, for an administrator to translate."""
    if entry.name_pt is not None:
        return entry.name_pt
    default = DEFAULT_CATEGORIES.get(entry.key) if entry.key else None
    if default is not None and entry.name_es == default.name_es:
        return default.name_pt
    return entry.name_es


def plan_import(manifest: Manifest, current: Existing | None, report: Report) -> Plan:
    """Everything for a "replace" (``current`` None), what is missing for a "merge"."""
    if current is None:
        return Plan(
            users=list(manifest.users),
            categories=list(manifest.categories),
            children=list(manifest.children),
            events=list(manifest.events),
            year_colors=list(manifest.year_colors),
            settings=setting_values(manifest),
            background=manifest.settings.background,
        )
    plan = Plan()
    for user in manifest.users:
        if user.email in current.emails:
            report.skipped("users")
        else:
            plan.users.append(user)
    for category in manifest.categories:
        match = current.category(category)
        if match is None:
            plan.categories.append(category)
        else:
            plan.category_ids[category.id] = match
            report.skipped("categories")
    for child in manifest.children:
        found = current.slugs.get(child.slug)
        if found is None:
            plan.children.append(child)
        else:
            plan.child_ids[child.id] = found
            report.skipped("children")
            report.skipped("media", child.avatar is not None)
    slugs = {child.id: child.slug for child in manifest.children}
    for event in manifest.events:
        if event_key(event, slugs) in current.event_keys:
            report.skipped("events")
            report.skipped("media", len(event.images))
        else:
            plan.events.append(event)
    for colour in manifest.year_colors:
        if colour.year in current.years:
            report.skipped("year_colors")
        else:
            plan.year_colors.append(colour)
    plan.settings = {
        key: value for key, value in setting_values(manifest).items() if key not in current.settings
    }
    if manifest.settings.background is not None:
        if current.background:
            report.skipped("media")
        else:
            plan.background = manifest.settings.background
    return plan


def extract(archive: zipfile.ZipFile, name: str, target: Path) -> Path:
    """Copy the archive file ``name`` to ``target`` (worker thread). 422
    ``import_file_missing``/``import_file_unreadable``, 413 ``upload_too_large``."""
    try:
        info = archive.getinfo(name)
    except KeyError:
        raise AppError("import_file_missing") from None
    if not usable_entry(info):
        raise AppError("import_file_unreadable")
    if info.file_size > MAX_ENTRY_BYTES:
        raise AppError("upload_too_large", 413)
    with archive.open(info) as source, open(target, "xb") as handle:
        shutil.copyfileobj(source, handle, COPY_BYTES)
    return target


def batches(items: Sequence[Any]) -> Iterable[Sequence[Any]]:
    for start in range(0, len(items), BATCH):
        yield items[start : start + BATCH]


def remove_folders(media_dir: Path, ids: Sequence[uuid.UUID]) -> None:
    for image_id in ids:
        shutil.rmtree(media_dir / str(image_id), ignore_errors=True)


async def remove_image_folders(media_dir: Path, ids: Sequence[uuid.UUID]) -> None:
    """Remove the folders of deleted images in worker threads, a batch at a time: an import can
    remove a whole library, which the per-request after-commit hook would do on the event loop.
    Their conversions stop first."""
    for image_id in ids:
        video.cancel(media_dir, image_id)
    for batch in batches(ids):
        await run_in_threadpool(remove_folders, media_dir, batch)


async def existing_ids(db: AsyncSession, ids: Sequence[uuid.UUID]) -> set[uuid.UUID]:
    found: set[uuid.UUID] = set()
    for batch in batches(ids):
        found.update(await db.scalars(select(Image.id).where(Image.id.in_(batch))))
    return found


async def discard_prepared(
    sessions: async_sessionmaker[AsyncSession], media_dir: Path, ids: Sequence[uuid.UUID]
) -> bool:
    """Delete images an import prepared and never attached (those of a run that did finish
    stay): the rows, then, once that is committed, the folders of the images that are gone.
    False when the database could not be reached (the rows expire on their own)."""
    if not ids:
        return True
    try:
        async with sessions() as db:
            for batch in batches(ids):
                await db.execute(
                    delete(Image).where(Image.id.in_(batch), Image.expires_at.is_not(None)),
                    execution_options=UNSYNCHRONIZED,
                )
            await db.commit()
            kept = await existing_ids(db, ids)
    except Exception as error:
        log.error("Prepared import media not removed (%s); they expire", type(error).__name__)
        return False
    await remove_image_folders(media_dir, [image_id for image_id in ids if image_id not in kept])
    return True


async def recover(
    sessions: async_sessionmaker[AsyncSession], media_dir: Path, import_id: str
) -> None:
    """At startup, finish what a crash left of a run, from its journals: delete the images it
    had prepared and never attached, and the folders of the images its committed transaction
    removed (only those whose row is really gone)."""
    folder = session_folder(media_dir, import_id)
    prepared = await run_in_threadpool(read_ids, folder / PREPARED_FILE)
    if await discard_prepared(sessions, media_dir, prepared):
        await run_in_threadpool(remove_file, folder / PREPARED_FILE)
    obsolete = await run_in_threadpool(read_ids, folder / OBSOLETE_FILE)
    if obsolete:
        async with sessions() as db:
            kept = await existing_ids(db, obsolete)
        gone = [image_id for image_id in obsolete if image_id not in kept]
        await remove_image_folders(media_dir, gone)
    await run_in_threadpool(remove_file, folder / OBSOLETE_FILE)


async def bump_sequences(db: AsyncSession) -> None:
    """PostgreSQL: after rows were inserted with their own ids, the next generated ids follow
    the highest one (never going back). SQLite's AUTOINCREMENT does it by itself."""
    if db.get_bind().dialect.name != "postgresql":
        return
    for table in ("categories", "children", "events"):
        sequence = f"pg_get_serial_sequence('{table}', 'id')"
        await db.execute(
            text(
                f"SELECT setval({sequence}, GREATEST((SELECT COALESCE(MAX(id), 0) FROM {table}), "
                f"COALESCE(pg_sequence_last_value({sequence}::regclass), 0)) + 1, false)"
            )
        )


class Importer:
    """One run of an import (see the module docstring)."""

    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        config: Settings,
        jobs: video.VideoJobs,
        *,
        archive: Path,
        work: Path,
        journal: Path,
        mode: ImportMode,
        user_id: int | None,
        progress: Progress,
        cancelled: Callable[[], bool],
    ) -> None:
        self.sessions = sessions
        self.config = config
        self.upload_config = config.model_copy(update=IMPORT_LIMITS)
        self.jobs = jobs
        self.archive_path = archive
        self.work = work
        # The session folder, where the run's journals go.
        self.journal = journal
        self.mode = mode
        self.user_id = user_id
        self.progress = progress
        self.cancelled = cancelled
        self.report = Report(mode)
        # Prepared images by ``id()`` of their manifest entry, and those the save attached.
        self.prepared: dict[int, PreparedImage] = {}
        self.attached: set[uuid.UUID] = set()
        # Images the save deletes: their folders are removed once it has committed.
        self.obsolete: list[uuid.UUID] = []
        # Set as soon as the save is committed: from then on the import has happened, whatever
        # goes wrong afterwards.
        self.committed = False

    @property
    def media_dir(self) -> Path:
        return self.config.media_dir

    async def run(self) -> ImportReportOut:
        """Plan, prepare the media and save, all or nothing; returns the report once the save is
        committed. ``finish`` then does what is left (it never undoes anything)."""
        try:
            archive = await run_in_threadpool(zipfile.ZipFile, self.archive_path)
        except ARCHIVE_ERRORS:
            raise AppError("invalid_import") from None
        try:
            try:
                manifest = await run_in_threadpool(read_manifest, archive)
                async with self.sessions() as db:
                    current = None if self.mode == "replace" else await existing(db)
                plan = plan_import(manifest, current, self.report)
                await self.prepare_media(archive, plan)
            finally:
                await run_in_threadpool(archive.close)
            self.progress.phase = "saving"
            await self.save(manifest, plan)
        except BaseException:
            if not self.committed:
                ids = [image.id for image in self.prepared.values()]
                if await discard_prepared(self.sessions, self.media_dir, ids):
                    await run_in_threadpool(remove_file, self.journal / PREPARED_FILE)
            raise
        return self.report.out()

    async def finish(self) -> None:
        """After the save committed: the folders of the images it deleted and the journals.
        Never fails: what it cannot do now, the next start does (``recover``)."""
        try:
            await remove_image_folders(self.media_dir, self.obsolete)
            for name in (OBSOLETE_FILE, PREPARED_FILE):
                await run_in_threadpool(remove_file, self.journal / name)
        except Exception as error:
            log.error("Import clean-up left for the next start (%s)", type(error).__name__)

    # Media

    async def prepare_media(self, archive: zipfile.ZipFile, plan: Plan) -> None:
        items = plan.media()
        self.progress.phase, self.progress.done, self.progress.total = "media", 0, len(items)
        await run_in_threadpool(self.work.mkdir, parents=True, exist_ok=True)
        for entry, purpose, label in items:
            if self.cancelled():
                raise ImportCancelled
            try:
                self.prepared[id(entry)] = await self.prepare(archive, entry, purpose)
            except AppError as error:
                if error.code == "import_no_space":
                    raise
                self.report.failed("media", "media", label, error.code)
            except OSError as error:
                if error.errno == errno.ENOSPC:
                    raise AppError("import_no_space", 507) from None
                log.warning("An imported file could not be read (%s)", type(error).__name__)
                self.report.failed("media", "media", label, "import_file_unreadable")
            except ARCHIVE_ERRORS as error:
                log.warning("An imported file could not be read (%s)", type(error).__name__)
                self.report.failed("media", "media", label, "import_file_unreadable")
            self.progress.done += 1

    async def prepare(
        self, archive: zipfile.ZipFile, entry: MediaEntry, purpose: ImagePurpose
    ) -> PreparedImage:
        """Store ``entry`` as a pending image through the upload pipeline."""
        folder = self.work / uuid.uuid4().hex
        await run_in_threadpool(folder.mkdir)
        try:
            source = await run_in_threadpool(extract, archive, entry.file, folder / "file")
            motion = None
            if entry.motion is not None:
                motion = await run_in_threadpool(extract, archive, entry.motion, folder / "motion")
            async with self.sessions() as db:
                image = await media.store_upload(
                    db,
                    self.upload_config,
                    self.jobs,
                    purpose=purpose,
                    source=source,
                    filename=entry.original_filename,
                    motion=motion,
                    lifetime=PREPARED_LIFETIME,
                )
            await run_in_threadpool(append_id, self.journal / PREPARED_FILE, image.id)
            return PreparedImage(image.id)
        finally:
            await run_in_threadpool(shutil.rmtree, folder, True)

    # Saving (one transaction)

    async def save(self, manifest: Manifest, plan: Plan) -> None:
        obsolete = self.journal / OBSOLETE_FILE
        async with self.sessions() as db:
            try:
                current: Existing | None = None
                if self.mode == "replace":
                    await self.clear(db)
                else:
                    current = await existing(db)
                emails = await self.save_users(db, plan)
                categories = await self.save_categories(db, plan, current)
                children = await self.save_children(db, plan, current, emails)
                await self.save_events(db, manifest, plan, current, emails, categories, children)
                await self.save_year_colors(db, plan)
                await self.save_settings(db, manifest, plan, emails)
                await self.drop_unattached(db)
                if self.mode == "replace":
                    await bump_sequences(db)
                # Written first: a crash right after the commit still removes these folders.
                await run_in_threadpool(write_ids, obsolete, self.obsolete)
                await db.commit()
                self.committed = True
            except BaseException:
                if not self.committed:
                    await db.rollback()
                    await run_in_threadpool(remove_file, obsolete)
                raise

    async def clear(self, db: AsyncSession) -> None:
        """Remove the current content: images (folders once committed), events, children,
        categories, colours, settings and every user except the importing administrator."""
        if await db.get(User, self.user_id) is None:
            raise AppError("import_failed", 409)
        prepared = {image.id for image in self.prepared.values()}
        old = [
            image_id for image_id in await db.scalars(select(Image.id)) if image_id not in prepared
        ]
        for batch in batches(old):
            await db.execute(
                delete(Image).where(Image.id.in_(batch)), execution_options=UNSYNCHRONIZED
            )
        self.obsolete.extend(old)
        for model in (Event, Child, Category, YearColor):
            await db.execute(delete(model), execution_options=UNSYNCHRONIZED)
        await db.execute(
            delete(AppSetting).where(
                AppSetting.key.in_([*appearance.SETTING_KEYS, SEEDED_CATEGORIES_KEY])
            ),
            execution_options=UNSYNCHRONIZED,
        )
        await db.execute(
            delete(User).where(User.id != self.user_id), execution_options=UNSYNCHRONIZED
        )

    async def save_users(self, db: AsyncSession, plan: Plan) -> dict[str, int]:
        """Create the users (who invited them once they all exist); returns every id by e-mail."""
        emails = {
            email: user_id for user_id, email in await db.execute(select(User.id, User.email))
        }
        now = utcnow()
        created: list[tuple[UserEntry, User]] = []
        for entry in plan.users:
            if entry.email in emails:
                self.report.skipped("users")
                continue
            user = User(
                email=entry.email,
                name=entry.name,
                role=entry.role,
                disabled=entry.disabled,
                auth_version=1,
                created_at=entry.created_at or now,
                last_login_at=entry.last_login_at,
            )
            db.add(user)
            created.append((entry, user))
        await db.flush()
        emails.update((entry.email, user.id) for entry, user in created)
        for entry, user in created:
            if entry.invited_by is not None:
                user.invited_by_id = emails.get(entry.invited_by)
        self.report.created("users", len(created))
        return emails

    async def save_categories(
        self, db: AsyncSession, plan: Plan, current: Existing | None
    ) -> dict[int, int]:
        """Create the categories; returns the database id of every archive category id."""
        mapping = dict(plan.category_ids)
        keys = set(await db.scalars(select(Category.key).where(Category.key.is_not(None))))
        position = await db.scalar(select(func.max(Category.sort_order)))
        position = -1 if position is None else position
        now = utcnow()
        created: list[tuple[CategoryEntry, Category]] = []
        for entry in plan.categories:
            if current is not None:
                match = current.category(entry)
                if match is not None:
                    mapping[entry.id] = match
                    self.report.skipped("categories")
                    continue
                position += 1
            category = Category(
                id=entry.id if current is None else None,
                key=entry.key if entry.key and entry.key not in keys else None,
                name_es=entry.name_es,
                name_en=entry.name_en,
                name_pt=portuguese_name(entry),
                icon=entry.icon,
                color=entry.color,
                sort_order=entry.sort_order if current is None else position,
                created_at=entry.created_at or now,
                updated_at=entry.updated_at or entry.created_at or now,
            )
            if category.key:
                keys.add(category.key)
            db.add(category)
            created.append((entry, category))
        await db.flush()
        mapping.update((entry.id, category.id) for entry, category in created)
        self.report.created("categories", len(created))
        return mapping

    async def save_children(
        self, db: AsyncSession, plan: Plan, current: Existing | None, emails: dict[str, int]
    ) -> dict[int, int]:
        """Create the children with their avatars; returns the database id of every archive
        child id."""
        mapping = dict(plan.child_ids)
        position = await db.scalar(select(func.max(Child.sort_order)))
        position = -1 if position is None else position
        now = utcnow()
        created: list[tuple[ChildEntry, Child]] = []
        for entry in plan.children:
            if current is not None:
                found = current.slugs.get(entry.slug)
                if found is not None:
                    mapping[entry.id] = found
                    self.report.skipped("children")
                    self.report.skipped("media", entry.avatar is not None)
                    continue
                position += 1
            child = Child(
                id=entry.id if current is None else None,
                name=entry.name,
                slug=entry.slug,
                birth_date=entry.birth_date,
                color=entry.color,
                sort_order=entry.sort_order if current is None else position,
                created_at=entry.created_at or now,
                updated_at=entry.updated_at or entry.created_at or now,
            )
            db.add(child)
            created.append((entry, child))
        await db.flush()
        for entry, child in created:
            mapping[entry.id] = child.id
            prepared = None if entry.avatar is None else self.prepared.get(id(entry.avatar))
            if entry.avatar is not None and prepared is not None:
                [image] = await media.attach_pending(db, [prepared.id], purpose="avatar")
                self.describe(image, entry.avatar, emails)
                child.avatar_image_id = image.id
        self.report.created("children", len(created))
        return mapping

    async def day_orders(self, db: AsyncSession, plan: Plan) -> dict[int, int]:
        """Merge: new events of a day that already has events go first, in their archive order
        (by ``id()`` of their entry); the others keep their archive order."""
        lowest: dict[dt.date, int] = {
            date: first
            for date, first in await db.execute(
                select(Event.date, func.min(Event.day_order))
                .where(Event.deleted_at.is_(None))
                .group_by(Event.date)
            )
        }
        days: dict[dt.date, list[EventEntry]] = {}
        for entry in plan.events:
            if entry.deleted_at is None and entry.date in lowest:
                days.setdefault(entry.date, []).append(entry)
        orders: dict[int, int] = {}
        for date, entries in days.items():
            first = lowest[date] - len(entries)
            for index, entry in enumerate(sorted(entries, key=lambda item: item.day_order)):
                orders[id(entry)] = first + index
        return orders

    async def save_events(
        self,
        db: AsyncSession,
        manifest: Manifest,
        plan: Plan,
        current: Existing | None,
        emails: dict[str, int],
        categories: dict[int, int],
        children: dict[int, int],
    ) -> None:
        slugs = {child.id: child.slug for child in manifest.children}
        orders = {} if current is None else await self.day_orders(db, plan)
        now = utcnow()
        for entry in plan.events:
            if current is not None and event_key(entry, slugs) in current.event_keys:
                self.report.skipped("events")
                self.report.skipped("media", len(entry.images))
                continue
            child_ids = [children.get(child_id) for child_id in entry.child_ids]
            category_ids = [categories.get(category_id) for category_id in entry.category_ids]
            if None in child_ids or None in category_ids:
                code = "invalid_child" if None in child_ids else "invalid_category"
                self.report.failed("events", "event", entry.title, code)
                continue
            event = Event(
                id=entry.id if current is None else None,
                title=entry.title,
                title_search=title_search(entry.title),
                date=entry.date,
                day_order=orders.get(id(entry), entry.day_order),
                notes=entry.notes,
                location=entry.location,
                version=entry.version,
                created_by_id=self.user(emails, entry.created_by),
                updated_by_id=self.user(emails, entry.updated_by),
                deleted_by_id=self.user(emails, entry.deleted_by),
                created_at=entry.created_at or now,
                updated_at=entry.updated_at or entry.created_at or now,
                deleted_at=entry.deleted_at,
            )
            event.child_links = [
                EventChild(child_id=child_id) for child_id in dict.fromkeys(child_ids) if child_id
            ]
            event.category_links = [
                EventCategory(category_id=category_id, position=position)
                for position, category_id in enumerate(
                    category_id for category_id in dict.fromkeys(category_ids) if category_id
                )
            ]
            db.add(event)
            await db.flush()
            items = [
                (item, self.prepared[id(item)])
                for item in entry.images
                if id(item) in self.prepared
            ]
            images = await media.attach_pending(
                db, [prepared.id for _, prepared in items], purpose="event", event_id=event.id
            )
            for position, (image, (item, _)) in enumerate(zip(images, items, strict=True)):
                image.position = position
                image.live = item.live and image.is_live_photo
                crop = item.crop
                framing = (
                    None
                    if crop is None
                    else crops.normalize(crop.x, crop.y, crop.zoom, image.width, image.height)
                )
                image.crop_x, image.crop_y, image.crop_zoom = framing or (None, None, None)
                self.describe(image, item, emails)
            cover = (
                None if entry.cover is None else self.prepared.get(id(entry.images[entry.cover]))
            )
            ids = [image.id for image in images]
            event.cover_image_id = (
                cover.id if cover is not None and cover.id in ids else (ids[0] if ids else None)
            )
            self.report.created("events")

    async def save_year_colors(self, db: AsyncSession, plan: Plan) -> None:
        years = set(await db.scalars(select(YearColor.year)))
        now = utcnow()
        for entry in plan.year_colors:
            if entry.year in years:
                self.report.skipped("year_colors")
                continue
            db.add(YearColor(year=entry.year, color=entry.color, updated_at=now))
            years.add(entry.year)
            self.report.created("year_colors")
        await db.flush()

    async def save_settings(
        self, db: AsyncSession, manifest: Manifest, plan: Plan, emails: dict[str, int]
    ) -> None:
        """Settings not set yet, the background when there is none, and the default categories
        ever created (so that the next start does not bring deleted ones back)."""
        stored = await appearance.stored_settings(db, (*appearance.SETTING_KEYS,))
        values = {key: value for key, value in plan.settings.items() if key not in stored}
        if plan.background is not None:
            prepared = self.prepared.get(id(plan.background))
            current = await appearance.background_image(
                db, appearance.background_id(stored.get(appearance.BACKGROUND_KEY))
            )
            if prepared is not None and current is None:
                [image] = await media.attach_pending(db, [prepared.id], purpose="background")
                self.describe(image, plan.background, emails)
                values[appearance.BACKGROUND_KEY] = str(image.id)
            elif prepared is not None:
                self.report.skipped("media")
        marker = await db.get(AppSetting, SEEDED_CATEGORIES_KEY)
        seeded = set()
        if marker is not None and isinstance(marker.value, list):
            seeded = {str(key) for key in marker.value}
        seeded |= set(manifest.settings.seeded_categories)
        seeded |= {category.key for category in manifest.categories if category.key}
        values[SEEDED_CATEGORIES_KEY] = sorted(seeded)
        await appearance.store_settings(db, values)

    async def drop_unattached(self, db: AsyncSession) -> None:
        """Delete the prepared images nothing uses (their event was skipped or failed)."""
        unused = [image.id for image in self.prepared.values() if image.id not in self.attached]
        for batch in batches(unused):
            await db.execute(
                delete(Image).where(Image.id.in_(batch)), execution_options=UNSYNCHRONIZED
            )
        self.obsolete.extend(unused)
        self.report.counts["media"]["created"] = len(self.attached)

    def describe(self, image: Image, entry: MediaEntry, emails: dict[str, int]) -> None:
        """Name, uploader and date of an attached image, as the archive says."""
        image.name = entry.name
        image.uploaded_by_id = self.user(emails, entry.uploaded_by)
        if entry.created_at is not None:
            image.created_at = entry.created_at
        self.attached.add(image.id)

    @staticmethod
    def user(emails: dict[str, int], email: str | None) -> int | None:
        return None if email is None else emails.get(email)
