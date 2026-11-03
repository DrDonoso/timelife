import re
from email.headerregistry import Address
from email.utils import parseaddr
from ipaddress import IPv4Address, IPv6Address
from pathlib import Path
from typing import Any, Literal, Self
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    EmailStr,
    Field,
    SecretStr,
    TypeAdapter,
    ValidationInfo,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict

LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
GOOGLE_CLIENT_ID = re.compile(r"[a-zA-Z0-9-]+\.apps\.googleusercontent\.com")
_EMAIL = TypeAdapter(EmailStr)
SmtpSecurity = Literal["starttls", "ssl", "none"]
SMTP_DEFAULT_PORTS: dict[str, int] = {"starttls": 587, "ssl": 465, "none": 25}


def normalize_origin(value: str) -> str:
    """Canonical ``scheme://host[:port]`` form of an HTTP(S) origin; ValueError if invalid."""
    try:
        if any(
            character.isspace() or ord(character) < 32 or ord(character) == 127
            for character in value
        ) or any(character in value for character in "\\?#"):
            raise ValueError
        origin = urlsplit(value)
        hostname = origin.hostname
        port = origin.port
        if (
            origin.scheme not in {"http", "https"}
            or not hostname
            or origin.username is not None
            or origin.password is not None
            or origin.path not in {"", "/"}
            or not re.fullmatch(r"(?:\[[0-9a-fA-F:.]+\]|[^:@\[\]]+)(?::[0-9]+)?", origin.netloc)
        ):
            raise ValueError
        if ":" in hostname:
            hostname = f"[{IPv6Address(hostname).compressed}]"
        else:
            hostname = hostname.encode("idna").decode("ascii").lower()
            if re.fullmatch(r"[0-9.]+", hostname):
                IPv4Address(hostname)
            if len(hostname.removesuffix(".")) > 253 or any(
                not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                for label in hostname.removesuffix(".").split(".")
            ):
                raise ValueError
        default_port = 443 if origin.scheme == "https" else 80
        authority = hostname if port in {None, default_port} else f"{hostname}:{port}"
        return f"{origin.scheme}://{authority}"
    except ValueError:
        raise ValueError("Expected a valid HTTP(S) origin without credentials or a path") from None


def normalize_email(value: str) -> str:
    """Validate an e-mail address and return its canonical lower-case form."""
    return _EMAIL.validate_python(value.strip()).lower()


def is_loopback(origin: str) -> bool:
    return urlsplit(origin).hostname in LOOPBACK_HOSTS


def normalize_smtp_host(value: str) -> str:
    """Host name (IDNA, lower case) or IP address of an SMTP server, without scheme, port or
    brackets; ValueError if invalid."""
    host = value.strip()
    if ":" in host:
        return IPv6Address(host.removeprefix("[").removesuffix("]")).compressed
    hostname = urlsplit(normalize_origin("http://" + host)).hostname
    if not hostname:
        raise ValueError("Expected a host name or IP address")
    return hostname


def normalize_sender(value: str) -> str:
    """``address`` or ``Name <address>`` of the e-mails' sender; ValueError if invalid."""
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("Control characters are not allowed")
    name, address = parseaddr(value.strip())
    if not address:
        raise ValueError("Expected an e-mail address")
    return str(Address(display_name=name, addr_spec=_EMAIL.validate_python(address)))


class Settings(BaseSettings):
    """Runtime configuration; every field is read from the upper-case environment variable."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", hide_input_in_errors=True,
    )

    database_url: str
    auth_secret: SecretStr
    public_origin: str = "http://localhost:7779"
    auth_cookie_secure: bool = True
    session_days: int = Field(default=30, ge=1, le=365)
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    # Outgoing e-mail ("forgot password" links); off while SMTP_HOST is empty.
    smtp_host: str = ""
    # Default: 587 with STARTTLS, 465 with SSL, 25 without encryption.
    smtp_port: int | None = Field(default=None, ge=1, le=65535)
    smtp_security: SmtpSecurity = "starttls"
    smtp_username: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from: str = ""
    allow_insecure_local_login: bool = False
    local_login_password: SecretStr = SecretStr("admin")
    media_dir: Path = Path("data/media")
    max_upload_mb: int = Field(default=30, ge=1, le=200)
    max_video_upload_mb: int = Field(default=500, ge=1, le=4096)
    max_video_minutes: int = Field(default=10, ge=1, le=240)
    image_tag: str = "development"
    build_date: str = ""
    tz: str = "Europe/Madrid"

    @field_validator("database_url")
    @classmethod
    def valid_database_url(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith(("postgresql+asyncpg://", "sqlite+aiosqlite://")):
            raise ValueError(
                "DATABASE_URL must start with postgresql+asyncpg:// or sqlite+aiosqlite://"
            )
        return value

    @field_validator("auth_secret")
    @classmethod
    def valid_secret(cls, value: SecretStr) -> SecretStr:
        secret = value.get_secret_value()
        if len(secret) < 32 or not secret.strip():
            raise ValueError("AUTH_SECRET must contain at least 32 characters")
        return value

    @field_validator("tz")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError, OSError):
            raise ValueError("TZ must be an available IANA time zone") from None
        return value

    @field_validator("smtp_port", "smtp_security", mode="before")
    @classmethod
    def blank_is_default(cls, value: Any, info: ValidationInfo) -> Any:
        # Compose passes unset variables as empty strings.
        if isinstance(value, str):
            value = value.strip().lower()
            if not value:
                return None if info.field_name == "smtp_port" else "starttls"
        return value

    @model_validator(mode="after")
    def validate_origins(self) -> Self:
        origins = self.public_origins
        self.public_origin = ",".join(origins)
        for origin in origins:
            secure_context = origin.startswith("https://") or is_loopback(origin)
            if self.auth_cookie_secure and not secure_context:
                raise ValueError(
                    "AUTH_COOKIE_SECURE=true requires HTTPS for every non-loopback PUBLIC_ORIGIN"
                )
            if self.allow_insecure_local_login and not is_loopback(origin):
                raise ValueError(
                    "ALLOW_INSECURE_LOCAL_LOGIN requires every PUBLIC_ORIGIN host to be "
                    "localhost, 127.0.0.1 or [::1]"
                )
        if self.allow_insecure_local_login:
            password = self.local_login_password.get_secret_value()
            if not password.strip() or len(password) > 200:
                raise ValueError("LOCAL_LOGIN_PASSWORD must contain 1-200 characters")
        return self

    @model_validator(mode="after")
    def validate_google(self) -> Self:
        self.google_client_id = self.google_client_id.strip()
        secret = self.google_client_secret.get_secret_value()
        if bool(self.google_client_id) != bool(secret.strip()):
            raise ValueError("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required together")
        if self.google_client_id:
            if not GOOGLE_CLIENT_ID.fullmatch(self.google_client_id):
                raise ValueError("GOOGLE_CLIENT_ID must be a Google web application client ID")
            if any(character.isspace() for character in secret):
                raise ValueError("GOOGLE_CLIENT_SECRET must not contain whitespace")
            for origin in self.public_origins:
                if not origin.startswith("https://") and not is_loopback(origin):
                    raise ValueError("Google sign-in requires HTTPS except on loopback origins")
        return self

    @model_validator(mode="after")
    def validate_smtp(self) -> Self:
        host = self.smtp_host.strip()
        sender = self.smtp_from.strip()
        self.smtp_username = self.smtp_username.strip()
        password = self.smtp_password.get_secret_value()
        if not host:
            if sender or self.smtp_username or password:
                raise ValueError(
                    "SMTP_HOST is required when SMTP_FROM, SMTP_USERNAME or SMTP_PASSWORD is set"
                )
            self.smtp_host = ""
            return self
        try:
            self.smtp_host = normalize_smtp_host(host)
        except ValueError:
            raise ValueError(
                "SMTP_HOST must be a host name or IP address, without scheme or port"
            ) from None
        if not sender:
            raise ValueError("SMTP_FROM is required when SMTP_HOST is set")
        try:
            self.smtp_from = normalize_sender(sender)
        except ValueError:
            raise ValueError(
                "SMTP_FROM must be an e-mail address, optionally as 'Name <address>'"
            ) from None
        if bool(self.smtp_username) != bool(password):
            raise ValueError("SMTP_USERNAME and SMTP_PASSWORD are required together")
        if self.smtp_username and self.smtp_security == "none":
            raise ValueError("SMTP_USERNAME/SMTP_PASSWORD require SMTP_SECURITY=starttls or ssl")
        return self

    @property
    def public_origins(self) -> tuple[str, ...]:
        try:
            return tuple(
                dict.fromkeys(
                    normalize_origin(value.strip()) for value in self.public_origin.split(",")
                )
            )
        except ValueError:
            raise ValueError(
                "PUBLIC_ORIGIN must be a comma-separated list of valid HTTP(S) origins "
                "without credentials, paths, queries, fragments, wildcards or empty entries"
            ) from None

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret.get_secret_value())

    @property
    def smtp_enabled(self) -> bool:
        return bool(self.smtp_host)

    @property
    def smtp_server_port(self) -> int:
        return self.smtp_port or SMTP_DEFAULT_PORTS[self.smtp_security]

    @property
    def smtp_from_address(self) -> str:
        """The bare e-mail address of ``SMTP_FROM`` (empty without SMTP)."""
        return parseaddr(self.smtp_from)[1]

    @property
    def dev_login_enabled(self) -> bool:
        return self.allow_insecure_local_login

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def max_video_upload_bytes(self) -> int:
        return self.max_video_upload_mb * 1024 * 1024

    @property
    def max_video_seconds(self) -> int:
        return self.max_video_minutes * 60
