"""Outgoing e-mail through the SMTP server of the settings (``SMTP_*``) and the messages Timelife
sends: "forgot password" links (in Spanish, English or Portuguese) and a test message.

``app.state.mailer`` sends them (tests swap in a fake exposing ``async send(message)``). Check
the SMTP settings with ``python -m timelife.mail you@example.com``: it sends the test message
and reports the server's answer."""

import argparse
import logging
import smtplib
import ssl
import sys
from collections.abc import Sequence
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from typing import Protocol

from starlette.concurrency import run_in_threadpool

from .config import Settings, normalize_email
from .contracts import Locale
from .db import utcnow

log = logging.getLogger(__name__)

TIMEOUT_SECONDS = 20
RESET_MESSAGES: dict[str, tuple[str, str]] = {
    "es": (
        "Elige una contraseña nueva para Timelife",
        "Hola{name}:\n\n"
        "Alguien (seguramente tú) ha pedido una contraseña nueva para entrar en Timelife con"
        " {email}.\n\n"
        "Abre este enlace en la próxima hora para elegirla:\n\n"
        "{link}\n\n"
        "El enlace solo sirve una vez. Si no lo has pedido tú, ignora este correo: tu"
        " contraseña no cambiará.\n\n"
        "Timelife\n",
    ),
    "en": (
        "Choose a new Timelife password",
        "Hi{name},\n\n"
        "Someone (probably you) asked for a new password to sign in to Timelife as {email}.\n\n"
        "Open this link within the next hour to choose it:\n\n"
        "{link}\n\n"
        "The link works only once. If you did not ask for it, ignore this e-mail: your password"
        " will not change.\n\n"
        "Timelife\n",
    ),
    "pt": (
        "Escolhe uma nova palavra-passe para o Timelife",
        "Olá{name},\n\n"
        "Alguém (provavelmente tu) pediu uma nova palavra-passe para entrar no Timelife com"
        " {email}.\n\n"
        "Abre esta ligação na próxima hora para a escolheres:\n\n"
        "{link}\n\n"
        "A ligação só funciona uma vez. Se não foste tu a pedi-la, ignora este e-mail: a tua"
        " palavra-passe não vai mudar.\n\n"
        "Timelife\n",
    ),
}
CHECK_SUBJECT = "Timelife: correo de prueba / test e-mail / e-mail de teste"
CHECK_BODY = (
    "Timelife puede enviar correos con esta configuración SMTP.\n\n"
    "Timelife can send e-mails with these SMTP settings.\n\n"
    "O Timelife pode enviar e-mails com esta configuração SMTP.\n"
)


class Sender(Protocol):
    async def send(self, message: EmailMessage) -> None: ...


class Mailer:
    """Sends each message in a new SMTP connection, in a worker thread."""

    def __init__(self, config: Settings) -> None:
        self.config = config

    async def send(self, message: EmailMessage) -> None:
        await run_in_threadpool(self.send_now, message)

    def send_now(self, message: EmailMessage) -> None:
        config = self.config
        context = ssl.create_default_context()
        host, port = config.smtp_host, config.smtp_server_port
        client: smtplib.SMTP
        if config.smtp_security == "ssl":
            client = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT_SECONDS, context=context)
        else:
            client = smtplib.SMTP(host, port, timeout=TIMEOUT_SECONDS)
        with client:
            if config.smtp_security == "starttls":
                client.starttls(context=context)
            if config.smtp_username:
                client.login(config.smtp_username, config.smtp_password.get_secret_value())
            client.send_message(message)


def new_message(config: Settings, to: str, subject: str, body: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = config.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message["Date"] = format_datetime(utcnow())
    message["Message-ID"] = make_msgid(domain=config.smtp_from_address.rpartition("@")[2])
    message["Auto-Submitted"] = "auto-generated"
    message.set_content(body)
    return message


def password_reset_message(
    config: Settings, email: str, name: str | None, link: str, locale: Locale
) -> EmailMessage:
    subject, body = RESET_MESSAGES[locale]
    greeting = f" {name}" if name else ""
    return new_message(
        config, email, subject, body.format(name=greeting, email=email, link=link)
    )


def check_message(config: Settings, to: str) -> EmailMessage:
    return new_message(config, to, CHECK_SUBJECT, CHECK_BODY)


async def deliver(mailer: Sender, message: EmailMessage, purpose: str) -> None:
    """Send ``message``; failures are only logged (their type, never the address)."""
    try:
        await mailer.send(message)
    except Exception as error:
        log.warning("E-mail not sent (%s: %s)", purpose, type(error).__name__)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m timelife.mail",
        description="Send a test e-mail with the SMTP settings (SMTP_*).",
    )
    parser.add_argument("to", help="address to send the test e-mail to")
    args = parser.parse_args(argv)
    config = Settings()
    if not config.smtp_enabled:
        print("SMTP is not configured: set SMTP_HOST and SMTP_FROM.", file=sys.stderr)
        return 1
    try:
        to = normalize_email(args.to)
    except ValueError:
        print(f"Not a valid e-mail address: {args.to}", file=sys.stderr)
        return 2
    server = f"{config.smtp_host}:{config.smtp_server_port} ({config.smtp_security})"
    try:
        Mailer(config).send_now(check_message(config, to))
    except (smtplib.SMTPException, OSError) as error:
        print(f"Not sent through {server}: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    print(f"Test e-mail sent to {to} through {server}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
