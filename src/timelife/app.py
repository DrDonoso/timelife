import logging
import re
import traceback
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Scope

from . import (
    __version__,
    appearance,
    auth,
    backup,
    categories,
    children,
    events,
    google_auth,
    mail,
    media,
    password_auth,
    setup,
    timeline,
    users,
    video,
)
from .config import Settings
from .contracts import HealthOut, VersionOut
from .db import create_db_engine
from .errors import AppError
from .middleware import SecurityMiddleware

log = logging.getLogger(__name__)

# Built SPA, relative to the working directory (/app in Docker).
FRONTEND_DIST = Path("frontend/dist")
SPA_PATHS = frozenset({"", "login", "setup", "reset-password", "admin", "all"})
SPA_PREFIXES = ("c/", "all/", "admin/")
ROOT_FILE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"


class TimelifeApp(FastAPI):
    def build_middleware_stack(self) -> ASGIApp:
        return SecurityMiddleware(super().build_middleware_stack(), lambda: self.state.settings)


class AssetFiles(StaticFiles):
    """Fingerprinted Vite assets: safe to cache forever."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        if response.status_code in {200, 304}:
            response.headers["cache-control"] = IMMUTABLE
        return response


def validation_fields(errors: Sequence[Any]) -> dict[str, str]:
    """Map each invalid input (its last named location) to the first pydantic error type."""
    fields: dict[str, str] = {}
    for error in errors:
        names = [item for item in error.get("loc", ()) if isinstance(item, str)]
        fields.setdefault(names[-1] if names else "body", str(error.get("type", "value_error")))
    return fields


def create_app(config: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        current = config or Settings()
        application.state.settings = current
        current.media_dir.mkdir(parents=True, exist_ok=True)
        engine = create_db_engine(current.database_url)
        provider: google_auth.GoogleProvider | None = None
        jobs: video.VideoJobs | None = None
        backups: backup.Backups | None = None
        try:
            application.state.sessions = async_sessionmaker(engine, expire_on_commit=False)
            provider = google_auth.GoogleProvider(current)
            application.state.google_provider = provider
            application.state.mailer = mail.Mailer(current)
            jobs = video.VideoJobs(application.state.sessions, current.media_dir)
            application.state.video_jobs = jobs
            backups = backup.Backups(application.state.sessions, current, jobs)
            application.state.backups = backups
            try:
                async with application.state.sessions() as db:
                    await auth.purge_expired(db)
                    await media.cleanup_orphans(db, current.media_dir)
                # An import a restart interrupted is undone first (its media are not converted).
                await backups.start()
                # Conversions interrupted by a restart run again.
                await jobs.start()
            except SQLAlchemyError as error:
                raise RuntimeError(
                    "Database not ready: check DATABASE_URL and run 'alembic upgrade head'"
                ) from error
            yield
        finally:
            if backups is not None:
                await backups.stop()
            if jobs is not None:
                await jobs.stop()
            if provider is not None:
                await provider.close()
            await engine.dispose()

    application = TimelifeApp(
        title="Timelife",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @application.exception_handler(AppError)
    async def known_error(request: Request, error: AppError) -> JSONResponse:
        return JSONResponse(error.payload, status_code=error.status, headers=error.headers)

    @application.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError) -> JSONResponse:
        content: dict[str, object] = {"code": "invalid_request"}
        fields = validation_fields(error.errors())
        if fields:
            content["fields"] = fields
        return JSONResponse(content, status_code=422)

    @application.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, error: StarletteHTTPException) -> JSONResponse:
        code = "not_found" if error.status_code == 404 else "invalid_request"
        return JSONResponse({"code": code}, status_code=error.status_code, headers=error.headers)

    @application.exception_handler(Exception)
    async def unexpected(request: Request, error: Exception) -> JSONResponse:
        # Never log the message: it can contain SQL parameters or personal data.
        log.error(
            "Unhandled %s\n%s",
            type(error).__name__,
            "".join(traceback.format_tb(error.__traceback__)),
        )
        return JSONResponse({"code": "internal_error"}, status_code=500)

    for router in (
        auth.router,
        password_auth.router,
        setup.router,
        google_auth.router,
        users.admin_router,
        children.router,
        children.admin_router,
        categories.router,
        categories.admin_router,
        media.router,
        media.admin_router,
        events.router,
        events.admin_router,
        timeline.router,
        appearance.router,
        appearance.admin_router,
        backup.admin_router,
    ):
        application.include_router(router)

    @application.get("/health", response_model=HealthOut, tags=["Platform"])
    async def health(db: auth.DB) -> HealthOut:
        try:
            await db.execute(text("SELECT 1"))
        except (SQLAlchemyError, OSError) as error:
            log.warning("Health check failed (%s)", type(error).__name__)
            raise AppError("internal_error", 503) from None
        return HealthOut(status="ok")

    @application.get("/api/version", response_model=VersionOut, tags=["Platform"])
    async def version(request: Request) -> VersionOut:
        current = auth.settings(request)
        return VersionOut(version=current.image_tag, build_date=current.build_date)

    dist = FRONTEND_DIST
    if (dist / "assets").is_dir():
        application.mount("/assets", AssetFiles(directory=dist / "assets"), name="assets")

    @application.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str) -> Response:
        if ROOT_FILE.fullmatch(path) and (dist / path).is_file():
            return FileResponse(dist / path, headers={"cache-control": REVALIDATE})
        if path not in SPA_PATHS and not path.startswith(SPA_PREFIXES):
            raise AppError("not_found", 404)
        index = dist / "index.html"
        if not index.is_file():
            raise AppError("frontend_not_built", 503)
        return FileResponse(index, headers={"cache-control": REVALIDATE})

    return application


app = create_app()
