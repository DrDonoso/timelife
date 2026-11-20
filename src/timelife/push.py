"""Push notifications: the devices that turned them on, and what they are told (each day's
memories, the children's birthdays and the milestones other people add, as each person chose).

A browser, or the app installed on a phone's Home Screen, registers from the account panel
(``PUT /api/push/subscription``) with its push address and keys (``webpush``), the language of
the interface and its time zone; the interface registers it again each time it opens, so the
address, the language and the time zone stay current. The registration belongs to the session of
the device: signing out there stops the notifications, and a new password, a new role or a
disabled account stops them until the device signs in again. Each person chooses which
notifications reach their devices (``/api/push/preferences``: all of them until they say
otherwise).

``Notifier`` does a round every minute:

- **Memories**: the devices that have reached 9:00 of their own day (until 21:00, never at night:
  a server that was down at nine sends them when it is back) are told, when that day has memories
  their person has neither looked at nor been told about, with one notification each, as the
  notice of the interface: the first memory, and how many more. It counts as telling them
  (``users.memories_announced_on``), so the interface does not tell them again. Tapping it opens
  that milestone, or today's memories when there are several.
- **Birthdays**: at the same time of the device's day, on the day a child turns a whole number of
  years old, or one more month during their first year (with the dates of the memories:
  ``memory_age``), with one notification per child that opens their timeline. Each device is told
  once a day (``push_subscriptions.birthdays_notified_on``); the interface does not tell them.
- **New milestones**: adding one (``events``) queues it for every device of everybody else
  (``milestone_notifications``), and the next round tells each of them, at any time of day, with
  one notification per milestone (for which children, who added it, its title) that opens it. It
  is not sent to devices whose person does not want it or that are paused, nor once the milestone
  is in the trash; a device unreachable for a day misses it.

The messages use the declarative format (``"web_push": 8030``) that Safari shows by itself since
iOS 18.4; the service worker of the interface (``frontend/public/sw.js``) shows them everywhere
else."""

import asyncio
import datetime as dt
import logging
import time
import unicodedata
from collections.abc import Collection, Sequence
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
)
from .config import Settings
from .contracts import (
    PushConfigOut,
    PushEndpointIn,
    PushPreferencesIn,
    PushPreferencesOut,
    PushSubscriptionIn,
)
from .db import (
    Child,
    Event,
    EventChild,
    Locale,
    MilestoneNotification,
    PushSubscription,
    User,
    aware,
    utcnow,
)
from .errors import AppError
from .memories import Memory, MemoryUnit, event_path, memories_on, memory_age

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/push", tags=["Notifications"])

# The memories are told between these hours of the device's own day.
NOTIFY_FROM = dt.time(9, 0)
NOTIFY_UNTIL = dt.time(21, 0)
TICK_SECONDS = 60
# Minutes to wait before trying again after a push service or the network failed (the last one
# repeats until the end of the window).
RETRY_MINUTES = (2, 5, 15, 30, 60)
# Notifications in a row a push service may refuse for a device before it is forgotten (the
# device registers again the next time the app opens there).
MAX_FAILURES = 3
# Devices kept per person: registering one more forgets the one unused for longest.
MAX_DEVICES = 20
# A new milestone is told until a day after it was added (to devices unreachable until then).
MILESTONE_WINDOW = dt.timedelta(days=1)
# The longest title of a notification (a milestone of many children would not fit otherwise).
MAX_TITLE = 120
# What happened to the notifications of a device, the worst first: its outcome when it was sent
# several at once.
WORST_FIRST: tuple[webpush.Outcome, ...] = ("gone", "retry", "rejected", "delivered")
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
    # A child's birthday, with their ``{name}`` and the ``{count}`` of years they turn (or of
    # months, during their first year): its title, and its body.
    turns_years: tuple[str, str]
    turns_months: tuple[str, str]
    birthday: str
    born_months_ago: tuple[str, str]
    # A new milestone: its title (of whose children), and who added it (``added``: an account
    # without a name, or gone).
    milestone: str
    milestone_of: str
    added_by: str
    added: str
    # Between the last two names of a list.
    conjunction: str


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
        turns_years=("{name} cumple {count} año", "{name} cumple {count} años"),
        turns_months=("{name} cumple {count} mes", "{name} cumple {count} meses"),
        birthday="Hoy es su cumpleaños.",
        born_months_ago=("Hoy hace {count} mes que nació.", "Hoy hace {count} meses que nació."),
        milestone="Nuevo hito",
        milestone_of="Nuevo hito de {children}",
        added_by="{name} ha añadido «{title}».",
        added="Se ha añadido «{title}».",
        conjunction="y",
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
        turns_years=("{name} turns {count}", "{name} turns {count}"),
        turns_months=("{name} is {count} month old", "{name} is {count} months old"),
        birthday="Today is {name}’s birthday.",
        born_months_ago=(
            "{name} was born {count} month ago today.",
            "{name} was born {count} months ago today.",
        ),
        milestone="New milestone",
        milestone_of="New milestone for {children}",
        added_by="{name} added “{title}”.",
        added="“{title}” was added.",
        conjunction="and",
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
        turns_years=("{name} faz {count} ano", "{name} faz {count} anos"),
        turns_months=("{name} faz {count} mês", "{name} faz {count} meses"),
        birthday="Hoje é o aniversário de {name}.",
        born_months_ago=("Faz hoje {count} mês que nasceu.", "Faz hoje {count} meses que nasceu."),
        milestone="Novo marco",
        milestone_of="Novo marco de {children}",
        added_by="{name} adicionou «{title}».",
        added="Foi adicionado «{title}».",
        conjunction="e",
    ),
}


def plural(forms: tuple[str, str], count: int) -> str:
    return forms[0] if count == 1 else forms[1]


def sounds_like_i(word: str) -> bool:
    """Whether Spanish «y» becomes «e» before ``word``: it starts with the sound /i/ (``i``,
    ``hi``), as ``Intl.ListFormat`` checks, accented too («Íñigo»); not ``hie``/``hia``, a
    diphthong («agua y hielo»)."""
    letters = "".join(
        character
        for character in unicodedata.normalize("NFD", word.casefold())
        if not unicodedata.combining(character)
    )
    return letters.startswith("i") or (
        letters.startswith("hi") and not letters.startswith(("hia", "hie"))
    )


def listed(names: Sequence[str], locale: Locale) -> str:
    """``names`` in running text: «Lucía, Leo y Emma» (in Spanish «e» before the sound /i/:
    «Lucía e Inés»)."""
    if len(names) < 2:
        return "".join(names)
    conjunction = TEXTS[locale].conjunction
    if locale == "es" and sounds_like_i(names[-1]):
        conjunction = "e"
    return f"{', '.join(names[:-1])} {conjunction} {names[-1]}"


def shortened(text: str, limit: int = MAX_TITLE) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def notification(
    origin: str, locale: Locale, *, title: str, body: str, path: str, tag: str
) -> dict[str, Any]:
    """A declarative push message: the notification, and the page of ``origin`` it opens. Its
    title says what it is about, never the app's name: iOS adds "from <the app's name>" under the
    title of every notification."""
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


@dataclass(frozen=True)
class Birthday:
    """A child who turns a whole number of years old today, or (their first year) of months."""

    child_id: int
    name: str
    unit: MemoryUnit
    count: int
    # Their timeline.
    path: str


async def birthdays_on(db: AsyncSession, day: dt.date) -> list[Birthday]:
    """The children who have a birthday on ``day`` (as old as a memory of the day they were born
    would be), in the order of their timelines."""
    found: list[Birthday] = []
    for child_id, name, slug, born in await db.execute(
        select(Child.id, Child.name, Child.slug, Child.birth_date)
        .where(Child.birth_date < day)
        .order_by(Child.sort_order, Child.id)
    ):
        age = None if born is None else memory_age(born, day)
        if age is not None:
            found.append(Birthday(child_id, name, *age, path=f"/c/{slug}"))
    return found


def birthday_message(birthday: Birthday, origin: str, locale: Locale) -> dict[str, Any]:
    """The notification of a child's birthday: who, and how old they turn; it opens their
    timeline."""
    texts = TEXTS[locale]
    if birthday.unit == "years":
        title, body = plural(texts.turns_years, birthday.count), texts.birthday
    else:
        title = plural(texts.turns_months, birthday.count)
        body = plural(texts.born_months_ago, birthday.count)
    return notification(
        origin,
        locale,
        title=title.format(name=birthday.name, count=birthday.count),
        body=body.format(name=birthday.name, count=birthday.count),
        path=birthday.path,
        tag=f"birthday-{birthday.child_id}",
    )


@dataclass(frozen=True)
class Milestone:
    """A milestone someone added, as its notification tells it."""

    event_id: int
    title: str
    # The name of whoever added it; None: an account without a name, or gone.
    author: str | None
    # Its children, in the order of their timelines.
    children: tuple[str, ...]
    path: str


async def new_milestones(db: AsyncSession, event_ids: Collection[int]) -> dict[int, Milestone]:
    """The milestones ``event_ids``, as their notifications tell them, by id."""
    children: dict[int, list[tuple[str, str]]] = {}
    for event_id, name, slug in await db.execute(
        select(EventChild.event_id, Child.name, Child.slug)
        .join(Child, Child.id == EventChild.child_id)
        .where(EventChild.event_id.in_(event_ids))
        .order_by(Child.sort_order, Child.id)
    ):
        children.setdefault(event_id, []).append((name, slug))
    found: dict[int, Milestone] = {}
    for event_id, title, author in await db.execute(
        select(Event.id, Event.title, User.name)
        .outerjoin(User, User.id == Event.created_by_id)
        .where(Event.id.in_(event_ids))
    ):
        owners = children.get(event_id, [])
        found[event_id] = Milestone(
            event_id=event_id,
            title=title,
            author=author,
            children=tuple(name for name, _ in owners),
            path=event_path(event_id, owners[0][1] if owners else None),
        )
    return found


def milestone_message(milestone: Milestone, origin: str, locale: Locale) -> dict[str, Any]:
    """The notification of a milestone someone else added: for which children, who added it and
    its title; it opens that milestone."""
    texts = TEXTS[locale]
    title = (
        texts.milestone_of.format(children=listed(milestone.children, locale))
        if milestone.children
        else texts.milestone
    )
    body = (
        texts.added_by.format(name=milestone.author, title=milestone.title)
        if milestone.author
        else texts.added.format(title=milestone.title)
    )
    return notification(
        origin,
        locale,
        title=shortened(title),
        body=body,
        path=milestone.path,
        tag=f"milestone-{milestone.event_id}",
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
        birthdays_notified_on=None,
        failures=0,
        created_at=now,
        updated_at=now,
    )
    new = statement.excluded
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[PushSubscription.endpoint],
            set_={
                # Another person's device until now: today's memories and birthdays are still to
                # be told.
                **{
                    column: case(
                        (
                            PushSubscription.user_id == new.user_id,
                            getattr(PushSubscription, column),
                        ),
                        else_=None,
                    )
                    for column in ("memories_notified_on", "birthdays_notified_on")
                },
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


def preferences_out(user: User) -> PushPreferencesOut:
    return PushPreferencesOut(
        memories=user.notify_memories,
        milestones=user.notify_milestones,
        birthdays=user.notify_birthdays,
    )


@router.get("/preferences", response_model=PushPreferencesOut)
async def preferences(user: CurrentUser, db: DB) -> PushPreferencesOut:
    account = await db.get(User, user.id)
    if account is None:
        raise AppError("authentication_required", 401)
    return preferences_out(account)


@router.patch("/preferences", response_model=PushPreferencesOut)
async def choose_preferences(
    body: PushPreferencesIn, user: CurrentUser, db: DB
) -> PushPreferencesOut:
    """Choose which notifications reach the user's devices (every one that has them on)."""
    # Locked (FOR NO KEY UPDATE on PostgreSQL), so that two devices saving at once keep both.
    account = await db.scalar(
        select(User)
        .where(User.id == user.id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    if account is None:
        raise AppError("authentication_required", 401)
    if body.memories is not None:
        account.notify_memories = body.memories
    if body.milestones is not None:
        account.notify_milestones = body.milestones
    if body.birthdays is not None:
        account.notify_birthdays = body.birthdays
    await db.commit()
    return preferences_out(account)


@dataclass(frozen=True)
class Due:
    """A device whose day has reached the time of its morning notifications (memories and
    birthdays), with what it needs to be told."""

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
class MilestoneDue:
    """A device to tell about a new milestone now."""

    subscription_id: int
    subscription: webpush.Subscription
    origin: str
    locale: Locale
    milestone: Milestone
    # Seconds left until the milestone is no longer told.
    ttl: int

    @property
    def key(self) -> tuple[int, int]:
        return self.subscription_id, self.milestone.event_id


@dataclass(frozen=True)
class Retry:
    """A notification its push service or the network failed: tried again from ``not_before``.
    ``day``: of the memories or birthdays it tells (None for a new milestone)."""

    attempts: int
    not_before: dt.datetime
    day: dt.date | None = None


def retry_after(previous: Retry | None, now: dt.datetime, day: dt.date | None = None) -> Retry:
    """The next attempt after one more failure (counted from one again for another day)."""
    attempts = previous.attempts + 1 if previous is not None and previous.day == day else 1
    wait = RETRY_MINUTES[min(attempts, len(RETRY_MINUTES)) - 1]
    return Retry(attempts, now + dt.timedelta(minutes=wait), day)


class Notifier:
    """Tells the registered devices about their day's memories, the children's birthdays and the
    new milestones (see the module's description); ``tick`` does one round, ``start``/``stop`` run
    one every minute in the app's process."""

    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        config: Settings,
        sender: webpush.WebPush | None = None,
    ) -> None:
        self.sessions = sessions
        self.config = config
        self.sender = sender or webpush.WebPush(config)
        # What to try again: memories and birthdays by device, new milestones by (device,
        # milestone).
        self.memory_retries: dict[int, Retry] = {}
        self.birthday_retries: dict[int, Retry] = {}
        self.milestone_retries: dict[tuple[int, int], Retry] = {}
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
        await self.tell_memories(now)
        await self.tell_birthdays(now)
        await self.tell_milestones(now)

    # Each morning: memories and birthdays ------------------------------------------------------

    def due(
        self,
        row: PushSubscription,
        dealt_with_on: dt.date | None,
        retry: Retry | None,
        now: dt.datetime,
    ) -> Due | None:
        """The device ``row``, with what it needs to be told now about the news of its day (its
        memories, or its birthdays), last dealt with on ``dealt_with_on``. None before 9:00 and
        from 21:00 of its own day, once that day was dealt with, and while it waits to be tried
        again."""
        local = now.astimezone(self.zone(row.time_zone))
        day = local.date()
        if (
            not NOTIFY_FROM <= local.time() < NOTIFY_UNTIL
            or (dealt_with_on is not None and dealt_with_on >= day)
            or (retry is not None and retry.day == day and retry.not_before > now)
        ):
            return None
        midnight = dt.datetime.combine(day + dt.timedelta(days=1), dt.time(), local.tzinfo)
        return Due(
            id=row.id,
            user_id=row.user_id,
            subscription=subscription_of(row),
            origin=row.origin,
            locale=row.locale,
            day=day,
            ttl=max(60, int((midnight - now).total_seconds())),
        )

    async def record_day(
        self,
        db: AsyncSession,
        now: dt.datetime,
        column: str,
        retries: dict[int, Retry],
        handled: Sequence[tuple[int, dt.date]],
        results: Sequence[tuple[Due, webpush.Outcome]],
    ) -> None:
        """Record what was done with the news of each device's day (``column``: the last day it
        was dealt with): nothing to tell (``handled``), or sent, with the outcome. A push service
        or a network that failed is tried again later (``retries``); a refused notification counts
        as dealt with, and as one more failure of the device; a device its push service forgot is
        forgotten. No commit."""
        for subscription_id, day in handled:
            await self.mark(db, subscription_id, {column: day})
        for due, result in results:
            if result == "retry":
                retries[due.id] = retry_after(retries.get(due.id), now, due.day)
                continue
            retries.pop(due.id, None)
            if result == "gone":
                await db.execute(
                    delete(PushSubscription).where(PushSubscription.id == due.id),
                    execution_options=UNSYNCHRONIZED,
                )
            else:
                failures = 0 if result == "delivered" else PushSubscription.failures + 1
                await self.mark(db, due.id, {column: due.day, "failures": failures})
        await self.forget_refusing(db)

    @staticmethod
    async def mark(db: AsyncSession, subscription_id: int, values: dict[str, Any]) -> None:
        await db.execute(
            update(PushSubscription)
            .where(PushSubscription.id == subscription_id)
            .values(values),
            execution_options=UNSYNCHRONIZED,
        )

    # Memories -----------------------------------------------------------------------------------

    async def tell_memories(self, now: dt.datetime) -> None:
        handled: list[tuple[int, dt.date]] = []
        sends: list[tuple[Due, list[Memory]]] = []
        async with self.sessions() as db:
            rows = (
                await db.execute(
                    select(PushSubscription, User.memories_announced_on, User.memories_opened_on)
                    .join(User, User.id == PushSubscription.user_id)
                    .where(
                        User.disabled.is_(False),
                        User.notify_memories.is_(True),
                        PushSubscription.auth_version == User.auth_version,
                    )
                    .order_by(PushSubscription.id)
                )
            ).all()
            active = {row.id for row, *_ in rows}
            self.memory_retries = {
                key: retry for key, retry in self.memory_retries.items() if key in active
            }
            days: dict[dt.date, list[Memory]] = {}
            for row, announced_on, opened_on in rows:
                retry = self.memory_retries.get(row.id)
                due = self.due(row, row.memories_notified_on, retry, now)
                if due is None:
                    continue
                day = due.day
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
                sends.append((due, days[day]))
        results = [(due, await self.deliver_memories(due, memories)) for due, memories in sends]
        if handled or results:
            await self.record_memories(now, handled, results)

    async def deliver_memories(self, due: Due, memories: Sequence[Memory]) -> webpush.Outcome:
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

    async def record_memories(
        self,
        now: dt.datetime,
        handled: Sequence[tuple[int, dt.date]],
        results: Sequence[tuple[Due, webpush.Outcome]],
    ) -> None:
        async with self.sessions() as db:
            await self.record_day(
                db, now, "memories_notified_on", self.memory_retries, handled, results
            )
            for due, result in results:
                if result == "delivered":
                    # Its person was told: the interface does not tell them again.
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
            await db.commit()
        told = sum(result == "delivered" for _, result in results)
        if told:
            log.info("Memories told on %d device(s)", told)

    # Birthdays ----------------------------------------------------------------------------------

    async def tell_birthdays(self, now: dt.datetime) -> None:
        handled: list[tuple[int, dt.date]] = []
        sends: list[tuple[Due, list[Birthday]]] = []
        async with self.sessions() as db:
            rows = list(
                await db.scalars(
                    select(PushSubscription)
                    .join(User, User.id == PushSubscription.user_id)
                    .where(
                        User.disabled.is_(False),
                        User.notify_birthdays.is_(True),
                        PushSubscription.auth_version == User.auth_version,
                    )
                    .order_by(PushSubscription.id)
                )
            )
            active = {row.id for row in rows}
            self.birthday_retries = {
                key: retry for key, retry in self.birthday_retries.items() if key in active
            }
            days: dict[dt.date, list[Birthday]] = {}
            for row in rows:
                retry = self.birthday_retries.get(row.id)
                due = self.due(row, row.birthdays_notified_on, retry, now)
                if due is None:
                    continue
                if due.day not in days:
                    days[due.day] = await birthdays_on(db, due.day)
                if days[due.day]:
                    sends.append((due, days[due.day]))
                else:
                    handled.append((row.id, due.day))
        results = [(due, await self.deliver_birthdays(due, birthdays)) for due, birthdays in sends]
        if handled or results:
            await self.record_birthdays(now, handled, results)

    async def deliver_birthdays(
        self, due: Due, birthdays: Sequence[Birthday]
    ) -> webpush.Outcome:
        """Send the notification of each birthday to one device; never fails (as
        ``deliver_memories``). The outcome of the device is the worst of them: its push service
        forgot it, else to try again (all of them: those already delivered are replaced, as they
        have the same tag and topic), else refused, else delivered."""
        outcomes: list[webpush.Outcome] = []
        for birthday in birthdays:
            try:
                outcome = await self.sender.send(
                    due.subscription,
                    birthday_message(birthday, due.origin, due.locale),
                    ttl=due.ttl,
                    topic=f"birthday-{birthday.child_id}",
                )
            except Exception as error:
                log.error("Birthday not sent to a device (%s)", type(error).__name__)
                outcome = "retry"
            if outcome == "gone":
                return outcome
            outcomes.append(outcome)
        return min(outcomes, key=WORST_FIRST.index)

    async def record_birthdays(
        self,
        now: dt.datetime,
        handled: Sequence[tuple[int, dt.date]],
        results: Sequence[tuple[Due, webpush.Outcome]],
    ) -> None:
        async with self.sessions() as db:
            await self.record_day(
                db, now, "birthdays_notified_on", self.birthday_retries, handled, results
            )
            await db.commit()
        told = sum(result == "delivered" for _, result in results)
        if told:
            log.info("Birthdays told on %d device(s)", told)

    # New milestones -----------------------------------------------------------------------------

    async def tell_milestones(self, now: dt.datetime) -> None:
        dropped: list[tuple[int, int]] = []
        sends: list[MilestoneDue] = []
        async with self.sessions() as db:
            rows = (
                await db.execute(
                    select(
                        PushSubscription,
                        MilestoneNotification.event_id,
                        MilestoneNotification.created_at,
                        User.notify_milestones,
                        User.disabled,
                        User.auth_version,
                        Event.created_by_id,
                        Event.deleted_at,
                    )
                    .select_from(MilestoneNotification)
                    .join(
                        PushSubscription,
                        PushSubscription.id == MilestoneNotification.subscription_id,
                    )
                    .join(User, User.id == PushSubscription.user_id)
                    .join(Event, Event.id == MilestoneNotification.event_id)
                    .order_by(MilestoneNotification.event_id, MilestoneNotification.subscription_id)
                )
            ).all()
            queued = {(row.id, event_id) for row, event_id, *_ in rows}
            self.milestone_retries = {
                key: retry for key, retry in self.milestone_retries.items() if key in queued
            }
            if not rows:
                return
            waiting: list[tuple[PushSubscription, int, dt.datetime]] = []
            for row, event_id, queued_at, wanted, disabled, version, author_id, deleted_at in rows:
                until = aware(queued_at) + MILESTONE_WINDOW
                if (
                    until <= now
                    or not wanted
                    or disabled
                    or row.auth_version != version
                    or row.user_id == author_id
                    or deleted_at is not None
                ):
                    dropped.append((row.id, event_id))
                    continue
                retry = self.milestone_retries.get((row.id, event_id))
                if retry is None or retry.not_before <= now:
                    waiting.append((row, event_id, until))
            milestones = (
                await new_milestones(db, {event_id for _, event_id, _ in waiting})
                if waiting
                else {}
            )
            for row, event_id, until in waiting:
                milestone = milestones.get(event_id)
                if milestone is None:
                    dropped.append((row.id, event_id))
                    continue
                sends.append(
                    MilestoneDue(
                        subscription_id=row.id,
                        subscription=subscription_of(row),
                        origin=row.origin,
                        locale=row.locale,
                        milestone=milestone,
                        ttl=max(60, int((until - now).total_seconds())),
                    )
                )
        results: list[tuple[MilestoneDue, webpush.Outcome]] = []
        gone: set[int] = set()
        for due in sends:
            # Its push service forgot it: what else was queued for it goes with it.
            if due.subscription_id in gone:
                continue
            result = await self.deliver_milestone(due)
            if result == "gone":
                gone.add(due.subscription_id)
            results.append((due, result))
        if dropped or results:
            await self.record_milestones(now, dropped, results)

    async def deliver_milestone(self, due: MilestoneDue) -> webpush.Outcome:
        """Send the notification of a new milestone to one device; never fails (as
        ``deliver_memories``)."""
        try:
            return await self.sender.send(
                due.subscription,
                milestone_message(due.milestone, due.origin, due.locale),
                ttl=due.ttl,
            )
        except Exception as error:
            log.error("New milestone not sent to a device (%s)", type(error).__name__)
            return "retry"

    async def record_milestones(
        self,
        now: dt.datetime,
        dropped: Sequence[tuple[int, int]],
        results: Sequence[tuple[MilestoneDue, webpush.Outcome]],
    ) -> None:
        done = list(dropped)
        async with self.sessions() as db:
            for due, result in results:
                if result == "retry":
                    previous = self.milestone_retries.get(due.key)
                    self.milestone_retries[due.key] = retry_after(previous, now)
                    continue
                if result == "gone":
                    await db.execute(
                        delete(PushSubscription).where(PushSubscription.id == due.subscription_id),
                        execution_options=UNSYNCHRONIZED,
                    )
                    continue
                done.append(due.key)
                failures = 0 if result == "delivered" else PushSubscription.failures + 1
                await db.execute(
                    update(PushSubscription)
                    .where(PushSubscription.id == due.subscription_id)
                    .values(failures=failures),
                    execution_options=UNSYNCHRONIZED,
                )
            for subscription_id, event_id in done:
                self.milestone_retries.pop((subscription_id, event_id), None)
                await db.execute(
                    delete(MilestoneNotification).where(
                        MilestoneNotification.subscription_id == subscription_id,
                        MilestoneNotification.event_id == event_id,
                    ),
                    execution_options=UNSYNCHRONIZED,
                )
            await self.forget_refusing(db)
            await db.commit()
        told = sum(result == "delivered" for _, result in results)
        if told:
            log.info("New milestones told on %d device(s)", told)

    @staticmethod
    async def forget_refusing(db: AsyncSession) -> None:
        """Forget the devices whose push service refused too many notifications in a row."""
        await db.execute(
            delete(PushSubscription).where(PushSubscription.failures >= MAX_FAILURES),
            execution_options=UNSYNCHRONIZED,
        )
