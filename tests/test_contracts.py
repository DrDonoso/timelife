import datetime as dt
import uuid

import pytest
from pydantic import ValidationError

from timelife.contracts import (
    CategoryIn,
    ChildColorIn,
    ChildIn,
    DevLoginIn,
    EventIn,
    EventUpdateIn,
    GoogleStartIn,
    OrderIn,
    PasswordForgotIn,
    SettingsIn,
    UserCreateIn,
    UserOut,
    UserUpdateIn,
    YearColorIn,
)


def event(**values: object) -> EventIn:
    base: dict[str, object] = {
        "title": "Primer diente",
        "date": "2026-03-12",
        "child_ids": [1],
        "category_ids": [3, 1],
    }
    base.update(values)
    return EventIn.model_validate(base)


def error_types(error: pytest.ExceptionInfo[ValidationError]) -> dict[str, str]:
    return {str(item["loc"][0]): item["type"] for item in error.value.errors()}


def test_event_input_is_normalised() -> None:
    parsed = event(title="  Primer \n diente ", location="  ", notes="línea 1\r\nlínea 2  ")
    assert parsed.title == "Primer diente"
    assert parsed.location is None
    assert parsed.notes == "línea 1\nlínea 2"
    assert parsed.category_ids == [3, 1]
    assert parsed.images == []
    assert parsed.cover_image_id is None
    assert parsed.date == dt.date(2026, 3, 12)


@pytest.mark.parametrize(
    ("values", "field"),
    [
        ({"title": " "}, "title"),
        ({"title": "x" * 121}, "title"),
        ({"title": "a\x00b"}, "title"),
        ({"notes": "x" * 5001}, "notes"),
        ({"location": "x" * 201}, "location"),
        ({"child_ids": []}, "child_ids"),
        ({"child_ids": [1, 1]}, "child_ids"),
        ({"category_ids": list(range(1, 22))}, "category_ids"),
        ({"category_ids": [0]}, "category_ids"),
        ({"images": [{"id": str(uuid.UUID(int=1)), "name": "a"}] * 2}, "images"),
        ({"images": [{"id": str(uuid.UUID(int=1)), "name": ""}]}, "images"),
        ({"unknown": 1}, "unknown"),
        ({"date": "12/03/2026"}, "date"),
    ],
)
def test_event_input_validation(values: dict[str, object], field: str) -> None:
    with pytest.raises(ValidationError) as error:
        event(**values)
    assert field in error_types(error)


def test_event_update_requires_version() -> None:
    data = event().model_dump(mode="json")
    with pytest.raises(ValidationError):
        EventUpdateIn.model_validate(data)
    assert EventUpdateIn.model_validate({**data, "version": 2}).version == 2


def test_colors_icons_and_child_inputs() -> None:
    category = CategoryIn(
        name_es="Sueño", name_en="Sleep", name_pt=" Sono ", icon="moon", color="#8B5CF6"
    )
    assert (category.name_pt, category.color) == ("Sono", "#8b5cf6")
    assert YearColorIn(color="#ABCDEF").color == "#abcdef"
    assert ChildColorIn(color="#ABCDEF").color == "#abcdef"
    for color in ("8b5cf6", "#8b5cf", "#8b5cf6f", "red"):
        with pytest.raises(ValidationError):
            YearColorIn(color=color)
        with pytest.raises(ValidationError):
            ChildColorIn(color=color)
    with pytest.raises(ValidationError):
        CategoryIn(name_es="a", name_en="b", name_pt="c", icon="Moon", color="#000000")
    with pytest.raises(ValidationError) as error:
        CategoryIn.model_validate(
            {"name_es": "Sueño", "name_en": "Sleep", "icon": "moon", "color": "#8b5cf6"}
        )
    assert error_types(error) == {"name_pt": "missing"}
    # Slugs are made from the name and never change: no input sets them.
    assert ChildIn(name=" Lucía ").model_dump() == {
        "name": "Lucía",
        "birth_date": None,
        "avatar_image_id": None,
    }
    for extra in ({"slug": "lucia"}, {"slug": ""}, {"color": "#8b5cf6"}):
        with pytest.raises(ValidationError) as error:
            ChildIn.model_validate({"name": "Lucía", **extra})
        assert error_types(error) == {next(iter(extra)): "extra_forbidden"}


def test_password_e_mails_come_in_three_languages() -> None:
    assert PasswordForgotIn(email="ana@example.com").locale == "es"
    for locale in ("es", "en", "pt"):
        assert PasswordForgotIn(email="ana@example.com", locale=locale).locale == locale
    for locale in ("fr", "pt-BR", "PT", ""):
        with pytest.raises(ValidationError) as error:
            PasswordForgotIn.model_validate({"email": "ana@example.com", "locale": locale})
        assert error_types(error) == {"locale": "literal_error"}


def test_user_inputs() -> None:
    created = UserCreateIn(email=" Ana@Example.COM ")
    assert (created.email, created.role, created.name) == ("ana@example.com", "viewer", None)
    with pytest.raises(ValidationError):
        UserCreateIn(email="not-an-email")
    with pytest.raises(ValidationError):
        UserCreateIn(email="ana@example.com", role="owner")
    update = UserUpdateIn.model_validate({"name": ""})
    assert update.name is None
    assert update.model_fields_set == {"name"}
    assert UserUpdateIn.model_validate({}).model_fields_set == set()


def test_auth_inputs() -> None:
    assert GoogleStartIn().return_path == "/"
    assert GoogleStartIn(return_path="/c/lucia?q=diente").return_path == "/c/lucia?q=diente"
    for path in ("//evil.example", "/\\evil.example", "https://evil.example", "/" + "x" * 512):
        with pytest.raises(ValidationError):
            GoogleStartIn(return_path=path)
    assert DevLoginIn(username="admin", password=" spaced ").password == " spaced "
    for values in ({"username": "root", "password": "x"}, {"username": "admin", "password": ""}):
        with pytest.raises(ValidationError):
            DevLoginIn.model_validate(values)


def test_settings_and_order_inputs() -> None:
    parsed = SettingsIn(
        background_image_id=None,
        background_opacity=0.18,
        default_zoom="events",
        direction_desktop="right_to_left",
        direction_mobile="bottom_to_top",
    )
    assert parsed.background_opacity == 0.18
    assert (parsed.direction_desktop, parsed.direction_mobile) == ("right_to_left", "bottom_to_top")
    for opacity in (-0.1, 1.1, float("nan")):
        with pytest.raises(ValidationError):
            SettingsIn(
                background_image_id=None,
                background_opacity=opacity,
                default_zoom="events",
                direction_desktop="right_to_left",
                direction_mobile="bottom_to_top",
            )
    with pytest.raises(ValidationError):
        SettingsIn.model_validate({"background_opacity": 0.5, "default_zoom": "events"})
    with pytest.raises(ValidationError):
        SettingsIn.model_validate(
            {"background_image_id": None, "background_opacity": 0.5, "default_zoom": "events"}
        )
    assert OrderIn(ids=[3, 1, 2]).ids == [3, 1, 2]


def test_datetimes_are_serialised_as_utc() -> None:
    user = UserOut(
        id=1,
        email="ana@example.com",
        name=None,
        role="admin",
        disabled=False,
        google_linked=True,
        has_password=True,
        must_change_password=False,
        created_at=dt.datetime(2026, 3, 12, 10, 30),
        last_login_at=dt.datetime(2026, 3, 12, 12, 0, tzinfo=dt.timezone(dt.timedelta(hours=2))),
    )
    data = user.model_dump(mode="json")
    assert data["created_at"] == "2026-03-12T10:30:00Z"
    assert data["last_login_at"] == "2026-03-12T10:00:00Z"
