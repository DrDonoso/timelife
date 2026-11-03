"""Outermost ASGI layer: host allow-list, same-origin check for mutations, body limits and staging,
administrator authentication before an admin body is read, concurrency guards and security
headers on every response."""

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable, Iterable
from tempfile import SpooledTemporaryFile
from urllib.parse import urlsplit

from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .auth import admin_user, current_user
from .backup_format import IMPORT_CHUNK_BYTES
from .config import LOOPBACK_HOSTS, Settings, normalize_origin
from .errors import AppError

log = logging.getLogger(__name__)

MUTATIONS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
CSRF_HEADER = "x-timelife-request"
ADMIN_PREFIX = "/api/admin/"
AUTH_PREFIX = "/api/auth/"
UPLOAD_PATH = "/api/admin/uploads"
# The pieces of a backup being imported (``backup``).
IMPORT_CONTENT_PATH = re.compile(r"/api/admin/backup/imports/[0-9a-f]{32}/content")
AUTH_BODY_BYTES = 16 * 1024
JSON_BODY_BYTES = 512 * 1024
BODY_CHUNK_BYTES = 64 * 1024
# Deadline to receive a whole body; uploads (authenticated admins only) may be large videos sent
# over slow links.
BODY_TIMEOUT_SECONDS = 30.0
UPLOAD_TIMEOUT_SECONDS = 1800.0
MAX_ACTIVE_MUTATIONS = 16
MAX_ACTIVE_LARGE_BODIES = 4
MAX_ACTIVE_CLIENT_MUTATIONS = 4
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; "
    "base-uri 'none'; form-action 'self'; object-src 'none'"
)
SECURITY_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
    (b"content-security-policy", CONTENT_SECURITY_POLICY.encode()),
)
HSTS = (b"strict-transport-security", b"max-age=31536000")
OWNED_HEADERS = frozenset(name for name, _ in (*SECURITY_HEADERS, HSTS))


def with_security_headers(
    headers: Iterable[tuple[bytes, bytes]], secure: bool
) -> list[tuple[bytes, bytes]]:
    """Response headers plus the security headers (replacing any copy a route set), HSTS when
    cookies are Secure, and ``cache-control: no-store`` unless the route chose its own caching."""
    result = [(name, value) for name, value in headers if name.lower() not in OWNED_HEADERS]
    cacheable = any(name.lower() == b"cache-control" for name, _ in result)
    result.extend(SECURITY_HEADERS)
    if secure:
        result.append(HSTS)
    if not cacheable:
        result.append((b"cache-control", b"no-store"))
    return result


def request_host(headers: Headers) -> str | None:
    """Host name of the single ``Host`` header, or None when missing, repeated or malformed."""
    values = headers.getlist("host")
    if len(values) != 1:
        return None
    try:
        return urlsplit(normalize_origin("http://" + values[0])).hostname
    except ValueError:
        return None


def request_origin(headers: Headers) -> str | None:
    """Normalised single ``Origin`` header, or None when missing, repeated or malformed."""
    values = headers.getlist("origin")
    if len(values) != 1:
        return None
    try:
        return normalize_origin(values[0])
    except ValueError:
        return None


def body_limit(method: str, path: str, config: Settings) -> tuple[int, str]:
    """Largest accepted body for a mutation and the 413 code reported beyond it. An upload may
    hold a photo and a video (a Live Photo and its clip); an import piece is at most
    ``IMPORT_CHUNK_BYTES``."""
    if method == "POST" and path == UPLOAD_PATH:
        limit = config.max_upload_bytes + config.max_video_upload_bytes
        return limit + BODY_CHUNK_BYTES, "upload_too_large"
    if method == "PUT" and IMPORT_CONTENT_PATH.fullmatch(path):
        return IMPORT_CHUNK_BYTES, "request_too_large"
    if path.startswith(AUTH_PREFIX):
        return AUTH_BODY_BYTES, "request_too_large"
    return JSON_BODY_BYTES, "request_too_large"


async def authenticate_admin(scope: Scope) -> None:
    """``AppError`` 401/403 unless the request carries a valid administrator session."""
    request = Request(scope)
    async with request.app.state.sessions() as db:
        await admin_user(await current_user(request, db))


class SecurityMiddleware:
    """Wraps the whole application: ``app.TimelifeApp.build_middleware_stack`` returns
    ``SecurityMiddleware(stack, lambda: app.state.settings)``."""

    def __init__(self, app: ASGIApp, config: Callable[[], Settings]) -> None:
        self.app = app
        self.config = config
        self.active_mutations = 0
        self.active_large_bodies = 0
        self.active_clients: dict[str, int] = {}
        self.allowed: tuple[Settings, tuple[str, ...], frozenset[str]] | None = None

    def allow_lists(self, config: Settings) -> tuple[tuple[str, ...], frozenset[str]]:
        """Public origins and accepted host names (theirs plus loopback), cached per settings."""
        if self.allowed is None or self.allowed[0] is not config:
            origins = config.public_origins
            hosts = frozenset(
                {*(urlsplit(origin).hostname or "" for origin in origins), *LOOPBACK_HOSTS}
            )
            self.allowed = (config, origins, hosts)
        return self.allowed[1], self.allowed[2]

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def tracked_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.dispatch(scope, receive, tracked_send)
        except Exception as error:
            # Starlette answers 500 and then re-raises so the server logs the exception, whose
            # message can hold SQL parameters or personal data. The app's handler already logged
            # the type and traceback, so the exception stops here.
            if started:
                return
            log.error("Unhandled %s before a response", type(error).__name__)
            secure = self.config().auth_cookie_secure

            async def secure_send(message: Message) -> None:
                if message["type"] == "http.response.start":
                    message["headers"] = with_security_headers(message.get("headers", []), secure)
                await send(message)

            await JSONResponse({"code": "internal_error"}, 500)(scope, receive, secure_send)

    async def dispatch(self, scope: Scope, receive: Receive, send: Send) -> None:
        config = self.config()
        origins, hosts = self.allow_lists(config)

        async def secure_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                message["headers"] = with_security_headers(
                    message.get("headers", []), config.auth_cookie_secure
                )
            await send(message)

        async def reply(code: str, status: int, headers: dict[str, str] | None = None) -> None:
            await JSONResponse({"code": code}, status, headers=headers)(
                scope, receive, secure_send
            )

        headers = Headers(scope=scope)
        if request_host(headers) not in hosts:
            await reply("invalid_host", 400)
            return
        method = scope["method"]
        if method not in MUTATIONS:
            await self.app(scope, receive, secure_send)
            return
        if request_origin(headers) not in origins or headers.getlist(CSRF_HEADER) != ["1"]:
            await reply("invalid_origin", 403)
            return
        path = scope["path"].rstrip("/")
        limit, too_large = body_limit(method, path, config)
        lengths = headers.getlist("content-length")
        if lengths:
            if (
                len(lengths) != 1
                or not lengths[0].isascii()
                or not lengths[0].isdigit()
                or len(lengths[0]) > 20
            ):
                await reply("invalid_request", 400)
                return
            if int(lengths[0]) > limit:
                await reply(too_large, 413)
                return
        client = scope["client"][0] if scope.get("client") else "unknown"
        large = limit > JSON_BODY_BYTES
        if (
            self.active_mutations >= MAX_ACTIVE_MUTATIONS
            or self.active_clients.get(client, 0) >= MAX_ACTIVE_CLIENT_MUTATIONS
            or (large and self.active_large_bodies >= MAX_ACTIVE_LARGE_BODIES)
        ):
            await reply("request_busy", 503, {"Retry-After": "1"})
            return
        # No await between the admission check and the reservation: one event loop per worker.
        self.active_mutations += 1
        self.active_large_bodies += int(large)
        self.active_clients[client] = self.active_clients.get(client, 0) + 1
        try:
            if path.startswith(ADMIN_PREFIX):
                try:
                    await authenticate_admin(scope)
                except AppError as error:
                    await reply(error.code, error.status)
                    return
                except (SQLAlchemyError, OSError) as error:
                    log.error("Administrator check unavailable (%s)", type(error).__name__)
                    await reply("internal_error", 503)
                    return
            timeout = UPLOAD_TIMEOUT_SECONDS if large else BODY_TIMEOUT_SECONDS
            await self.forward(scope, receive, secure_send, reply, limit, too_large, timeout)
        finally:
            self.active_mutations -= 1
            self.active_large_bodies -= int(large)
            self.active_clients[client] -= 1
            if not self.active_clients[client]:
                del self.active_clients[client]

    async def forward(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        reply: Callable[[str, int], Awaitable[None]],
        limit: int,
        too_large: str,
        timeout: float,
    ) -> None:
        """Stage the whole body (memory, then a temporary file) within ``limit`` bytes and
        ``timeout`` seconds, then run the application replaying it."""
        with SpooledTemporaryFile(max_size=BODY_CHUNK_BYTES, mode="w+b") as body:
            size = 0
            on_disk = False
            failure: tuple[str, int] | None = None
            try:
                async with asyncio.timeout(timeout):
                    while True:
                        message = await receive()
                        if message["type"] == "http.disconnect":
                            return
                        chunk = message.get("body", b"")
                        size += len(chunk)
                        if size > limit:
                            failure = (too_large, 413)
                            break
                        if size > BODY_CHUNK_BYTES and not on_disk:
                            await run_in_threadpool(body.rollover)
                            on_disk = True
                        if on_disk:
                            await run_in_threadpool(body.write, chunk)
                        else:
                            body.write(chunk)
                        if not message.get("more_body", False):
                            break
                body.seek(0)
            except TimeoutError:
                failure = ("request_timeout", 408)
            except OSError as error:
                log.error("Request body could not be staged (%s)", type(error).__name__)
                failure = ("internal_error", 503)
            if failure is not None:
                await reply(*failure)
                return
            remaining = size
            replayed = False

            async def staged_receive() -> Message:
                nonlocal remaining, replayed
                if replayed:
                    return await receive()
                if on_disk:
                    chunk = await run_in_threadpool(body.read, BODY_CHUNK_BYTES)
                else:
                    chunk = body.read(BODY_CHUNK_BYTES)
                remaining -= len(chunk)
                replayed = remaining <= 0 or not chunk
                return {"type": "http.request", "body": chunk, "more_body": not replayed}

            await self.app(scope, staged_receive, send)
