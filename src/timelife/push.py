"""Push notifications: the devices that turned them on, and what they are told (for now, each
day's memories).

A browser, or the app installed on a phone's Home Screen, registers from the account panel
(``PUT /api/push/subscription``) with its push address and keys (``webpush``), the language of
the interface and its time zone; the interface registers it again each time it opens, so the
address, the language and the time zone stay current. The registration belongs to the session of
the device: signing out there stops the notifications, and a new password, a new role or a
disabled account stops them until the device signs in again.

``Notifier`` checks every minute which devices have reached 9:00 of their own day (until 21:00,
never at night: a server that was down at nine sends them when it is back) and, when that day has
memories their person has neither looked at nor been told about, sends each of them one
notification, as the notice of the interface: the first memory, and how many more. It counts as
telling them (``users.memories_announced_on``), so the interface does not tell them again. Tapping
it opens that milestone, or today's memories when there are several. The messages use the
declarative format (``"web_push": 8030``) that Safari shows by itself since iOS 18.4; the
service worker of the interface (``frontend/public/sw.js``) shows them everywhere else."""

import asyncio
import datetime as dt
import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Request
from sqlalchemy import case, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from . import webpush
from .appearance import dialect_insert
from .auth import (
    DB,
    SESSION_COOKIE,
    UNSYNCHRONIZED,
    CurrentUser,
    access_hash,
    request_origin,
    settings,
    throttle,
)
from .config import Settings
from .contracts import PushConfigOut, PushEndpointIn, PushSubscriptionIn
from .db import Locale, PushSubscription, User, utcnow
from .errors import AppError
from .memories import Memory, memories_on

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/push", tags=["Notifications"])

# The memories are told between these hours of the device's own day.
NOTIFY_FROM = dt.time(9, 0)
NOTIFY_UNTIL = dt.time(21, 0)
TICK_SECONDS = 60
# Minutes to wait before trying again after a push service or the network failed (the last one
# repeats until the end of the window).
RETRY_MINUTES = (2, 5, 15, 30, 60)
# Days in a row a push service may refuse a device's notifications before it is forgotten (the
# device registers again the next time the app opens there).
MAX_FAILURES = 3
# Devices kept per person: registering one more forgets the one unused for longest.
MAX_DEVICES = 20
TEST_TTL_SECONDS = 300
LANGUAGE_TAGS: dict[Locale, str] = {"es": "es-ES", "en": "en-GB", "pt": "pt-PT"}


@dataclass(frozen=True)
class Texts:
    """The texts of the notifications in one language (the memories' ones as the notice of the
    interface: ``frontend/src/i18n/locales/*/memories.ts``). Plurals: (one, other)."""

    title: str
    single: str
    several: tuple[str, str]
    months: tuple[str, str]
    years: tuple[str, str]
    test_title: str
    test_body: str


TEXTS: dict[Locale, Texts] = {
    "es": Texts(
        title="Recuerdos de hoy",
        single="Tal día como hoy, {ago}: «{title}».",
        several=(
            "Tal día como hoy, {ago}: «{title}» y {count} recuerdo más.",
            "Tal día como hoy, {ago}: «{title}» y {count} recuerdos más.",
        ),
        months=("hace {count} mes", "hace {count} meses"),
        years=("hace {count} año", "hace {count} años"),
        test_title="Notificación de prueba",
        test_body="¡Funciona! Así te llegarán las notificaciones en este dispositivo.",
    ),
    "en": Texts(
        title="Today’s memories",
        single="On this day, {ago}: “{title}”.",
        several=(
            "On this day, {ago}: “{title}” and {count} more memory.",
            "On this day, {ago}: “{title}” and {count} more memories.",
        ),
        months=("{count} month ago", "{count} months ago"),
        years=("{count} year ago", "{count} years ago"),
        test_title="Test notification",
        test_body="It works! This is how notifications will reach you on this device.",
    ),
    "pt": Texts(
        title="Memórias de hoje",
        single="Neste dia, {ago}: «{title}».",
        several=(
            "Neste dia, {ago}: «{title}» e mais {count} memória.",
            "Neste dia, {ago}: «{title}» e mais {count} memórias.",
        ),
        months=("há {count} mês", "há {count} meses"),
        years=("há {count} ano", "há {count} anos"),
        test_title="Notificação de teste",
        test_body="Funciona! É assim que vais receber as notificações neste dispositivo.",
    ),
}


def plural(forms: tuple[str, str], count: int) -> str:
    return forms[0] if count == 1 else forms[1]


def notification(
    origin: str, locale: Locale, *, title: str, body: str, path: str, tag: str
) -> dict[str, Any]:
    """A declarative push message: the notification, and the page of ``origin`` it opens."""
    return {
        "web_push": 8030,
        "notification": {
            "title": title,
            "body": body,
            "lang": LANGUAGE_TAGS[locale],
            "dir": "ltr",
            "navigate": origin + path,
            "tag": tag,
            "silent": False,
            "icon": f"{origin}/icon-192.png",
            # Android's status bar (a white silhouette); Safari ignores it.
            "badge": f"{origin}/badge-96.png",
        },
    }


def memories_message(memories: Sequence[Memory], origin: str, locale: Locale) -> dict[str, Any]:
    """The notification of a day's memories: the first one (the most recent) and how many more;
    it opens that milestone (counting the day's memories as seen), or the list of them. The app's
    icon shows how many there are."""
    texts = TEXTS[locale]
    first, others = memories[0], len(memories) - 1
    ago = plural(texts.years if first.unit == "years" else texts.months, first.count)
    template = texts.single if others == 0 else plural(texts.several, others)
    body = template.format(ago=ago.format(count=first.count), title=first.title, count=others)
    path = f"{first.path}&memories=seen" if others == 0 else "/?memories=open"
    message = notification(
        origin, locale, title=texts.title, body=body, path=path, tag="memories"
    )
    message["app_badge"] = len(memories)
    return message


def test_message(origin: str, locale: Locale) -> dict[str, Any]:
    """The notification of the account panel's test. Like every notification, its title says what
    it is about, not the app's name: iOS adds "from <the app's name>" under every title."""
    texts = TEXTS[locale]
    return notification(
        origin, locale, title=texts.test_title, body=texts.test_body, path="/", tag="test"
    )


def subscription_of(row: PushSubscription) -> webpush.Subscription:
    return webpush.Subscription(endpoint=row.endpoint, p256dh=row.p256dh, auth=row.auth)


def notifier(request: Request) -> "Notifier":
    return request.app.state.notifier


@router.get("", response_model=PushConfigOut)
async def push_config(request: Request, user: CurrentUser) -> PushConfigOut:
    return PushConfigOut(public_key=notifier(request).sender.public_key)


@router.put("/subscription", status_code=204)
async def subscribe(body: PushSubscriptionIn, request: Request, user: CurrentUser, db: DB) -> None:
    """Register this device for notifications, or refresh its registration. An address another
    account registered becomes this one's (someone else signed in there). 422
    ``push_service_unsupported``: the browser uses a push service Timelife does not send to."""
    config = settings(request)
    if webpush.push_service(body.endpoint) is None:
        raise AppError("push_service_unsupported", 422)
    origin = request_origin(request, config)
    auth_version = await db.scalar(select(User.auth_version).where(User.id == user.id))
    if auth_version is None:
        raise AppError("authentication_required", 401)
    now = utcnow()
    statement = dialect_insert(db, PushSubscription).values(
        user_id=user.id,
        auth_version=auth_version,
        session_hash=access_hash(config, "session", request.cookies.get(SESSION_COOKIE, "")),
        endpoint=body.endpoint,
        p256dh=body.keys.p256dh,
        auth=body.keys.auth,
        origin=origin,
        locale=body.locale,
        time_zone=body.time_zone or config.tz,
        memories_notified_on=None,
        failures=0,
        created_at=now,
        updated_at=now,
    )
    new = statement.excluded
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[PushSubscription.endpoint],
            set_={
                # Another person's device until now: today's memories are still to be told.
                "memories_notified_on": case(
                    (
                        PushSubscription.user_id == new.user_id,
                        PushSubscription.memories_notified_on,
                    ),
                    else_=None,
                ),
                **{
                    name: getattr(new, name)
                    for name in (
                        "user_id",
                        "auth_version",
                        "session_hash",
                        "p256dh",
                        "auth",
                        "origin",
                        "locale",
                        "time_zone",
                        "failures",
                        "updated_at",
                    )
                },
            },
        )
    )
    unused = (
        select(PushSubscription.id)
        .where(PushSubscription.user_id == user.id)
        .order_by(PushSubscription.updated_at.desc(), PushSubscription.id.desc())
        .offset(MAX_DEVICES)
    )
    await db.execute(
        delete(PushSubscription).where(PushSubscription.id.in_(unused)),
        execution_options=UNSYNCHRONIZED,
    )
    await db.commit()


@router.post("/unsubscribe", status_code=204)
async def unsubscribe(body: PushEndpointIn, user: CurrentUser, db: DB) -> None:
    """Stop the notifications of this device (nothing happens unless it is registered for the
    signed-in user)."""
    await db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == user.id
        ),
        execution_options=UNSYNCHRONIZED,
    )
    await db.commit()


@router.post("/test", status_code=204)
async def send_test(body: PushEndpointIn, request: Request, user: CurrentUser, db: DB) -> None:
    """Send a sample notification to this device now. 404 ``push_subscription_not_found`` unless
    it is registered for the signed-in user (also once its push service has forgotten it); 502
    ``push_failed`` when the push service refused it or could not be reached."""
    await throttle(db, request, "push-test", f"user:{user.id}", limit=10, ip_limit=30)
    row = await db.scalar(
        select(PushSubscription).where(
            PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == user.id
        )
    )
    if row is None:
        raise AppError("push_subscription_not_found", 404)
    result = await notifier(request).sender.send(
        subscription_of(row),
        test_message(row.origin, row.locale),
        ttl=TEST_TTL_SECONDS,
        urgency="high",
    )
    if result == "gone":
        await db.delete(row)
        await db.commit()
        raise AppError("push_subscription_not_found", 404)
    if result != "delivered":
        raise AppError("push_failed", 502)


@dataclass(frozen=True)
class Due:
    """A device whose day has reached the time of its memories, with what it needs to be told."""

    id: int
    user_id: int
    subscription: webpush.Subscription
    origin: str
    locale: Locale
    day: dt.date
    # Seconds left in the device's day: a notification still waiting at the push service is not
    # worth delivering on the next one.
    ttl: int


@dataclass(frozen=True)
class Retry:
    day: dt.date
    attempts: int
    not_before: dt.datetime


class Notifier:
    """Tells each registered device about its day's memories (see the module's description);
    ``tick`` does one round, ``start``/``stop`` run one every minute in the app's process."""

    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        config: Settings,
        sender: webpush.WebPush | None = None,
    ) -> None:
        self.sessions = sessions
        self.config = config
        self.sender = sender or webpush.WebPush(config)
        self.retries: dict[int, Retry] = {}
        self.task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self.task = asyncio.create_task(self.run(), name="timelife-notifications")

    async def stop(self) -> None:
        if self.task is not None:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None
        await self.sender.close()

    async def run(self) -> None:
        while True:
            try:
                await self.tick()
            except Exception as error:
                log.error("Notifications not sent (%s)", type(error).__name__)
            # Just after the start of each minute.
            await asyncio.sleep(TICK_SECONDS - time.time() % TICK_SECONDS + 1)

    def zone(self, name: str) -> ZoneInfo:
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError):
            return ZoneInfo(self.config.tz)

    async def tick(self, now: dt.datetime | None = None) -> None:
        """Send the notifications that are due at ``now``, then record what was done."""
        now = now or utcnow()
        handled: list[tuple[int, dt.date]] = []
        sends: list[tuple[Due, list[Memory]]] = []
        async with self.sessions() as db:
            rows = (
                await db.execute(
                    select(PushSubscription, User.memories_announced_on, User.memories_opened_on)
                    .join(User, User.id == PushSubscription.user_id)
                    .where(
                        User.disabled.is_(False),
                        PushSubscription.auth_version == User.auth_version,
                    )
                    .order_by(PushSubscription.id)
                )
            ).all()
            active = {row.id for row, *_ in rows}
            self.retries = {key: retry for key, retry in self.retries.items() if key in active}
            days: dict[dt.date, list[Memory]] = {}
            for row, announced_on, opened_on in rows:
                local = now.astimezone(self.zone(row.time_zone))
                day = local.date()
                retry = self.retries.get(row.id)
                if (
                    not NOTIFY_FROM <= local.time() < NOTIFY_UNTIL
                    or (row.memories_notified_on is not None and row.memories_notified_on >= day)
                    or (retry is not None and retry.day == day and retry.not_before > now)
                ):
                    continue
                # Read before anything is sent: every device of a person due now is told (and a
                # device tried again later still is, unless the memories were looked at meanwhile).
                retrying = retry is not None and retry.day == day
                told = (opened_on is not None and opened_on >= day) or (
                    not retrying and announced_on is not None and announced_on >= day
                )
                if not told and day not in days:
                    days[day] = await memories_on(db, day)
                if told or not days[day]:
                    handled.append((row.id, day))
                    continue
                midnight = dt.datetime.combine(day + dt.timedelta(days=1), dt.time(), local.tzinfo)
                due = Due(
                    id=row.id,
                    user_id=row.user_id,
                    subscription=subscription_of(row),
                    origin=row.origin,
                    locale=row.locale,
                    day=day,
                    ttl=max(60, int((midnight - now).total_seconds())),
                )
                sends.append((due, days[day]))
        results = [(due, await self.deliver(due, memories)) for due, memories in sends]
        if handled or results:
            await self.record(now, handled, results)

    async def deliver(self, due: Due, memories: Sequence[Memory]) -> webpush.Outcome:
        """Send the notification of ``memories`` to one device; never fails (a device that
        cannot be told now is tried again later, the others are told all the same)."""
        try:
            return await self.sender.send(
                due.subscription,
                memories_message(memories, due.origin, due.locale),
                ttl=due.ttl,
                topic="memories",
            )
        except Exception as error:
            log.error("Memories not sent to a device (%s)", type(error).__name__)
            return "retry"

    async def record(
        self,
        now: dt.datetime,
        handled: Sequence[tuple[int, dt.date]],
        results: Sequence[tuple[Due, webpush.Outcome]],
    ) -> None:
        async with self.sessions() as db:
            for subscription_id, day in handled:
                await self.mark(db, subscription_id, day)
            for due, result in results:
                if result == "retry":
                    previous = self.retries.get(due.id)
                    attempts = previous.attempts + 1 if previous and previous.day == due.day else 1
                    wait = RETRY_MINUTES[min(attempts, len(RETRY_MINUTES)) - 1]
                    self.retries[due.id] = Retry(due.day, attempts, now + dt.timedelta(minutes=wait))
                    continue
                self.retries.pop(due.id, None)
                if result == "gone":
                    await db.execute(
                        delete(PushSubscription).where(PushSubscription.id == due.id),
                        execution_options=UNSYNCHRONIZED,
                    )
                elif result == "delivered":
                    await self.mark(db, due.id, due.day, failures=0)
                    await db.execute(
                        update(User)
                        .where(
                            User.id == due.user_id,
                            or_(
                                User.memories_announced_on.is_(None),
                                User.memories_announced_on < due.day,
                            ),
                        )
                        .values(memories_announced_on=due.day),
                        execution_options=UNSYNCHRONIZED,
                    )
                else:
                    await self.mark(db, due.id, due.day, failures=PushSubscription.failures + 1)
            await db.execute(
                delete(PushSubscription).where(PushSubscription.failures >= MAX_FAILURES),
                execution_options=UNSYNCHRONIZED,
            )
            await db.commit()
        told = sum(result == "delivered" for _, result in results)
        if told:
            log.info("Memories told on %d device(s)", told)

    @staticmethod
    async def mark(db: AsyncSession, subscription_id: int, day: dt.date, **values: Any) -> None:
        """Record that the memories of ``day`` were dealt with on the device."""
        await db.execute(
            update(PushSubscription)
            .where(PushSubscription.id == subscription_id)
            .values(memories_notified_on=day, **values),
            execution_options=UNSYNCHRONIZED,
        )
