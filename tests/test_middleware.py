"""SecurityMiddleware: host/origin checks, body limits and staging, admin pre-authentication,
concurrency guards and security headers."""

import asyncio
import json
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from timelife import middleware
from timelife.auth import SESSION_COOKIE
from timelife.config import Settings
from timelife.middleware import CONTENT_SECURITY_POLICY, SecurityMiddleware, body_limit

from .conftest import TEST_ORIGIN, app_client, login_as, make_settings

KIB = 1024
HOST = [("host", "testserver")]
GOOD = [*HOST, ("origin", TEST_ORIGIN), ("x-timelife-request", "1")]
EXPECTED_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": CONTENT_SECURITY_POLICY,
}


@dataclass
class Result:
    status: int | None = None
    headers: list[tuple[str, str]] = field(default_factory=list)
    body: bytes = b""
    received: int = 0

    def header(self, name: str) -> list[str]:
        return [value for key, value in self.headers if key == name]

    @property
    def json(self) -> Any:
        return json.loads(self.body)


async def call(
    app: ASGIApp,
    method: str = "POST",
    path: str = "/api/children",
    headers: Sequence[tuple[str, str]] = GOOD,
    chunks: Sequence[bytes] = (b"",),
    *,
    client: str = "203.0.113.5",
    stall: bool = False,
    disconnect: bool = False,
) -> Result:
    """Drive one raw ASGI request: ``chunks`` are the body messages; ``stall`` keeps the body
    open forever and ``disconnect`` ends it with ``http.disconnect``."""
    result = Result()
    pending = list(chunks)
    finished = asyncio.Event()

    async def receive() -> Message:
        result.received += 1
        if pending:
            chunk = pending.pop(0)
            more = bool(pending) or stall or disconnect
            return {"type": "http.request", "body": chunk, "more_body": more}
        if disconnect:
            return {"type": "http.disconnect"}
        await finished.wait()
        return {"type": "http.disconnect"}

    async def send(message: Message) -> None:
        if message["type"] == "http.response.start":
            result.status = message["status"]
            result.headers = [
                (bytes(key).decode().lower(), bytes(value).decode())
                for key, value in message["headers"]
            ]
        elif message["type"] == "http.response.body":
            result.body += message.get("body", b"")
            if not message.get("more_body"):
                finished.set()

    scope: Scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "server": ("testserver", 80),
        "client": (client, 1234),
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "query_string": b"",
        "headers": [(key.encode("latin-1"), value.encode("latin-1")) for key, value in headers],
    }
    await app(scope, receive, send)
    return result


class Echo:
    """Inner application: reads the whole body, optionally waits on ``gate`` and echoes it."""

    def __init__(self, response_headers: Sequence[tuple[bytes, bytes]] = ()) -> None:
        self.bodies: list[bytes] = []
        self.gate: asyncio.Event | None = None
        self.entered = 0
        self.response_headers = list(response_headers)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            self.bodies.append(scope["type"].encode())
            return
        self.entered += 1
        body = b""
        while True:
            message = await receive()
            body += message.get("body", b"")
            if not message.get("more_body"):
                break
        self.bodies.append(body)
        if self.gate is not None:
            await self.gate.wait()
        await send(
            {"type": "http.response.start", "status": 200, "headers": self.response_headers}
        )
        await send({"type": "http.response.body", "body": body})


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return make_settings(
        "sqlite+aiosqlite://", tmp_path / "media", max_upload_mb=1, max_video_upload_mb=2
    )


def secured(app: ASGIApp, config: Settings) -> SecurityMiddleware:
    return SecurityMiddleware(app, lambda: config)


def assert_security_headers(headers: Any, *, hsts: bool = False) -> None:
    for name, value in EXPECTED_HEADERS.items():
        assert headers[name] == value, name
    assert ("strict-transport-security" in headers) is hsts
    if hsts:
        assert headers["strict-transport-security"] == "max-age=31536000"


def test_security_headers_are_on_every_response(client: TestClient) -> None:
    responses = [
        client.get("/health"),
        client.get("/api/missing"),
        client.get("/api/children"),
        client.get("/health", headers={"host": "evil.example.com"}),
        client.post("/api/auth/logout", headers={"origin": "https://evil.example.com"}),
    ]
    assert [response.status_code for response in responses] == [200, 404, 401, 400, 403]
    for response in responses:
        assert_security_headers(response.headers)
        assert response.headers.get_list("cache-control") == ["no-store"]


def test_hsts_is_sent_with_secure_cookies(config_factory: Any) -> None:
    config = config_factory(public_origin="https://timelife.example.com", auth_cookie_secure=True)
    with app_client(config) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert_security_headers(response.headers, hsts=True)


async def test_routes_keep_their_own_cache_control_but_not_security_headers(
    settings: Settings,
) -> None:
    inner = Echo(
        [
            (b"cache-control", b"private, max-age=60"),
            (b"x-frame-options", b"SAMEORIGIN"),
            (b"content-security-policy", b"default-src *"),
        ]
    )
    result = await call(secured(inner, settings), "GET", "/api/media/x/thumb")
    assert result.status == 200
    assert result.header("cache-control") == ["private, max-age=60"]
    assert result.header("x-frame-options") == ["DENY"]
    assert result.header("content-security-policy") == [CONTENT_SECURITY_POLICY]


@pytest.mark.parametrize("host", ["testserver", "localhost:7779", "127.0.0.1", "[::1]:7779"])
def test_public_and_loopback_hosts_are_accepted(client: TestClient, host: str) -> None:
    assert client.get("/health", headers={"host": host}).status_code == 200


@pytest.mark.parametrize(
    "hosts",
    [
        [("host", "evil.example.com")],
        [("host", "testserver.evil.com")],
        [("host", "a b")],
        [("host", "testserver/path")],
        [("host", "user@testserver")],
        [],
        [("host", "testserver"), ("host", "testserver")],
    ],
)
async def test_other_hosts_are_rejected(settings: Settings, hosts: list[tuple[str, str]]) -> None:
    inner = Echo()
    result = await call(secured(inner, settings), "GET", "/health", hosts)
    assert (result.status, result.json) == (400, {"code": "invalid_host"})
    assert inner.entered == 0


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
@pytest.mark.parametrize(
    "headers",
    [
        [("host", "testserver"), ("x-timelife-request", "1")],
        [*HOST, ("origin", "https://evil.example.com"), ("x-timelife-request", "1")],
        [*HOST, ("origin", "null"), ("x-timelife-request", "1")],
        [*HOST, ("origin", "http://testserver:8080"), ("x-timelife-request", "1")],
        [
            ("host", "testserver"),
            ("origin", TEST_ORIGIN),
            ("origin", TEST_ORIGIN),
            ("x-timelife-request", "1"),
        ],
        [("host", "testserver"), ("origin", TEST_ORIGIN)],
        [("host", "testserver"), ("origin", TEST_ORIGIN), ("x-timelife-request", "true")],
        [
            ("host", "testserver"),
            ("origin", TEST_ORIGIN),
            ("x-timelife-request", "1"),
            ("x-timelife-request", "1"),
        ],
    ],
)
async def test_mutations_need_the_public_origin_and_csrf_header(
    settings: Settings, method: str, headers: list[tuple[str, str]]
) -> None:
    inner = Echo()
    result = await call(secured(inner, settings), method, "/api/children", headers)
    assert (result.status, result.json) == (403, {"code": "invalid_origin"})
    assert inner.entered == 0 and result.received == 0


async def test_safe_methods_and_valid_mutations_pass(settings: Settings) -> None:
    inner = Echo()
    app = secured(inner, settings)
    assert (await call(app, "GET", "/api/children", [("host", "testserver")])).status == 200
    assert (await call(app, "HEAD", "/api/children", [("host", "testserver")])).status == 200
    normalised = [("host", "testserver"), ("origin", "HTTP://TestServer:80/")]
    result = await call(app, "POST", "/api/children", [*normalised, ("x-timelife-request", "1")])
    assert result.status == 200


def test_body_limits_by_route(settings: Settings) -> None:
    # An upload may carry a photo and a video (a Live Photo and its clip).
    assert body_limit("POST", "/api/admin/uploads", settings) == (
        3 * 1024 * KIB + 64 * KIB,
        "upload_too_large",
    )
    assert body_limit("PUT", "/api/admin/uploads", settings) == (512 * KIB, "request_too_large")
    assert body_limit("POST", "/api/auth/dev-login", settings) == (16 * KIB, "request_too_large")
    assert body_limit("POST", "/api/auth/google/start", settings) == (
        16 * KIB,
        "request_too_large",
    )
    assert body_limit("PUT", "/api/admin/events/1", settings) == (512 * KIB, "request_too_large")


@pytest.mark.parametrize(
    ("path", "limit"), [("/api/auth/dev-login", 16 * KIB), ("/api/admin/events", 512 * KIB)]
)
async def test_declared_oversized_bodies_are_refused_unread(
    settings: Settings, path: str, limit: int
) -> None:
    inner = Echo()
    headers = [*GOOD, ("content-length", str(limit + 1))]
    result = await call(secured(inner, settings), "POST", path, headers, [b"x" * (limit + 1)])
    assert (result.status, result.json) == (413, {"code": "request_too_large"})
    assert result.received == 0 and inner.entered == 0


async def test_streamed_bodies_are_cut_at_the_limit(settings: Settings) -> None:
    inner = Echo()
    app = secured(inner, settings)
    chunks = [b"x" * (100 * KIB)] * 10  # 1000 KiB without Content-Length
    result = await call(app, "POST", "/api/children", GOOD, chunks)
    assert (result.status, result.json) == (413, {"code": "request_too_large"})
    assert inner.entered == 0 and result.received == 6  # stops reading past 512 KiB

    exact = [b"y" * (16 * KIB)]
    assert (await call(app, "POST", "/api/auth/dev-login", GOOD, exact)).status == 200
    assert inner.bodies == exact


@pytest.mark.parametrize(
    "lengths", [["abc"], ["-1"], ["1, 2"], ["²"], ["1" * 21], ["10", "10"]]
)
async def test_malformed_content_length_is_rejected(
    settings: Settings, lengths: list[str]
) -> None:
    headers = [*GOOD, *(("content-length", value) for value in lengths)]
    result = await call(secured(Echo(), settings), "POST", "/api/children", headers)
    assert (result.status, result.json) == (400, {"code": "invalid_request"})


@pytest.mark.parametrize("size", [0, 10, 64 * KIB, 64 * KIB + 1, 300 * KIB, 512 * KIB])
async def test_staged_bodies_are_replayed_exactly(settings: Settings, size: int) -> None:
    inner = Echo()
    payload = bytes(index % 251 for index in range(size))
    chunks = [payload[index : index + 7000] for index in range(0, size, 7000)] or [b""]
    result = await call(secured(inner, settings), "PUT", "/api/children/order", GOOD, chunks)
    assert result.status == 200
    assert inner.bodies == [payload]
    assert result.body == payload


async def test_slow_bodies_time_out(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(middleware, "BODY_TIMEOUT_SECONDS", 0.05)
    inner = Echo()
    app = secured(inner, settings)
    result = await call(app, "POST", "/api/children", GOOD, [b"{"], stall=True)
    assert (result.status, result.json) == (408, {"code": "request_timeout"})
    assert inner.entered == 0
    assert (app.active_mutations, app.active_clients) == (0, {})


async def test_client_disconnects_while_staging_end_quietly(settings: Settings) -> None:
    inner = Echo()
    app = secured(inner, settings)
    result = await call(app, "POST", "/api/children", GOOD, [b"{", b"}"], disconnect=True)
    assert result.status is None and inner.entered == 0
    assert (app.active_mutations, app.active_clients) == (0, {})


async def test_concurrent_mutations_are_bounded(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def anyone(scope: Scope) -> None:
        return None

    monkeypatch.setattr(middleware, "authenticate_admin", anyone)
    inner = Echo()
    inner.gate = asyncio.Event()
    app = secured(inner, settings)

    async def until_entered(count: int) -> None:
        while inner.entered < count:
            await asyncio.sleep(0)

    def start(client: str, path: str = "/api/children") -> "asyncio.Task[Result]":
        return asyncio.create_task(call(app, "POST", path, GOOD, [b"{}"], client=client))

    first = [start("10.0.0.1") for _ in range(4)]
    await until_entered(4)
    busy = await call(app, "POST", "/api/children", GOOD, [b"{}"], client="10.0.0.1")
    assert (busy.status, busy.json) == (503, {"code": "request_busy"})
    assert busy.header("retry-after") == ["1"]
    assert busy.received == 0

    uploads = [start(f"10.0.1.{index}", "/api/admin/uploads") for index in range(4)]
    await until_entered(8)
    upload = await call(app, "POST", "/api/admin/uploads", GOOD, [b"x"], client="10.0.1.9")
    assert upload.status == 503

    others = [start(f"10.0.2.{index}") for index in range(8)]
    await until_entered(16)
    overall = await call(app, "POST", "/api/children", GOOD, [b"{}"], client="10.0.3.1")
    assert overall.status == 503

    inner.gate.set()
    results = await asyncio.gather(*first, *uploads, *others)
    assert {result.status for result in results} == {200}
    assert (app.active_mutations, app.active_large_bodies, app.active_clients) == (0, 0, {})


async def test_non_http_scopes_pass_through(settings: Settings) -> None:
    inner = Echo()
    app = secured(inner, settings)

    async def receive() -> Message:
        return {"type": "lifespan.startup"}

    async def send(message: Message) -> None:
        return None

    await app({"type": "websocket", "path": "/ws", "headers": []}, receive, send)
    assert inner.bodies == [b"websocket"]


@pytest.fixture
def small_uploads(config_factory: Any) -> Iterator[TestClient]:
    with app_client(config_factory(max_upload_mb=1, max_video_upload_mb=2)) as client:
        yield client


def raw_call(client: TestClient, *args: Any, **kwargs: Any) -> Result:
    """``call`` against the started application, inside its own event loop."""
    assert client.portal is not None
    return client.portal.call(lambda: call(client.app, *args, **kwargs))


def with_session(client: TestClient) -> list[tuple[str, str]]:
    token = client.cookies.get(SESSION_COOKIE)
    assert token
    return [*GOOD, ("cookie", f"{SESSION_COOKIE}={token}")]


def test_admin_mutations_authenticate_before_reading_the_body(small_uploads: TestClient) -> None:
    body = [b'{"email": "nuevo@example.com"}']
    anonymous = raw_call(small_uploads, "POST", "/api/admin/users", GOOD, body)
    assert (anonymous.status, anonymous.json) == (401, {"code": "authentication_required"})
    assert anonymous.received == 0
    assert_security_headers(dict(anonymous.headers))

    login_as(small_uploads, "viewer")
    viewer = raw_call(small_uploads, "POST", "/api/admin/users", with_session(small_uploads), body)
    assert (viewer.status, viewer.json) == (403, {"code": "admin_required"})
    assert viewer.received == 0

    login_as(small_uploads, "admin")
    invalid = [b'{"email": "not-an-email"}']
    headers = with_session(small_uploads)
    admin = raw_call(small_uploads, "POST", "/api/admin/users", headers, invalid)
    assert admin.received >= 1
    assert (admin.status, admin.json["code"]) == (422, "invalid_request")


def test_upload_limit_follows_max_upload_mb(small_uploads: TestClient) -> None:
    # MAX_UPLOAD_MB + MAX_VIDEO_UPLOAD_MB (a Live Photo and its clip), plus one chunk.
    limit = 3 * 1024 * KIB + 64 * KIB
    declared = small_uploads.post(
        "/api/admin/uploads?purpose=event",
        content=b"x" * (limit + 1),
        headers={"content-type": "application/octet-stream"},
    )
    assert declared.status_code == 413
    assert declared.json() == {"code": "upload_too_large"}

    def stream() -> Iterator[bytes]:
        for _ in range(50):
            yield b"x" * (64 * KIB)  # 3200 KiB > limit, sent without Content-Length

    anonymous = small_uploads.post("/api/admin/uploads?purpose=event", content=stream())
    assert anonymous.status_code == 401

    login_as(small_uploads, "admin")
    streamed = small_uploads.post("/api/admin/uploads?purpose=event", content=stream())
    assert streamed.status_code == 413
    assert streamed.json() == {"code": "upload_too_large"}

    within = small_uploads.post(
        "/api/admin/uploads?purpose=event",
        files={"file": ("photo.jpg", b"x" * (limit - 4 * KIB), "image/jpeg")},
    )
    assert within.status_code not in {401, 403, 413}
