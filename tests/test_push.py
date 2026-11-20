"""Push notifications: devices register for them (only their own person's, only the push services
of the major browsers), signing out stops them, each person chooses which ones they want, each
device is told about its day's memories once, from 9:00 of its own time zone, unless its person
already saw them or was told, about the children's birthdays once, at the same time, and about
each milestone someone else adds, at once."""

import datetime as dt
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from timelife import push, webpush
from timelife.auth import revoke_user_sessions
from timelife.config import Settings
from timelife.db import Locale, MilestoneNotification, PushSubscription, User
from timelife.memories import MemoryUnit

from .conftest import app_client, login_as, run_db
from .helpers_events import add_child, category_ids, create_event, update_event
from .helpers_push import Browser, PushService

SUBSCRIPTION = "/api/push/subscription"
PREFERENCES = "/api/push/preferences"
TODAY = dt.date(2026, 11, 18)
# Everybody's notifications until they choose.
ALL = {"memories": True, "milestones": True, "birthdays": True}


def at(hour: int, minute: int = 0, day: int = 18) -> dt.datetime:
    """A moment of November 2026 in UTC (Madrid is an hour ahead, New York five behind)."""
    return dt.datetime(2026, 11, day, hour, minute, tzinfo=dt.UTC)


@pytest.fixture(autouse=True)
def service(monkeypatch: pytest.MonkeyPatch) -> PushService:
    service = PushService()
    monkeypatch.setattr(webpush, "TRANSPORT", httpx.MockTransport(service))
    return service


def register(client: TestClient, browser: Browser, **changes: Any) -> None:
    response = client.put(SUBSCRIPTION, json=browser.subscription(**changes))
    assert response.status_code == 204, response.text


def stored(client: TestClient) -> list[PushSubscription]:
    async def load(db: AsyncSession) -> list[PushSubscription]:
        return list(await db.scalars(select(PushSubscription).order_by(PushSubscription.id)))

    return run_db(client, load)


def set_user(client: TestClient, email: str, **values: Any) -> None:
    async def change(db: AsyncSession) -> None:
        await db.execute(update(User).where(User.email == email).values(**values))
        await db.commit()

    run_db(client, change)


def user_row(client: TestClient, email: str) -> User:
    async def load(db: AsyncSession) -> User | None:
        return await db.scalar(select(User).where(User.email == email))

    user = run_db(client, load)
    assert user is not None
    return user


def tick(client: TestClient, now: dt.datetime) -> None:
    app: Any = client.app
    assert client.portal is not None
    client.portal.call(app.state.notifier.tick, now)


def add_memories(client: TestClient, *items: tuple[str, str]) -> dict[str, int]:
    """Milestones of Lucía (``(title, date)``), created by an administrator; their ids by title."""
    login_as(client, "admin")
    child = add_child(client, "Lucía")
    category = next(iter(category_ids(client).values()))
    return {
        title: create_event(client, [child], [category], title=title, date=date)["id"]
        for title, date in items
    }


# Registering ---------------------------------------------------------------------------------


def test_notifications_need_a_session(client: TestClient) -> None:
    browser = Browser()
    assert client.get("/api/push").status_code == 401
    assert client.put(SUBSCRIPTION, json=browser.subscription()).status_code == 401
    stop = client.post("/api/push/unsubscribe", json={"endpoint": browser.endpoint})
    assert stop.status_code == 401
    assert client.get(PREFERENCES).status_code == 401
    assert client.patch(PREFERENCES, json={"memories": False}).status_code == 401


def test_browsers_subscribe_with_the_key_of_auth_secret(viewer: TestClient, config: Settings) -> None:
    key = viewer.get("/api/push").json()["public_key"]
    secret = config.auth_secret.get_secret_value()
    assert key == webpush.b64encode(webpush.public_bytes(webpush.vapid_key(secret)))


def test_a_device_registers_and_keeps_its_registration_current(viewer: TestClient) -> None:
    browser = Browser()
    register(viewer, browser)
    (first,) = stored(viewer)
    assert (first.locale, first.time_zone) == ("es", "Europe/Madrid")
    assert first.origin == "http://testserver"
    assert first.user_id == user_row(viewer, "viewer@example.com").id

    # The app registers again each time it opens: the same device, with its current settings.
    register(viewer, browser, locale="pt", time_zone="America/New_York")
    (again,) = stored(viewer)
    assert (again.id, again.locale, again.time_zone) == (first.id, "pt", "America/New_York")
    # Without a time zone, the server's.
    register(viewer, browser, time_zone=None)
    assert stored(viewer)[0].time_zone == "Europe/Madrid"


@pytest.mark.parametrize(
    ("changes", "error"),
    [
        ({"endpoint": "https://push.example.net/x"}, {"code": "push_service_unsupported"}),
        (
            {"endpoint": "http://fcm.googleapis.com/fcm/send/x"},
            {"code": "invalid_request", "fields": {"endpoint": "value_error"}},
        ),
        (
            {"keys": {"p256dh": "AAAA", "auth": "BTBZMqHH6r4Tts7J_aSIgg"}},
            {"code": "invalid_request", "fields": {"p256dh": "value_error"}},
        ),
        (
            {"time_zone": "Mars/Olympus_Mons"},
            {"code": "invalid_request", "fields": {"time_zone": "value_error"}},
        ),
        (
            {"time_zone": "../etc/passwd"},
            {"code": "invalid_request", "fields": {"time_zone": "string_pattern_mismatch"}},
        ),
        ({"locale": "fr"}, {"code": "invalid_request", "fields": {"locale": "literal_error"}}),
        (
            {"expirationTime": None},
            {"code": "invalid_request", "fields": {"expirationTime": "extra_forbidden"}},
        ),
    ],
)
def test_only_known_push_services_and_valid_keys(
    viewer: TestClient, changes: dict[str, Any], error: dict[str, Any]
) -> None:
    response = viewer.put(SUBSCRIPTION, json=Browser().subscription(**changes))
    assert response.status_code == 422
    assert response.json() == error
    assert stored(viewer) == []


def test_a_device_belongs_to_whoever_registered_it_last(client: TestClient) -> None:
    browser = Browser()
    login_as(client, "viewer")
    register(client, browser)
    set_user(client, "viewer@example.com", memories_announced_on=TODAY)
    run_db(client, mark_notified(TODAY))

    login_as(client, "admin")
    register(client, browser)
    (row,) = stored(client)
    assert row.user_id == user_row(client, "admin@example.com").id
    # Today's memories and birthdays are still to be told to the new person.
    assert (row.memories_notified_on, row.birthdays_notified_on) == (None, None)

    # Nobody else can stop it.
    login_as(client, "viewer")
    assert client.post("/api/push/unsubscribe", json={"endpoint": browser.endpoint}).status_code == 204
    assert len(stored(client)) == 1
    login_as(client, "admin")
    assert client.post("/api/push/unsubscribe", json={"endpoint": browser.endpoint}).status_code == 204
    assert stored(client) == []


def mark_notified(day: dt.date) -> Any:
    async def change(db: AsyncSession) -> None:
        await db.execute(
            update(PushSubscription).values(memories_notified_on=day, birthdays_notified_on=day)
        )
        await db.commit()

    return change


def test_a_person_keeps_their_latest_devices(
    viewer: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(push, "MAX_DEVICES", 2)
    browsers = [Browser(f"https://fcm.googleapis.com/fcm/send/device-{n}") for n in range(3)]
    for browser in browsers:
        register(viewer, browser)
    register(viewer, browsers[0])
    assert {row.endpoint for row in stored(viewer)} == {browsers[0].endpoint, browsers[2].endpoint}


def test_each_person_chooses_their_notifications(client: TestClient) -> None:
    login_as(client, "admin")
    login_as(client, "viewer")
    assert client.get(PREFERENCES).json() == ALL

    response = client.patch(PREFERENCES, json={"milestones": False})
    assert response.status_code == 200, response.text
    assert response.json() == {**ALL, "milestones": False}
    # Only what is sent changes.
    for body in ({}, {"memories": None}):
        assert client.patch(PREFERENCES, json=body).json() == {**ALL, "milestones": False}
    chosen = {"memories": False, "milestones": True, "birthdays": False}
    assert client.patch(PREFERENCES, json=chosen).json() == chosen
    assert client.get(PREFERENCES).json() == chosen
    viewer = user_row(client, "viewer@example.com")
    assert (viewer.notify_memories, viewer.notify_milestones, viewer.notify_birthdays) == (
        False,
        True,
        False,
    )
    # Everyone chooses their own.
    login_as(client, "admin")
    assert client.get(PREFERENCES).json() == ALL


@pytest.mark.parametrize(
    ("body", "fields"),
    [
        ({"memories": "maybe"}, {"memories": "bool_parsing"}),
        ({"milestones": [True]}, {"milestones": "bool_type"}),
        ({"birthdays": "sí"}, {"birthdays": "bool_parsing"}),
        ({"test": True}, {"test": "extra_forbidden"}),
    ],
)
def test_choices_are_true_or_false(
    viewer: TestClient, body: dict[str, Any], fields: dict[str, str]
) -> None:
    response = viewer.patch(PREFERENCES, json=body)
    assert (response.status_code, response.json()) == (
        422,
        {"code": "invalid_request", "fields": fields},
    )
    assert viewer.get(PREFERENCES).json() == ALL


# Sessions ------------------------------------------------------------------------------------


def test_signing_out_stops_the_notifications_of_that_device(client: TestClient) -> None:
    phone, laptop = Browser(), Browser("https://fcm.googleapis.com/fcm/send/laptop")
    login_as(client, "viewer")
    register(client, phone)
    # The same person on another device (another session).
    login_as(client, "viewer")
    register(client, laptop)

    assert client.post("/api/auth/logout").status_code == 204
    assert [row.endpoint for row in stored(client)] == [phone.endpoint]


def test_signing_in_again_keeps_the_device_for_the_same_person_only(config_factory: Any) -> None:
    config = config_factory(public_origin="http://localhost", allow_insecure_local_login=True)
    browser = Browser()
    with app_client(config) as client:

        def dev_login(username: str) -> None:
            response = client.post(
                "/api/auth/dev-login", json={"username": username, "password": "admin"}
            )
            assert response.status_code == 200, response.text

        dev_login("viewer")
        register(client, browser)
        (before,) = stored(client)

        async def revoke(db: AsyncSession) -> None:
            user = await db.get(User, before.user_id)
            assert user is not None
            await revoke_user_sessions(db, user)
            await db.commit()

        # A new password elsewhere signed this device out too: it signs in again and its
        # notifications go on, now with the session and the version of the account it has.
        run_db(client, revoke)
        dev_login("viewer")
        (after,) = stored(client)
        assert after.session_hash != before.session_hash
        assert after.auth_version == before.auth_version + 1

        # Someone else signs in on it: the previous person's notifications stop there.
        dev_login("admin")
        assert stored(client) == []


# The morning notification --------------------------------------------------------------------


def test_each_device_is_told_at_nine_of_its_own_day(client: TestClient, service: PushService) -> None:
    add_memories(client, ("Primeros pasos", "2025-11-18"))
    madrid, new_york = Browser("https://web.push.apple.com/madrid"), Browser()
    login_as(client, "viewer")
    register(client, madrid)
    login_as(client, "admin")
    register(client, new_york, time_zone="America/New_York", locale="en")

    tick(client, at(7, 59))  # 8:59 in Madrid
    assert service.requests == []
    tick(client, at(8))
    assert [message["notification"]["title"] for message in service.messages(madrid)] == ["Recuerdos de hoy"]
    tick(client, at(8, 1))
    tick(client, at(13, 59))  # 8:59 in New York
    assert len(service.requests) == 1
    tick(client, at(14))
    assert [message["notification"]["title"] for message in service.messages(new_york)] == ["Today’s memories"]
    tick(client, at(22))
    assert len(service.requests) == 2
    # Each person was told (the interface does not tell them again).
    assert user_row(client, "viewer@example.com").memories_announced_on == TODAY
    assert user_row(client, "admin@example.com").memories_announced_on == TODAY


def test_the_notification_tells_the_first_memory_and_opens_it(
    client: TestClient, service: PushService
) -> None:
    ids = add_memories(client, ("Primeros pasos", "2025-11-18"))
    browser = Browser()
    login_as(client, "viewer")
    register(client, browser)
    tick(client, at(9, 30))

    (message,) = service.messages(browser)
    event = ids["Primeros pasos"]
    assert message == {
        "web_push": 8030,
        "notification": {
            "title": "Recuerdos de hoy",
            "body": "Tal día como hoy, hace 1 año: «Primeros pasos».",
            "lang": "es-ES",
            "dir": "ltr",
            "navigate": f"http://testserver/c/lucia/e/{event}?zoom=events&focus=e{event}&memories=seen",
            "tag": "memories",
            "silent": False,
            "icon": "http://testserver/icon-192.png",
            "badge": "http://testserver/badge-96.png",
        },
        "app_badge": 1,
    }
    headers = service.requests[0].headers
    # Kept by the push service until midnight in Madrid at most (23:00 UTC).
    assert (headers["ttl"], headers["urgency"], headers["topic"]) == ("48600", "normal", "memories")


@pytest.mark.parametrize(
    ("locale", "body"),
    [
        ("es", "Tal día como hoy, hace 1 mes: «Primera palabra» y 2 recuerdos más."),
        ("en", "On this day, 1 month ago: “Primera palabra” and 2 more memories."),
        ("pt", "Neste dia, há 1 mês: «Primera palabra» e mais 2 memórias."),
    ],
)
def test_several_memories_open_their_list(
    client: TestClient, service: PushService, locale: str, body: str
) -> None:
    add_memories(
        client,
        ("Nacimiento", "2024-11-18"),
        ("Primeros pasos", "2025-11-18"),
        ("Primera palabra", "2026-10-18"),
        ("Otro día", "2026-10-17"),
    )
    browser = Browser()
    register(client, browser, locale=locale)
    tick(client, at(8))
    (message,) = service.messages(browser)
    assert message["notification"]["body"] == body
    assert message["notification"]["navigate"] == "http://testserver/?memories=open"
    assert message["app_badge"] == 3


def test_every_device_of_a_person_due_together_is_told_once(
    client: TestClient, service: PushService
) -> None:
    add_memories(client, ("Primeros pasos", "2025-11-18"))
    phone, tablet = Browser(), Browser("https://fcm.googleapis.com/fcm/send/tablet")
    register(client, phone)
    register(client, tablet)
    tick(client, at(8))
    tick(client, at(10))
    assert len(service.messages(phone)) == len(service.messages(tablet)) == 1


@pytest.mark.parametrize(
    "seen", [{"memories_opened_on": TODAY}, {"memories_announced_on": TODAY}]
)
def test_nobody_is_told_twice_in_a_day(
    client: TestClient, service: PushService, seen: dict[str, dt.date]
) -> None:
    add_memories(client, ("Primeros pasos", "2025-11-18"))
    register(client, Browser())
    set_user(client, "admin@example.com", **seen)
    tick(client, at(8))
    assert service.requests == []
    assert stored(client)[0].memories_notified_on == TODAY


def test_days_without_memories_send_nothing(client: TestClient, service: PushService) -> None:
    ids = add_memories(client, ("Primeros pasos", "2025-11-19"), ("Borrado", "2025-11-18"))
    assert client.delete(f"/api/admin/events/{ids['Borrado']}").status_code == 204
    register(client, Browser())
    tick(client, at(8))
    assert service.requests == []
    assert stored(client)[0].memories_notified_on == TODAY
    # The next day has one.
    tick(client, at(8, day=19))
    assert len(service.requests) == 1


def test_only_active_accounts_are_told(client: TestClient, service: PushService) -> None:
    add_memories(client, ("Primeros pasos", "2025-11-18"))
    login_as(client, "viewer")
    register(client, Browser())
    set_user(client, "viewer@example.com", disabled=True)
    tick(client, at(8))
    set_user(client, "viewer@example.com", disabled=False, auth_version=2)
    tick(client, at(8, 1))
    assert service.requests == []


def test_memories_only_reach_those_who_want_them(client: TestClient, service: PushService) -> None:
    add_memories(client, ("Primeros pasos", "2025-11-18"))
    login_as(client, "viewer")
    register(client, Browser())
    assert client.patch(PREFERENCES, json={"memories": False}).status_code == 200
    tick(client, at(8))
    assert service.requests == []
    # Not told: the app tells them when they come in, and so does a notification if they want it
    # again before the day is over.
    assert user_row(client, "viewer@example.com").memories_announced_on is None
    assert client.patch(PREFERENCES, json={"memories": True}).status_code == 200
    tick(client, at(9))
    assert len(service.requests) == 1


def test_a_push_service_that_fails_is_tried_again_later(client: TestClient, service: PushService) -> None:
    add_memories(client, ("Primeros pasos", "2025-11-18"))
    browser = Browser()
    register(client, browser)
    service.status = None
    tick(client, at(8))
    service.status = 201
    tick(client, at(8, 1))
    assert len(service.requests) == 1
    tick(client, at(8, 2))
    assert len(service.messages(browser)) == 2
    tick(client, at(8, 30))
    assert len(service.requests) == 2


def test_a_device_that_fails_does_not_keep_the_others_waiting(
    client: TestClient, service: PushService, caplog: pytest.LogCaptureFixture
) -> None:
    add_memories(client, ("Primeros pasos", "2025-11-18"), ("Primer baño", "2025-11-19"))
    broken, phone = Browser("https://fcm.googleapis.com/fcm/send/broken"), Browser()
    register(client, broken)
    register(client, phone)
    service.broken.add(broken.endpoint)
    tick(client, at(8))
    assert len(service.messages(phone)) == 1
    assert "Memories not sent to a device (RuntimeError)" in caplog.text
    # Tried again later: still told, though its person already was on the phone.
    service.broken.clear()
    tick(client, at(8, 2))
    assert len(service.messages(broken)) == 2

    # The next day, unless its person looked at the memories meanwhile.
    service.broken.add(broken.endpoint)
    tick(client, at(8, day=19))
    set_user(client, "admin@example.com", memories_opened_on=dt.date(2026, 11, 19))
    service.broken.clear()
    tick(client, at(8, 5, day=19))
    assert len(service.messages(broken)) == 3
    assert len(service.messages(phone)) == 2


def test_devices_their_push_service_forgot_are_forgotten(
    client: TestClient, service: PushService
) -> None:
    add_memories(client, ("Primeros pasos", "2025-11-18"), ("Otro", "2025-11-19"), ("Más", "2025-11-20"))
    gone, refused = Browser(), Browser("https://fcm.googleapis.com/fcm/send/refused")
    register(client, gone)
    service.status = 410
    tick(client, at(8))
    assert stored(client) == []

    register(client, refused)
    service.status = 403
    # Refused three days in a row: forgotten (the app registers it again when it opens).
    tick(client, at(8))
    assert stored(client)[0].failures == 1
    tick(client, at(8, day=19))
    assert stored(client)[0].failures == 2
    tick(client, at(8, day=20))
    assert stored(client) == []


# Birthdays -----------------------------------------------------------------------------------


def add_children(client: TestClient, *children: tuple[str, str | None]) -> dict[str, int]:
    """Children (``(name, birth date)``), added by an administrator who stays signed in; their
    ids by name."""
    login_as(client, "admin")
    return {name: add_child(client, name, birth_date=born) for name, born in children}


def test_birthdays_are_told_at_nine_of_each_device_day(
    client: TestClient, service: PushService
) -> None:
    add_children(client, ("Lucía", "2022-11-18"))
    madrid, new_york = Browser("https://web.push.apple.com/madrid"), Browser()
    login_as(client, "viewer")
    register(client, madrid)
    login_as(client, "admin")
    register(client, new_york, time_zone="America/New_York", locale="en")

    tick(client, at(7, 59))  # 8:59 in Madrid
    assert service.requests == []
    tick(client, at(8))
    assert [message["notification"]["title"] for message in service.messages(madrid)] == [
        "Lucía cumple 4 años"
    ]
    tick(client, at(8, 1))
    tick(client, at(13, 59))  # 8:59 in New York
    assert len(service.requests) == 1
    tick(client, at(14))
    assert [message["notification"]["title"] for message in service.messages(new_york)] == [
        "Lucía turns 4"
    ]
    tick(client, at(22))
    assert len(service.requests) == 2
    assert [row.birthdays_notified_on for row in stored(client)] == [TODAY, TODAY]
    # The next day brings none.
    tick(client, at(8, day=19))
    assert len(service.requests) == 2
    assert stored(client)[0].birthdays_notified_on == dt.date(2026, 11, 19)


def test_each_birthday_opens_the_timeline_of_its_child(
    client: TestClient, service: PushService
) -> None:
    # Twins: one notification each, in the order of their timelines.
    ids = add_children(client, ("Lucía", "2025-11-18"), ("Leo", "2025-11-18"))
    browser = Browser()
    register(client, browser)
    tick(client, at(8, 30))

    lucia, leo = service.messages(browser)
    assert lucia == {
        "web_push": 8030,
        "notification": {
            "title": "Lucía cumple 1 año",
            "body": "Hoy es su cumpleaños.",
            "lang": "es-ES",
            "dir": "ltr",
            "navigate": "http://testserver/c/lucia",
            "tag": f"birthday-{ids['Lucía']}",
            "silent": False,
            "icon": "http://testserver/icon-192.png",
            "badge": "http://testserver/badge-96.png",
        },
    }
    assert (leo["notification"]["title"], leo["notification"]["navigate"]) == (
        "Leo cumple 1 año",
        "http://testserver/c/leo",
    )
    # Kept by the push service until midnight in Madrid at most (23:00 UTC); a newer one for the
    # same child replaces it there.
    assert [(request.headers["ttl"], request.headers["topic"]) for request in service.requests] == [
        ("52200", f"birthday-{ids['Lucía']}"),
        ("52200", f"birthday-{ids['Leo']}"),
    ]


def test_birthdays_come_every_month_of_the_first_year_then_every_year(client: TestClient) -> None:
    add_children(
        client,
        ("Ana", "2025-11-18"),
        ("Leo", "2026-04-18"),
        ("Mía", "2025-10-18"),
        ("Eva", "2026-11-18"),
        ("Noa", "2026-12-18"),
        ("Sol", None),
        ("Teo", "2024-02-29"),
        ("Iris", "2026-01-31"),
    )

    def on(day: dt.date) -> list[tuple[str, str, int, str]]:
        async def find(db: AsyncSession) -> list[tuple[str, str, int, str]]:
            return [
                (birthday.name, birthday.unit, birthday.count, birthday.path)
                for birthday in await push.birthdays_on(db, day)
            ]

        return run_db(client, find)

    # Not 13 months, nor the day they are born (or not yet), nor without a birth date.
    assert on(TODAY) == [("Ana", "years", 1, "/c/ana"), ("Leo", "months", 7, "/c/leo")]
    # Those born at the end of a month have theirs at the end of shorter months.
    assert on(dt.date(2026, 2, 28)) == [
        ("Teo", "years", 2, "/c/teo"),
        ("Iris", "months", 1, "/c/iris"),
    ]


@pytest.mark.parametrize(
    ("unit", "count", "locale", "title", "body"),
    [
        ("years", 4, "es", "Lucía cumple 4 años", "Hoy es su cumpleaños."),
        ("years", 1, "es", "Lucía cumple 1 año", "Hoy es su cumpleaños."),
        ("months", 7, "es", "Lucía cumple 7 meses", "Hoy hace 7 meses que nació."),
        ("months", 1, "es", "Lucía cumple 1 mes", "Hoy hace 1 mes que nació."),
        ("years", 4, "en", "Lucía turns 4", "Today is Lucía’s birthday."),
        ("months", 7, "en", "Lucía is 7 months old", "Lucía was born 7 months ago today."),
        ("months", 1, "en", "Lucía is 1 month old", "Lucía was born 1 month ago today."),
        ("years", 4, "pt", "Lucía faz 4 anos", "Hoje é o aniversário de Lucía."),
        ("years", 1, "pt", "Lucía faz 1 ano", "Hoje é o aniversário de Lucía."),
        ("months", 7, "pt", "Lucía faz 7 meses", "Faz hoje 7 meses que nasceu."),
        ("months", 1, "pt", "Lucía faz 1 mês", "Faz hoje 1 mês que nasceu."),
    ],
)
def test_birthdays_say_how_old_each_child_turns(
    unit: MemoryUnit, count: int, locale: Locale, title: str, body: str
) -> None:
    birthday = push.Birthday(child_id=3, name="Lucía", unit=unit, count=count, path="/c/lucia")
    notification = push.birthday_message(birthday, "https://x.example", locale)["notification"]
    assert (notification["title"], notification["body"]) == (title, body)


def test_birthdays_only_reach_active_people_who_want_them(
    client: TestClient, service: PushService
) -> None:
    add_children(client, ("Lucía", "2022-11-18"))
    unwanted = Browser("https://fcm.googleapis.com/fcm/send/unwanted")
    paused = Browser("https://fcm.googleapis.com/fcm/send/paused")
    wanted = Browser()
    login_as(client, "viewer")
    register(client, unwanted)
    assert client.patch(PREFERENCES, json={"birthdays": False}).status_code == 200
    login_as(client, "viewer", email="abuela@example.com")
    register(client, paused)
    # A new password elsewhere: paused until the device signs in again.
    set_user(client, "abuela@example.com", auth_version=2)
    login_as(client, "admin")
    register(client, wanted)

    tick(client, at(8))
    assert [str(request.url) for request in service.requests] == [wanted.endpoint]
    # Wanted again before the day is over: told.
    set_user(client, "viewer@example.com", notify_birthdays=True)
    tick(client, at(9))
    assert len(service.messages(unwanted)) == 1
    assert service.messages(paused) == []


def test_a_device_that_misses_a_birthday_is_told_them_all_again(
    client: TestClient, service: PushService, caplog: pytest.LogCaptureFixture
) -> None:
    ids = add_children(client, ("Lucía", "2025-11-18"), ("Leo", "2025-11-18"))
    browser = Browser()
    register(client, browser)
    service.broken.add(browser.endpoint)
    tick(client, at(8))
    assert "Birthday not sent to a device (RuntimeError)" in caplog.text
    service.broken.clear()
    # Lucía's arrives, but not Leo's (its push service fails for now).
    service.statuses = [201, 503]
    tick(client, at(8, 2))
    tick(client, at(8, 6))
    assert len(service.requests) == 4
    # Both again: Lucía's replaces the one already there (same tag).
    tick(client, at(8, 7))
    tags = [message["notification"]["tag"] for message in service.messages(browser)]
    assert tags == [f"birthday-{ids['Lucía']}", f"birthday-{ids['Leo']}"] * 3
    (row,) = stored(client)
    assert (row.birthdays_notified_on, row.failures) == (TODAY, 0)
    tick(client, at(8, 30))
    assert len(service.requests) == 6


def test_devices_forgotten_or_refusing_are_not_told_their_birthdays_again(
    client: TestClient, service: PushService
) -> None:
    add_children(client, ("Lucía", "2025-11-18"), ("Leo", "2025-11-18"))
    gone, refused = Browser(), Browser("https://fcm.googleapis.com/fcm/send/refused")
    register(client, gone)
    # Its push service forgot it: so does Timelife, without sending it the rest.
    service.status = 410
    tick(client, at(8))
    assert len(service.requests) == 1
    assert stored(client) == []

    register(client, refused)
    service.status = 403
    tick(client, at(9))
    # Refused: not sent again that day, and one more failure of the device.
    (row,) = stored(client)
    assert (row.birthdays_notified_on, row.failures) == (TODAY, 1)
    tick(client, at(9, 30))
    assert len(service.requests) == 3


# New milestones ------------------------------------------------------------------------------


def add_milestone(
    client: TestClient,
    children: list[int],
    title: str = "Primeros pasos",
    *,
    added: dt.datetime | None = None,
) -> dict[str, Any]:
    """A milestone added by whoever is signed in on ``client``: for its notifications, at
    ``added`` (default 2:00 UTC on 18 November, 3:00 in Madrid)."""
    category = next(iter(category_ids(client).values()))
    event = create_event(client, children, [category], title=title, date="2026-11-17")

    async def change(db: AsyncSession) -> None:
        await db.execute(
            update(MilestoneNotification)
            .where(MilestoneNotification.event_id == event["id"])
            .values(created_at=added or at(2))
        )
        await db.commit()

    run_db(client, change)
    return event


def queued(client: TestClient) -> list[tuple[int, int]]:
    """The (device, milestone) notifications still to be told."""

    async def load(db: AsyncSession) -> list[tuple[int, int]]:
        rows = await db.execute(
            select(MilestoneNotification.subscription_id, MilestoneNotification.event_id)
        )
        return sorted((device, event) for device, event in rows)

    return run_db(client, load)


def test_a_new_milestone_is_told_at_once_to_everybody_else(
    client: TestClient, service: PushService
) -> None:
    phone, laptop = Browser(), Browser("https://fcm.googleapis.com/fcm/send/laptop")
    login_as(client, "viewer")
    register(client, phone)
    login_as(client, "viewer")
    register(client, laptop, locale="en")
    login_as(client, "admin", name="Ana")
    own = Browser("https://fcm.googleapis.com/fcm/send/own")
    register(client, own)
    lucia, leo = add_child(client, "Lucía"), add_child(client, "Leo")
    event = add_milestone(client, [leo, lucia])["id"]
    assert len(queued(client)) == 2

    # 3:00 in Madrid: new milestones do not wait for the morning.
    tick(client, at(2))
    assert service.messages(own) == []
    (message,) = service.messages(phone)
    assert message == {
        "web_push": 8030,
        "notification": {
            # Its children in the order of their timelines; it opens over the first one's.
            "title": "Nuevo hito de Lucía y Leo",
            "body": "Ana ha añadido «Primeros pasos».",
            "lang": "es-ES",
            "dir": "ltr",
            "navigate": f"http://testserver/c/lucia/e/{event}?zoom=events&focus=e{event}",
            "tag": f"milestone-{event}",
            "silent": False,
            "icon": "http://testserver/icon-192.png",
            "badge": "http://testserver/badge-96.png",
        },
    }
    (english,) = service.messages(laptop)
    assert (english["notification"]["title"], english["notification"]["body"]) == (
        "New milestone for Lucía and Leo",
        "Ana added “Primeros pasos”.",
    )
    # Kept by the push service until a day after it was added; no topic (none replaces another).
    headers = service.requests[0].headers
    assert (headers["ttl"], headers["urgency"], "topic" in headers) == ("86400", "normal", False)
    assert queued(client) == []
    tick(client, at(2, 1))
    assert len(service.requests) == 2


def test_each_new_milestone_is_told_once_and_edits_are_not(
    client: TestClient, service: PushService
) -> None:
    browser = Browser()
    login_as(client, "viewer")
    register(client, browser)
    # An administrator without a name.
    login_as(client, "admin")
    lucia, ines = add_child(client, "Lucía"), add_child(client, "Inés")
    first = add_milestone(client, [lucia, ines])
    second = add_milestone(client, [lucia], "Primer diente")
    tick(client, at(2))
    assert [
        (message["notification"]["title"], message["notification"]["body"])
        for message in service.messages(browser)
    ] == [
        ("Nuevo hito de Lucía e Inés", "Se ha añadido «Primeros pasos»."),
        ("Nuevo hito de Lucía", "Se ha añadido «Primer diente»."),
    ]
    assert [message["notification"]["tag"] for message in service.messages(browser)] == [
        f"milestone-{first['id']}",
        f"milestone-{second['id']}",
    ]

    assert update_event(client, first, title="Primeros pasitos").status_code == 200
    tick(client, at(2, 1))
    assert len(service.requests) == 2
    assert queued(client) == []


def test_new_milestones_only_reach_those_who_want_them(
    client: TestClient, service: PushService
) -> None:
    browser = Browser()
    login_as(client, "viewer")
    register(client, browser)
    assert client.patch(PREFERENCES, json={"milestones": False}).status_code == 200
    login_as(client, "admin")
    child = add_child(client)
    add_milestone(client, [child])
    tick(client, at(2))
    assert service.requests == []
    assert queued(client) == []

    set_user(client, "viewer@example.com", notify_milestones=True)
    add_milestone(client, [child], "Primer diente", added=at(3))
    tick(client, at(3))
    assert len(service.messages(browser)) == 1


def test_nobody_is_told_about_their_own_milestones(
    client: TestClient, service: PushService
) -> None:
    tablet = Browser()
    login_as(client, "viewer")
    register(client, tablet)
    login_as(client, "admin")
    add_milestone(client, [add_child(client)])
    # Before the round, the administrator signs in on Vera's tablet: it is theirs now.
    register(client, tablet)
    tick(client, at(2))
    assert service.requests == []
    assert queued(client) == []


def test_milestones_are_told_to_active_devices_only_while_out_of_the_trash(
    client: TestClient, service: PushService
) -> None:
    paused = Browser()
    login_as(client, "viewer")
    register(client, paused)
    login_as(client, "admin")
    child = add_child(client)
    set_user(client, "viewer@example.com", disabled=True)
    add_milestone(client, [child])
    tick(client, at(2))
    set_user(client, "viewer@example.com", disabled=False)
    tick(client, at(2, 1))
    assert service.requests == []

    # Moved to the trash before the round.
    event = add_milestone(client, [child], "Borrado", added=at(3))
    assert client.delete(f"/api/admin/events/{event['id']}").status_code == 204
    tick(client, at(3))
    assert service.requests == []
    assert queued(client) == []

    # A device that turns them on later is not told about earlier milestones.
    add_milestone(client, [child], "Primer diente", added=at(4))
    login_as(client, "viewer")
    register(client, Browser("https://fcm.googleapis.com/fcm/send/later"))
    tick(client, at(4))
    assert [message["notification"]["body"] for message in service.messages(paused)] == [
        "Se ha añadido «Primer diente»."
    ]
    assert len(service.requests) == 1


def test_a_new_milestone_is_tried_again_for_a_day(client: TestClient, service: PushService) -> None:
    browser = Browser()
    login_as(client, "viewer")
    register(client, browser)
    login_as(client, "admin")
    child = add_child(client)
    add_milestone(client, [child])
    service.status = None
    tick(client, at(2))
    tick(client, at(2, 1))
    assert len(service.requests) == 1
    service.status = 201
    tick(client, at(2, 2))
    assert len(service.messages(browser)) == 2
    # Two minutes later, two minutes less to keep it.
    assert service.requests[1].headers["ttl"] == "86280"
    assert queued(client) == []

    # Unreachable for a day: given up.
    add_milestone(client, [child], "Primer diente", added=at(3))
    service.status = 503
    tick(client, at(3))
    tick(client, at(3, day=19))
    assert len(service.requests) == 3
    assert queued(client) == []
    assert stored(client)[0].failures == 0


def test_devices_that_refuse_new_milestones_are_forgotten(
    client: TestClient, service: PushService
) -> None:
    gone, refused = Browser(), Browser("https://fcm.googleapis.com/fcm/send/refused")
    login_as(client, "viewer")
    register(client, gone)
    login_as(client, "admin")
    child = add_child(client)
    for title in ("Uno", "Dos"):
        add_milestone(client, [child], title)
    # Its push service forgot it: so does Timelife, with what was queued for it.
    service.status = 410
    tick(client, at(2))
    assert len(service.requests) == 1
    assert stored(client) == []
    assert queued(client) == []

    login_as(client, "viewer")
    register(client, refused)
    login_as(client, "admin")
    for title in ("Tres", "Cuatro", "Cinco"):
        add_milestone(client, [child], title, added=at(3))
    service.status = 403
    tick(client, at(3))
    # Three refused in a row.
    assert len(service.requests) == 4
    assert stored(client) == []
    assert queued(client) == []


@pytest.mark.parametrize(
    ("names", "locale", "text"),
    [
        (["Lucía"], "es", "Lucía"),
        (["Lucía", "Leo", "Emma"], "es", "Lucía, Leo y Emma"),
        (["Lucía", "Leo", "Emma"], "en", "Lucía, Leo and Emma"),
        (["Lucía", "Leo", "Emma"], "pt", "Lucía, Leo e Emma"),
        # In Spanish «e» before the sound /i/, accents aside, but not before «hie»/«hia».
        (["Lucía", "Inés"], "es", "Lucía e Inés"),
        (["Leo", "Hilda"], "es", "Leo e Hilda"),
        (["Leo", "Íñigo"], "es", "Leo e Íñigo"),
        (["Leo", "Hiedra"], "es", "Leo y Hiedra"),
        (["Leo", "Hugo"], "es", "Leo y Hugo"),
        (["Leo", "Inés"], "pt", "Leo e Inés"),
        (["Leo", "Inés"], "en", "Leo and Inés"),
    ],
)
def test_the_children_of_a_milestone_are_listed_as_people_write_them(
    names: list[str], locale: Locale, text: str
) -> None:
    assert push.listed(names, locale) == text


def test_milestone_titles_fit_a_notification() -> None:
    milestone = push.Milestone(
        event_id=7, title="Mudanza", author=None, children=(), path="/all/e/7"
    )
    notification = push.milestone_message(milestone, "https://x.example", "pt")["notification"]
    assert (notification["title"], notification["body"]) == (
        "Novo marco",
        "Foi adicionado «Mudanza».",
    )

    crowded = push.Milestone(
        event_id=7,
        title="Mudanza",
        author="Ana",
        children=("Maximiliano Alejandro",) * 20,
        path="/all/e/7",
    )
    title = push.milestone_message(crowded, "https://x.example", "es")["notification"]["title"]
    assert len(title) == push.MAX_TITLE
    assert title.startswith("Nuevo hito de Maximiliano Alejandro, ") and title.endswith("…")
