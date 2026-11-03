"""Administration → Import & export (``/api/admin/backup``): the routes, and ``Backups``
(``app.state.backups``), which owns the export lock, the import session and its background run.

One export or import runs at a time (409 ``backup_busy``) and there is one import session at a
time (409 ``import_busy``): see ``backup_export`` and ``backup_import``. The import runs in this
process, like the video conversions: run a single Uvicorn worker (as the container does)."""

import asyncio
import datetime as dt
import errno
import logging
import traceback
import uuid
from pathlib import Path
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.concurrency import run_in_threadpool

from . import backup_export, backup_import, media, video
from .auth import DB, AdminUser, SessionUser, settings
from .backup_format import IMPORT_CHUNK_BYTES
from .backup_import import ImportCancelled, Importer, ImportState, Progress
from .config import Settings
from .contracts import (
    BackupSummaryOut,
    ImportCreateIn,
    ImportId,
    ImportMode,
    ImportOut,
    ImportReportOut,
    ImportStartIn,
)
from .db import aware, utcnow
from .errors import AppError

log = logging.getLogger(__name__)

admin_router = APIRouter(prefix="/api/admin/backup", tags=["Backup"])


class Backups:
    """The export lock, the import session (``state``) and its background run."""

    def __init__(
        self, sessions: async_sessionmaker[AsyncSession], config: Settings, jobs: video.VideoJobs
    ) -> None:
        self.sessions = sessions
        self.config = config
        self.jobs = jobs
        self.state: ImportState | None = None
        # Serialises the changes of the session (chunks, start, discard…).
        self.lock = asyncio.Lock()
        self.exporting = False
        # The import run, which goes on after "finished" while it removes old image folders, and
        # the session it belongs to.
        self.task: asyncio.Task[None] | None = None
        self.task_session: str | None = None
        self.progress: Progress | None = None
        self.cancelling = False
        # A finished session discarded during that clean-up: removed once it is over.
        self.discard_after: str | None = None

    @property
    def media_dir(self) -> Path:
        return self.config.media_dir

    @property
    def running(self) -> bool:
        return self.state is not None and self.state.status == "running"

    # Lifecycle

    async def start(self) -> None:
        """Load the session left on disk: a run a restart interrupted goes back to "ready" with
        ``import_interrupted`` (what it prepared is deleted: nothing was applied), what a crash
        left of a run is finished (``backup_import.recover``, for every session folder, even a
        discarded one), and abandoned or old sessions are removed."""
        for import_id in await run_in_threadpool(backup_import.session_ids, self.media_dir):
            await backup_import.recover(self.sessions, self.media_dir, import_id)
        states = await run_in_threadpool(backup_import.load_states, self.media_dir)
        states.sort(key=lambda state: aware(state.created_at))
        for state in states[:-1]:
            await run_in_threadpool(backup_import.remove_session, self.media_dir, state.id)
        if not states:
            return
        state = states[-1]
        if state.status == "running":
            state.status, state.error = "ready", "import_interrupted"
            await self.save(state)
        if await run_in_threadpool(self.stale, state):
            await run_in_threadpool(backup_import.remove_session, self.media_dir, state.id)
            return
        if state.status == "uploading":
            path = backup_import.archive_path(self.media_dir, state.id)
            await run_in_threadpool(backup_import.truncate, path, state.received)
        self.state = state

    def stale(self, state: ImportState) -> bool:
        """An upload untouched for a day, any other session untouched for a week, or one whose
        archive is gone (worker thread: it checks the disk)."""
        age = utcnow() - aware(state.updated_at)
        if state.status == "uploading":
            return age > backup_import.ABANDONED_UPLOAD
        if state.status in {"ready", "invalid"} and not backup_import.archive_path(
            self.media_dir, state.id
        ).is_file():
            return True
        return age > backup_import.STALE_SESSION

    async def stop(self) -> None:
        task = self.task
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def idle(self) -> None:
        """Wait until the running import is over (tests)."""
        if self.task is not None:
            await asyncio.wait({self.task})

    async def save(self, state: ImportState) -> None:
        state.updated_at = utcnow()
        await run_in_threadpool(backup_import.save_state, self.media_dir, state)

    def out(self, state: ImportState) -> ImportOut:
        progress = self.progress if state.status == "running" else None
        return ImportOut(
            id=state.id,
            status=state.status,
            filename=state.filename,
            size=state.size,
            received=state.received,
            last_modified=state.last_modified,
            chunk_size=IMPORT_CHUNK_BYTES,
            archive=state.archive,
            mode=state.mode,
            progress=None if progress is None else progress.out(),
            report=state.report,
            error=state.error,
            created_at=state.created_at,
            updated_at=state.updated_at,
        )

    def current(self, import_id: str) -> ImportState:
        if self.state is None or self.state.id != import_id:
            raise AppError("import_not_found", 404)
        return self.state

    # Export

    def begin_export(self) -> None:
        if self.exporting or self.running:
            raise AppError("backup_busy", 409)
        self.exporting = True

    def end_export(self) -> None:
        self.exporting = False

    # Import

    async def create(self, body: ImportCreateIn) -> ImportState:
        async with self.lock:
            previous = self.state
            if previous is not None:
                if previous.status == "running" or (
                    previous.status != "finished"
                    and not await run_in_threadpool(self.stale, previous)
                ):
                    raise AppError("import_busy", 409, detail={"id": previous.id})
                await self.drop(previous)
            # The archive, then roughly as much again for the photos and videos it holds.
            await run_in_threadpool(backup_import.ensure_space, self.media_dir, 2 * body.size)
            now = utcnow()
            state = ImportState(
                id=uuid.uuid4().hex,
                status="uploading",
                filename=media.file_name(body.filename)[:255] or "backup.zip",
                size=body.size,
                last_modified=body.last_modified,
                created_at=now,
                updated_at=now,
            )
            folder = backup_import.session_folder(self.media_dir, state.id)
            await run_in_threadpool(folder.mkdir, parents=True)
            await self.save(state)
            self.state = state
            return state

    async def receive(self, import_id: str, offset: int, data: bytes) -> ImportState:
        async with self.lock:
            state = self.current(import_id)
            if state.status != "uploading":
                raise AppError("import_not_uploading", 409)
            if offset != state.received:
                raise AppError("import_offset_mismatch", 409, detail={"received": state.received})
            if not data or len(data) > state.size - state.received:
                raise AppError("import_size_mismatch", 422)
            path = backup_import.archive_path(self.media_dir, state.id)
            try:
                state.received = await run_in_threadpool(
                    backup_import.append_chunk, path, offset, data
                )
            except OSError as error:
                if error.errno == errno.ENOSPC:
                    raise AppError("import_no_space", 507) from None
                raise
            if state.received == state.size:
                try:
                    state.archive = await run_in_threadpool(backup_import.analyze, path)
                    state.status = "ready"
                except AppError as error:
                    state.status, state.error = "invalid", error.code
                except Exception as error:
                    log.error("Import archive not analysed (%s)", type(error).__name__)
                    state.status, state.error = "invalid", "invalid_import"
            await self.save(state)
            return state

    async def begin(self, import_id: str, mode: ImportMode, user: SessionUser) -> ImportState:
        async with self.lock:
            state = self.current(import_id)
            if state.status != "ready":
                raise AppError("import_not_ready", 409)
            # Another export, or the last run still removing the folders it replaced.
            if self.exporting or (self.task is not None and not self.task.done()):
                raise AppError("backup_busy", 409)
            # Room for the photos and videos (about the archive's size).
            await run_in_threadpool(backup_import.ensure_space, self.media_dir, state.size)
            state.status, state.mode, state.error, state.report = "running", mode, None, None
            state.started_by = user.id
            self.progress = Progress()
            self.cancelling = False
            await self.save(state)
            self.task = asyncio.create_task(self.run(state, self.progress), name="timelife-import")
            self.task_session = state.id
            return state

    async def run(self, state: ImportState, progress: Progress) -> None:
        assert state.mode is not None
        importer = Importer(
            self.sessions,
            self.config,
            self.jobs,
            archive=backup_import.archive_path(self.media_dir, state.id),
            work=backup_import.work_folder(self.media_dir, state.id),
            journal=backup_import.session_folder(self.media_dir, state.id),
            mode=state.mode,
            user_id=state.started_by,
            progress=progress,
            cancelled=lambda: self.cancelling,
        )
        report: ImportReportOut | None = None
        try:
            try:
                report = await importer.run()
            except asyncio.CancelledError:
                # A shutdown: once committed, the import has happened all the same.
                if importer.committed:
                    await self.finished(state, importer.report.out())
                else:
                    await self.stopped(state, "import_interrupted")
                raise
            except ImportCancelled:
                await self.stopped(state, "import_cancelled")
            except Exception as error:
                # Never log the message: it can contain SQL parameters or personal data.
                trace = "".join(traceback.format_tb(error.__traceback__))
                if importer.committed:
                    log.error("Import saved, then failed (%s)\n%s", type(error).__name__, trace)
                    report = importer.report.out()
                elif isinstance(error, AppError):
                    await self.stopped(state, error.code)
                else:
                    log.error("Import failed (%s)\n%s", type(error).__name__, trace)
                    await self.stopped(state, "import_failed")
            if report is not None:
                await self.finished(state, report)
                self.progress = None
                # The old folders go after "finished" is recorded; never undoes anything.
                await importer.finish()
                if self.discard_after == state.id:
                    self.discard_after = None
                    await run_in_threadpool(backup_import.remove_session, self.media_dir, state.id)
        finally:
            self.progress = None
            self.cancelling = False

    async def finished(self, state: ImportState, report: ImportReportOut) -> None:
        async with self.lock:
            state.status, state.report, state.error = "finished", report, None
            try:
                await run_in_threadpool(backup_import.remove_archive, self.media_dir, state.id)
                await self.save(state)
            except OSError as error:
                log.error("Import state not saved (%s)", type(error).__name__)

    async def stopped(self, state: ImportState, code: str) -> None:
        """A run that ended without applying anything (the importer already deleted what it
        prepared): back to "ready", the archive stays."""
        state.status, state.error = "ready", code
        try:
            await run_in_threadpool(backup_import.remove_work, self.media_dir, state.id)
            await self.save(state)
        except OSError as error:
            log.error("Import state not saved (%s)", type(error).__name__)

    def cancel(self, import_id: str) -> ImportState:
        state = self.current(import_id)
        if state.status != "running":
            raise AppError("import_not_running", 409)
        self.cancelling = True
        return state

    async def discard(self, import_id: str) -> None:
        async with self.lock:
            state = self.current(import_id)
            if state.status == "running":
                raise AppError("import_running", 409)
            await self.drop(state)

    async def drop(self, state: ImportState) -> None:
        """Forget a session and delete its folder. While its own finished run still removes old
        image folders, the folder (with the journal of that clean-up) goes once that is over;
        its state goes now, so that a restart does not bring the session back."""
        self.state = None
        cleaning = self.task is not None and not self.task.done()
        if cleaning and self.task_session == state.id:
            self.discard_after = state.id
            folder = backup_import.session_folder(self.media_dir, state.id)
            await run_in_threadpool(backup_import.remove_file, folder / backup_import.STATE_FILE)
            return
        await run_in_threadpool(backup_import.remove_session, self.media_dir, state.id)


def backups(request: Request) -> Backups:
    manager: Backups = request.app.state.backups
    return manager


# Routes -------------------------------------------------------------------------------------


@admin_router.get("/summary", response_model=BackupSummaryOut)
async def backup_summary(admin: AdminUser, db: DB) -> BackupSummaryOut:
    # What an export holds now; ``media_bytes`` estimates its size.
    return await backup_export.summary(db)


@admin_router.get(
    "/export",
    response_class=Response,
    responses={
        200: {
            "description": "ZIP with manifest.json and the original photos and videos",
            "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
async def export_backup(request: Request, admin: AdminUser, db: DB) -> Response:
    # Streams everything (users, categories, children, events with the trash, settings and the
    # original photos and videos) as one ZIP; 409 backup_busy while another export or an import
    # runs.
    manager = backups(request)
    config = settings(request)
    manager.begin_export()
    try:
        rows = await backup_export.read_rows(db, config.image_tag)
        # The download may last long: the database connection goes back now.
        await db.close()
        snapshot = await run_in_threadpool(backup_export.plan_files, rows, config.media_dir)
    except BaseException:
        manager.end_export()
        raise
    day = dt.datetime.now(ZoneInfo(config.tz)).date().isoformat()
    return backup_export.ArchiveResponse(snapshot, f"timelife-{day}.zip", manager.end_export)


@admin_router.get("/imports", response_model=list[ImportOut])
async def list_imports(request: Request, admin: AdminUser) -> list[ImportOut]:
    # The import session, if any (there is at most one).
    manager = backups(request)
    return [] if manager.state is None else [manager.out(manager.state)]


@admin_router.post("/imports", response_model=ImportOut, status_code=201)
async def create_import(body: ImportCreateIn, request: Request, admin: AdminUser) -> ImportOut:
    # Opens the upload of a backup of ``size`` bytes (send it with PUT .../content). 409
    # import_busy while another session exists (discard it first); 507 import_no_space.
    manager = backups(request)
    return manager.out(await manager.create(body))


@admin_router.get("/imports/{import_id}", response_model=ImportOut)
async def get_import(import_id: ImportId, request: Request, admin: AdminUser) -> ImportOut:
    # Poll it while "running" (``progress``); "finished" has the ``report``.
    manager = backups(request)
    return manager.out(manager.current(import_id))


@admin_router.put(
    "/imports/{import_id}/content",
    response_model=ImportOut,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            },
        }
    },
)
async def receive_import(
    import_id: ImportId,
    request: Request,
    admin: AdminUser,
    offset: Annotated[int, Query(ge=0, le=4 * 1024**4)],
) -> ImportOut:
    # The next bytes of the file (at most ``chunk_size``) starting at ``offset``, which must be
    # ``received`` (409 import_offset_mismatch with ``detail.received`` otherwise: resume from
    # there). With the last byte the archive is checked: "ready" or "invalid" (``error``).
    data = bytearray()
    async for piece in request.stream():
        data += piece
        if len(data) > IMPORT_CHUNK_BYTES:
            raise AppError("request_too_large", 413)
    manager = backups(request)
    return manager.out(await manager.receive(import_id, offset, bytes(data)))


@admin_router.post("/imports/{import_id}/start", response_model=ImportOut)
async def start_import(
    import_id: ImportId, body: ImportStartIn, request: Request, admin: AdminUser
) -> ImportOut:
    # Runs the import in the background ("running"; poll GET /imports/{id}). 409
    # import_not_ready unless "ready", backup_busy during an export or while the last import
    # still removes old files; 507 import_no_space.
    manager = backups(request)
    return manager.out(await manager.begin(import_id, body.mode, admin))


@admin_router.post("/imports/{import_id}/cancel", response_model=ImportOut)
async def cancel_import(import_id: ImportId, request: Request, admin: AdminUser) -> ImportOut:
    # Stops the run before it saves anything (it then goes back to "ready" with
    # import_cancelled); once saving, it finishes.
    manager = backups(request)
    return manager.out(manager.cancel(import_id))


@admin_router.delete("/imports/{import_id}", status_code=204)
async def discard_import(import_id: ImportId, request: Request, admin: AdminUser) -> None:
    # Deletes the session and its file (409 import_running while it runs: cancel it first).
    await backups(request).discard(import_id)
