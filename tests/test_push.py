"""Push notifications: devices register for them (only their own person's, only the push services
of the major browsers), signing out stops them, and each device is told about its day's memories
once, from 9:00 of its own time zone, unless its person already saw them or was told."""

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
from timelife.db import PushSubscription, User

from .conftest import app_client, login_as, run_db
from .helpers_events import add_child, category_ids, create_event
from .helpers_push import Browser, PushService

SUBSCRIPTION = "/api/push/subscription"
TODAY = dt.date(2026, 11, 18)


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
    for path in ("/api/push/unsubscribe", "/api/push/test"):
        assert client.post(path, json={"endpoint": browser.endpoint}).status_code == 401


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
    # Today's memories are still to be told to the new person.
    assert row.memories_notified_on is None

    # Nobody else can stop it or test it.
    login_as(client, "viewer")
    assert client.post("/api/push/unsubscribe", json={"endpoint": browser.endpoint}).status_code == 204
    assert len(stored(client)) == 1
    response = client.post("/api/push/test", json={"endpoint": browser.endpoint})
    assert response.status_code == 404
    assert response.json() == {"code": "push_subscription_not_found"}
    login_as(client, "admin")
    assert client.post("/api/push/unsubscribe", json={"endpoint": browser.endpoint}).status_code == 204
    assert stored(client) == []


def mark_notified(day: dt.date) -> Any:
    async def change(db: AsyncSession) -> None:
        await db.execute(update(PushSubscription).values(memories_notified_on=day))
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


def test_a_test_notification(viewer: TestClient, service: PushService) -> None:
    browser = Browser()
    register(viewer, browser, locale="en")
    assert viewer.post("/api/push/test", json={"endpoint": browser.endpoint}).status_code == 204
    (message,) = service.messages(browser)
    assert message == {
        "web_push": 8030,
        "notification": {
            "title": "Timelife",
            "body": "All set! This is how we’ll tell you about the days with memories.",
            "lang": "en-GB",
            "dir": "ltr",
            "navigate": "http://testserver/",
            "tag": "test",
            "silent": False,
            "icon": "http://testserver/icon-192.png",
            "badge": "http://testserver/badge-96.png",
        },
    }
    assert service.requests[0].headers["urgency"] == "high"

    service.status = 503
    response = viewer.post("/api/push/test", json={"endpoint": browser.endpoint})
    assert (response.status_code, response.json()) == (502, {"code": "push_failed"})
    # Its push service forgot it: so does Timelife (the app registers it again).
    service.status = 410
    response = viewer.post("/api/push/test", json={"endpoint": browser.endpoint})
    assert (response.status_code, response.json()) == (404, {"code": "push_subscription_not_found"})
    assert stored(viewer) == []


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
