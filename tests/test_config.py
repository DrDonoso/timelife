from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from timelife.config import Settings, normalize_origin

SECRET = "s" * 32


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)


def settings(**values: Any) -> Settings:
    base: dict[str, Any] = {
        "database_url": "sqlite+aiosqlite:///./data/test.db",
        "auth_secret": SECRET,
        "public_origin": "http://testserver",
        "auth_cookie_secure": False,
    }
    base.update(values)
    return Settings(_env_file=None, **base)


def test_test_configuration_is_valid() -> None:
    config = settings()
    assert config.public_origins == ("http://testserver",)
    assert config.google_enabled is False
    assert config.dev_login_enabled is False
    assert config.smtp_enabled is False
    assert config.media_dir == Path("data/media")
    assert config.max_upload_bytes == 30 * 1024 * 1024
    assert config.max_video_upload_bytes == 500 * 1024 * 1024
    assert config.max_video_seconds == 10 * 60
    assert config.session_days == 30


def test_defaults_are_a_valid_loopback_configuration() -> None:
    config = Settings(_env_file=None, database_url="sqlite+aiosqlite://", auth_secret=SECRET)
    assert config.public_origins == ("http://localhost:7779",)
    assert config.auth_cookie_secure is True


def test_reads_environment_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://timelife:pw@db:5432/timelife")
    monkeypatch.setenv("AUTH_SECRET", SECRET)
    monkeypatch.setenv("PUBLIC_ORIGIN", "https://timelife.example.com")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_PORT", "")
    monkeypatch.setenv("SMTP_SECURITY", "SSL")
    monkeypatch.setenv("SMTP_USERNAME", "timelife@example.com")
    monkeypatch.setenv("SMTP_PASSWORD", "app password")
    monkeypatch.setenv("SMTP_FROM", "Timelife <timelife@example.com>")
    monkeypatch.setenv("SESSION_DAYS", "7")
    monkeypatch.setenv("MAX_UPLOAD_MB", "50")
    monkeypatch.setenv("MAX_VIDEO_UPLOAD_MB", "1024")
    monkeypatch.setenv("MAX_VIDEO_MINUTES", "30")
    monkeypatch.setenv("MEDIA_DIR", "/app/data/media")
    monkeypatch.setenv("IMAGE_TAG", "20261020")
    monkeypatch.setenv("TZ", "UTC")
    config = Settings(_env_file=None)
    assert config.database_url.startswith("postgresql+asyncpg://")
    assert config.public_origins == ("https://timelife.example.com",)
    assert config.smtp_enabled is True
    assert (config.smtp_host, config.smtp_server_port, config.smtp_security) == (
        "smtp.example.com",
        465,
        "ssl",
    )
    assert config.smtp_username == "timelife@example.com"
    assert config.smtp_password.get_secret_value() == "app password"
    assert config.smtp_from == "Timelife <timelife@example.com>"
    assert (config.session_days, config.max_upload_mb) == (7, 50)
    assert (config.max_video_upload_mb, config.max_video_minutes) == (1024, 30)
    assert config.media_dir == Path("/app/data/media")
    assert config.image_tag == "20261020"
    assert config.tz == "UTC"


def test_origins_are_normalised_and_deduplicated() -> None:
    config = settings(
        public_origin=(
            "HTTP://LocalHost:80/, http://127.0.0.1:5173,http://localhost,http://[::1]:7779"
        )
    )
    assert config.public_origins == (
        "http://localhost",
        "http://127.0.0.1:5173",
        "http://[::1]:7779",
    )
    assert config.public_origin == "http://localhost,http://127.0.0.1:5173,http://[::1]:7779"
    assert normalize_origin("https://Timelife.Example.com:443") == "https://timelife.example.com"


@pytest.mark.parametrize(
    "origin",
    [
        "",
        "timelife.example.com",
        "ftp://timelife.example.com",
        "https://timelife.example.com/app",
        "https://user:pw@timelife.example.com",
        "https://timelife.example.com?x=1",
        "https://*.example.com",
        "https://a.example.com,,https://b.example.com",
        "https://exa mple.com",
    ],
)
def test_invalid_origins_are_rejected(origin: str) -> None:
    with pytest.raises(ValidationError):
        settings(public_origin=origin)


def test_secure_cookies_require_https_except_on_loopback() -> None:
    with pytest.raises(ValidationError):
        settings(public_origin="http://timelife.example.com", auth_cookie_secure=True)
    settings(public_origin="https://timelife.example.com", auth_cookie_secure=True)
    settings(public_origin="http://localhost:7779,http://[::1]:7779", auth_cookie_secure=True)
    settings(public_origin="http://timelife.lan", auth_cookie_secure=False)


def test_google_credentials_go_together() -> None:
    client_id = "1234-abc.apps.googleusercontent.com"
    with pytest.raises(ValidationError):
        settings(google_client_id=client_id)
    with pytest.raises(ValidationError):
        settings(google_client_secret="secret")
    with pytest.raises(ValidationError):
        settings(google_client_id="not-a-client-id", google_client_secret="secret")
    with pytest.raises(ValidationError):
        settings(google_client_id=client_id, google_client_secret="has space")
    with pytest.raises(ValidationError):
        settings(google_client_id=client_id, google_client_secret="secret")  # http non-loopback
    config = settings(
        public_origin="https://timelife.example.com",
        google_client_id=f" {client_id} ",
        google_client_secret="secret",
    )
    assert config.google_enabled is True
    assert config.google_client_id == client_id
    assert settings(
        public_origin="http://localhost:7779", google_client_id=client_id, google_client_secret="x"
    ).google_enabled


def test_dev_login_requires_loopback_origins() -> None:
    with pytest.raises(ValidationError):
        settings(allow_insecure_local_login=True)  # http://testserver is not loopback
    with pytest.raises(ValidationError):
        settings(
            public_origin="http://localhost:5173,https://timelife.example.com",
            allow_insecure_local_login=True,
        )
    with pytest.raises(ValidationError):
        settings(
            public_origin="http://localhost",
            allow_insecure_local_login=True,
            local_login_password=" ",
        )
    config = settings(
        public_origin="http://localhost:5173,http://127.0.0.1:5173,http://[::1]:5173",
        allow_insecure_local_login=True,
    )
    assert config.dev_login_enabled is True
    assert config.local_login_password.get_secret_value() == "admin"


def test_smtp_settings_are_normalised() -> None:
    config = settings(
        smtp_host=" SMTP.Example.COM ",
        smtp_from=' "Família Pérez" <Hola@Example.com> ',
        smtp_username=" user ",
        smtp_password="secret",
    )
    assert config.smtp_enabled is True
    assert (config.smtp_host, config.smtp_security, config.smtp_server_port) == (
        "smtp.example.com",
        "starttls",
        587,
    )
    assert config.smtp_from == "Família Pérez <Hola@example.com>"
    assert config.smtp_from_address == "Hola@example.com"
    assert config.smtp_username == "user"
    relay = settings(smtp_host="[::1]", smtp_from="timelife@example.com", smtp_security="none")
    assert (relay.smtp_host, relay.smtp_server_port, relay.smtp_from) == (
        "::1",
        25,
        "timelife@example.com",
    )
    custom = settings(smtp_host="mail", smtp_from="a@example.com", smtp_port=2525)
    assert custom.smtp_server_port == 2525
    # Unset values, as Compose passes them.
    assert settings(smtp_port="", smtp_security="").smtp_enabled is False


@pytest.mark.parametrize(
    "values",
    [
        {"smtp_from": "timelife@example.com"},
        {"smtp_username": "user", "smtp_password": "secret"},
        {"smtp_host": "smtp.example.com"},
        {"smtp_host": "smtp.example.com:587", "smtp_from": "a@example.com"},
        {"smtp_host": "smtp://smtp.example.com", "smtp_from": "a@example.com"},
        {"smtp_host": "smtp example.com", "smtp_from": "a@example.com"},
        {"smtp_host": "smtp.example.com", "smtp_from": "not an address"},
        {"smtp_host": "smtp.example.com", "smtp_from": "a@example.com\r\nBcc: b@example.com"},
        {"smtp_host": "smtp.example.com", "smtp_from": "a@example.com", "smtp_username": "u"},
        {"smtp_host": "smtp.example.com", "smtp_from": "a@example.com", "smtp_password": "p"},
        {
            "smtp_host": "smtp.example.com",
            "smtp_from": "a@example.com",
            "smtp_username": "user",
            "smtp_password": "secret",
            "smtp_security": "none",
        },
        {"smtp_host": "smtp.example.com", "smtp_from": "a@example.com", "smtp_security": "tls"},
        {"smtp_host": "smtp.example.com", "smtp_from": "a@example.com", "smtp_port": 0},
        {"smtp_host": "smtp.example.com", "smtp_from": "a@example.com", "smtp_port": 65536},
    ],
)
def test_invalid_smtp_settings_are_rejected(values: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        settings(**values)


def test_smtp_password_is_not_echoed_in_errors() -> None:
    with pytest.raises(ValidationError) as error:
        settings(smtp_host="smtp.example.com", smtp_password="very-secret-value")
    assert "very-secret-value" not in str(error.value)


@pytest.mark.parametrize(
    "values",
    [
        {"auth_secret": "too-short"},
        {"auth_secret": " " * 40},
        {"database_url": "postgresql://timelife@db/timelife"},
        {"tz": "Mars/Olympus"},
        {"session_days": 0},
        {"session_days": 366},
        {"max_upload_mb": 0},
        {"max_upload_mb": 201},
        {"max_video_upload_mb": 0},
        {"max_video_upload_mb": 4097},
        {"max_video_minutes": 0},
        {"max_video_minutes": 241},
    ],
)
def test_invalid_values_are_rejected(values: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        settings(**values)


def test_secrets_are_not_echoed_in_errors() -> None:
    with pytest.raises(ValidationError) as error:
        settings(auth_secret="short-secret-value")
    assert "short-secret-value" not in str(error.value)
