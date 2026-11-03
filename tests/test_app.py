import asyncio
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import Field

from timelife import app as app_module
from timelife.app import create_app
from timelife.config import Settings
from timelife.contracts import Contract
from timelife.db import create_db_engine
from timelife.errors import AppError

from .conftest import TEST_HEADERS


def test_health_and_version(client: TestClient) -> None:
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}

    version = client.get("/api/version")
    assert version.status_code == 200
    assert version.json() == {"version": "test", "build_date": "2026-01-01"}


def test_auth_config_and_anonymous_session(client: TestClient) -> None:
    assert client.get("/api/auth/config").json() == {
        "google_enabled": False,
        "dev_login_enabled": False,
        "password_reset_enabled": False,
        # A new installation: no administrator yet.
        "setup_required": True,
    }
    session = client.get("/api/auth/session")
    assert session.status_code == 200
    assert session.json() == {"authenticated": False, "user": None}


@pytest.mark.parametrize(
    "path",
    ["/api/children", "/api/categories", "/api/appearance", "/api/events/1", "/api/admin/users"],
)
def test_protected_endpoints_require_a_session(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 401
    assert response.json() == {"code": "authentication_required"}


def test_unknown_paths_are_json_errors(client: TestClient) -> None:
    for path in ("/api/missing", "/nothing-here", "/api/admin/trash/1"):
        response = client.get(path)
        assert response.status_code == 404, path
        assert response.json() == {"code": "not_found"}
    wrong_method = client.post("/api/missing")
    assert wrong_method.status_code == 405
    assert wrong_method.json() == {"code": "invalid_request"}


class ProbeIn(Contract):
    name: str = Field(max_length=3)
    ids: list[int]


def error_probe_app(config: Settings, *, raise_server_exceptions: bool = False) -> TestClient:
    application = create_app(config)

    async def stub() -> None:
        raise AppError("not_implemented", 501, fields={"name": "taken"}, detail={"events": 2})

    async def crash() -> None:
        secret = "-".join(["classified", "payload"])
        raise RuntimeError(secret)

    async def validate(body: ProbeIn) -> dict[str, str]:
        return {"name": body.name}

    # POST routes: a later full match wins over the GET-only SPA catch-all.
    application.add_api_route("/api/probe/stub", stub, methods=["POST"])
    application.add_api_route("/api/probe/crash", crash, methods=["POST"])
    application.add_api_route("/api/probe/validate", validate, methods=["POST"])
    client = TestClient(application, raise_server_exceptions=raise_server_exceptions)
    client.headers.update(TEST_HEADERS)
    return client


def test_app_errors_render_code_fields_and_detail(config: Settings) -> None:
    with error_probe_app(config) as client:
        response = client.post("/api/probe/stub")
    assert response.status_code == 501
    assert response.json() == {
        "code": "not_implemented",
        "fields": {"name": "taken"},
        "detail": {"events": 2},
    }


def test_validation_errors_report_fields(config: Settings) -> None:
    with error_probe_app(config) as client:
        invalid = client.post("/api/probe/validate", json={"name": "long", "ids": [1, "x"]})
        missing = client.post("/api/probe/validate")
        valid = client.post("/api/probe/validate", json={"name": " ab ", "ids": [1]})
    assert invalid.status_code == 422
    assert invalid.json() == {
        "code": "invalid_request",
        "fields": {"name": "string_too_long", "ids": "int_parsing"},
    }
    assert missing.status_code == 422
    assert missing.json()["code"] == "invalid_request"
    assert valid.json() == {"name": "ab"}


def test_unexpected_errors_hide_details(
    config: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR, logger="timelife.app"):
        with error_probe_app(config) as client:
            response = client.post("/api/probe/crash")
    assert response.status_code == 500
    assert response.json() == {"code": "internal_error"}
    logged = [record.getMessage() for record in caplog.records if record.name == "timelife.app"]
    assert any("RuntimeError" in message for message in logged)
    assert not any("classified-payload" in message for message in logged)


def test_unexpected_errors_never_reach_the_server_log(
    config: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    # The server (uvicorn) logs any exception escaping the ASGI app with its message; the
    # TestClient re-raises such an exception, so a clean 500 proves nothing escapes.
    with caplog.at_level(logging.DEBUG):
        with error_probe_app(config, raise_server_exceptions=True) as client:
            response = client.post("/api/probe/crash")
    assert (response.status_code, response.json()) == (500, {"code": "internal_error"})
    assert response.headers["x-content-type-options"] == "nosniff"
    assert not any("classified-payload" in record.getMessage() for record in caplog.records)
    assert not any(
        record.exc_info and "classified-payload" in str(record.exc_info[1])
        for record in caplog.records
    )


def test_database_errors_hide_bound_parameters(config: Settings) -> None:
    engine = create_db_engine(config.database_url)
    try:
        assert engine.sync_engine.hide_parameters is True
    finally:
        asyncio.run(engine.dispose())


def spa_client(config: Settings, monkeypatch: pytest.MonkeyPatch, dist: Path) -> TestClient:
    monkeypatch.setattr(app_module, "FRONTEND_DIST", dist)
    return TestClient(create_app(config))


def test_spa_requires_a_built_frontend(
    config: Settings, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    with spa_client(config, monkeypatch, tmp_path / "missing") as client:
        for path in ("/", "/login", "/c/lucia", "/all", "/admin", "/admin/events"):
            response = client.get(path)
            assert response.status_code == 503, path
            assert response.json() == {"code": "frontend_not_built"}
        assert client.get("/unknown").json() == {"code": "not_found"}
        assert client.get("/assets/app.js").status_code == 404


def test_spa_serves_index_assets_and_root_files(
    config: Settings, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text('<div id="root"></div>', encoding="utf-8")
    (dist / "assets" / "index-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (dist / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    (dist / "theme-init.js").write_text("void 0", encoding="utf-8")
    (dist / "manifest.webmanifest").write_text("{}", encoding="utf-8")
    (dist / "apple-touch-icon.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    with spa_client(config, monkeypatch, dist) as client:
        paths = (
            "/",
            "/login",
            "/setup",
            "/reset-password",
            "/c/lucia",
            "/c/lucia/e/12",
            "/all",
            "/all/e/12",
            "/all/new",
            "/admin",
            "/admin/events/new",
        )
        for path in paths:
            response = client.get(path)
            assert response.status_code == 200, path
            assert response.text == '<div id="root"></div>'
            assert response.headers["content-type"].startswith("text/html")
            assert response.headers["cache-control"] == "no-cache"

        asset = client.get("/assets/index-abc123.js")
        assert asset.status_code == 200
        assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
        missing_asset = client.get("/assets/missing.js")
        assert missing_asset.status_code == 404
        assert missing_asset.json() == {"code": "not_found"}

        favicon = client.get("/favicon.svg")
        assert favicon.status_code == 200
        assert favicon.headers["content-type"].startswith("image/svg+xml")
        assert client.get("/theme-init.js").text == "void 0"

        # Home-screen install: Chrome fetches the manifest without cookies, so it must not need a
        # session (no root file does).
        manifest = client.get("/manifest.webmanifest")
        assert manifest.status_code == 200
        assert manifest.headers["content-type"].startswith("application/manifest+json")
        assert manifest.headers["cache-control"] == "no-cache"
        icon = client.get("/apple-touch-icon.png")
        assert icon.status_code == 200
        assert icon.headers["content-type"] == "image/png"

        for path in (
            "/unknown",
            "/api/unknown",
            "/logins",
            "/alls",
            "/setup/x",
            "/..%2Fpyproject.toml",
        ):
            response = client.get(path)
            assert response.status_code == 404, path
            assert response.json() == {"code": "not_found"}
