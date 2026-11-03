"""Outgoing e-mail: the messages, the SMTP conversation and ``python -m timelife.mail``."""

import logging
import smtplib
from email.message import EmailMessage
from pathlib import Path
from typing import Any, get_args

import pytest

from timelife import mail
from timelife.config import Settings
from timelife.contracts import Locale

from .conftest import make_settings

LINK = "https://timelife.example.com/reset-password#" + "ab" * 32


class FakeSMTP:
    """Stands in for ``smtplib.SMTP`` / ``SMTP_SSL``: records the conversation."""

    sessions: list["FakeSMTP"] = []
    fail: Exception | None = None

    def __init__(self, host: str, port: int, **options: Any) -> None:
        if FakeSMTP.fail is not None:
            raise FakeSMTP.fail
        self.calls: list[tuple[Any, ...]] = [("connect", host, port, "context" in options)]
        self.timeout = options.get("timeout")
        FakeSMTP.sessions.append(self)

    def __enter__(self) -> "FakeSMTP":
        return self

    def __exit__(self, *exc: object) -> None:
        self.calls.append(("quit",))

    def starttls(self, **options: Any) -> None:
        self.calls.append(("starttls",))

    def login(self, user: str, password: str) -> None:
        self.calls.append(("login", user, password))

    def send_message(self, message: EmailMessage) -> None:
        self.calls.append(("send", message["To"], message["Subject"]))


class FakeSMTPSSL(FakeSMTP):
    pass


@pytest.fixture(autouse=True)
def fake_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeSMTP.sessions = []
    FakeSMTP.fail = None
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTPSSL)


def smtp_settings(tmp_path: Path, **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "smtp_host": "smtp.example.com",
        "smtp_from": "Timelife <timelife@example.com>",
    }
    values.update(overrides)
    return make_settings("sqlite+aiosqlite://", tmp_path / "media", **values)


def test_the_reset_message_in_spanish(tmp_path: Path) -> None:
    config = smtp_settings(tmp_path)
    message = mail.password_reset_message(config, "ana@example.com", "Ana", LINK, "es")
    assert message["From"] == "Timelife <timelife@example.com>"
    assert message["To"] == "ana@example.com"
    assert message["Subject"] == "Elige una contraseña nueva para Timelife"
    assert message["Auto-Submitted"] == "auto-generated"
    assert message["Message-ID"].endswith("@example.com>")
    assert message["Date"]
    body = message.get_content()
    assert body.startswith("Hola Ana:\n")
    assert "ana@example.com" in body and f"\n\n{LINK}\n\n" in body
    assert "en la próxima hora" in body
    assert message.get_content_type() == "text/plain"


def test_the_reset_message_in_english_without_a_name(tmp_path: Path) -> None:
    config = smtp_settings(tmp_path)
    message = mail.password_reset_message(config, "ana@example.com", None, LINK, "en")
    assert message["Subject"] == "Choose a new Timelife password"
    body = message.get_content()
    assert body.startswith("Hi,\n")
    assert LINK in body and "within the next hour" in body


def test_the_reset_message_in_portuguese(tmp_path: Path) -> None:
    config = smtp_settings(tmp_path)
    message = mail.password_reset_message(config, "ana@example.com", "Ana", LINK, "pt")
    assert message["Subject"] == "Escolhe uma nova palavra-passe para o Timelife"
    body = message.get_content()
    assert body.startswith("Olá Ana,\n")
    assert "ana@example.com" in body and f"\n\n{LINK}\n\n" in body
    assert "na próxima hora" in body
    without_name = mail.password_reset_message(config, "ana@example.com", None, LINK, "pt")
    assert without_name.get_content().startswith("Olá,\n")


def test_every_language_has_its_reset_message() -> None:
    assert set(mail.RESET_MESSAGES) == set(get_args(Locale)) == {"es", "en", "pt"}
    for subject, body in mail.RESET_MESSAGES.values():
        assert "\n" not in subject
        for field in ("{name}", "{email}", "{link}"):
            assert body.count(field) == 1, field


def test_the_test_message_is_in_three_languages(tmp_path: Path) -> None:
    config = smtp_settings(tmp_path)
    message = mail.check_message(config, "ana@example.com")
    assert message["Subject"] == "Timelife: correo de prueba / test e-mail / e-mail de teste"
    body = message.get_content()
    assert "Timelife puede enviar correos con esta configuración SMTP." in body
    assert "Timelife can send e-mails with these SMTP settings." in body
    assert "O Timelife pode enviar e-mails com esta configuração SMTP." in body


async def test_starttls_with_login(tmp_path: Path) -> None:
    config = smtp_settings(tmp_path, smtp_username="user", smtp_password="app password")
    await mail.Mailer(config).send(mail.check_message(config, "ana@example.com"))
    [session] = FakeSMTP.sessions
    assert type(session) is FakeSMTP and session.timeout == mail.TIMEOUT_SECONDS
    assert session.calls == [
        ("connect", "smtp.example.com", 587, False),
        ("starttls",),
        ("login", "user", "app password"),
        ("send", "ana@example.com", mail.CHECK_SUBJECT),
        ("quit",),
    ]


async def test_ssl_and_unencrypted_relays(tmp_path: Path) -> None:
    secure = smtp_settings(tmp_path, smtp_security="ssl")
    await mail.Mailer(secure).send(mail.check_message(secure, "ana@example.com"))
    relay = smtp_settings(tmp_path, smtp_security="none", smtp_port=2525, smtp_host="mailer")
    await mail.Mailer(relay).send(mail.check_message(relay, "ana@example.com"))
    ssl_session, relay_session = FakeSMTP.sessions
    assert type(ssl_session) is FakeSMTPSSL
    assert ssl_session.calls == [
        ("connect", "smtp.example.com", 465, True),
        ("send", "ana@example.com", mail.CHECK_SUBJECT),
        ("quit",),
    ]
    assert relay_session.calls == [
        ("connect", "mailer", 2525, False),
        ("send", "ana@example.com", mail.CHECK_SUBJECT),
        ("quit",),
    ]


async def test_failures_are_logged_without_the_address(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    config = smtp_settings(tmp_path)
    FakeSMTP.fail = smtplib.SMTPAuthenticationError(535, b"Bad credentials ana@example.com")
    message = mail.password_reset_message(config, "ana@example.com", "Ana", LINK, "es")
    with caplog.at_level(logging.WARNING, logger="timelife.mail"):
        await mail.deliver(mail.Mailer(config), message, "password reset")
    assert caplog.messages == ["E-mail not sent (password reset: SMTPAuthenticationError)"]
    assert "ana@example.com" not in caplog.text


@pytest.fixture
def environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    monkeypatch.chdir(tmp_path)  # no .env file
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite://")
    monkeypatch.setenv("AUTH_SECRET", "s" * 32)
    monkeypatch.setenv("PUBLIC_ORIGIN", "http://localhost:7779")


@pytest.mark.usefixtures("environment")
def test_the_check_command_sends_a_test_message(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_FROM", "timelife@example.com")
    assert mail.main(["Ana@Example.com"]) == 0
    out = capsys.readouterr().out
    assert out == "Test e-mail sent to ana@example.com through smtp.example.com:587 (starttls).\n"
    [session] = FakeSMTP.sessions
    assert ("send", "ana@example.com", mail.CHECK_SUBJECT) in session.calls

    FakeSMTP.fail = ConnectionRefusedError(111, "Connection refused")
    assert mail.main(["ana@example.com"]) == 1
    error = capsys.readouterr().err
    assert error.startswith("Not sent through smtp.example.com:587 (starttls): ConnectionRefused")

    assert mail.main(["not-an-address"]) == 2


@pytest.mark.usefixtures("environment")
def test_the_check_command_needs_smtp(capsys: pytest.CaptureFixture[str]) -> None:
    assert mail.main(["ana@example.com"]) == 1
    assert "SMTP is not configured" in capsys.readouterr().err
    assert FakeSMTP.sessions == []
