"""Thumbnail framing of event images: the framing math, saving it with the event and the framed
thumbnails served (rendered on first request, versioned URLs, removed once replaced)."""

import io
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image as Pillow

from timelife import crops

from .conftest import login_as
from .helpers_events import (
    add_child,
    category_ids,
    create_event,
    folder,
    listed,
    timeline,
    update_event,
)
from .helpers_media import uploaded

RED = (220, 30, 30)
BLUE = (30, 60, 220)


# Math ------------------------------------------------------------------------------------------


def test_the_centred_square_is_no_framing() -> None:
    assert crops.normalize(0.5, 0.5, 1, 1600, 1200) is None
    assert crops.normalize(0.50001, 0.49999, 1.00001, 1600, 1200) is None
    # A square picture has nowhere to move at zoom 1.
    assert crops.normalize(0.1, 0.9, 1, 800, 800) is None


def test_framings_stay_inside_the_picture() -> None:
    # Landscape 1600 × 1200 at zoom 1: the square is 1200 wide, so x ∈ [0.375, 0.625], y = 0.5.
    assert crops.normalize(0.0, 0.0, 1, 1600, 1200) == (0.375, 0.5, 1)
    assert crops.normalize(1.0, 1.0, 1, 1600, 1200) == (0.625, 0.5, 1)
    # Portrait at zoom 2: a 300 px square of 600 × 1200.
    assert crops.normalize(0.0, 1.0, 2, 600, 1200) == (0.25, 0.875, 2)
    # Zoom is kept between 1 and MAX_ZOOM, values rounded.
    assert crops.normalize(0.3, 0.4, 9, 1000, 1000) == (0.3, 0.4, crops.MAX_ZOOM)
    assert crops.normalize(0.345678, 0.5, 2, 1000, 1000) == (0.3457, 0.5, 2)


def test_the_box_of_a_framing() -> None:
    assert crops.box((0.5, 0.5, 1), 1600, 1200) == (200, 0, 1400, 1200)
    assert crops.box((0.25, 0.75, 2), 1000, 1000) == (0, 500, 500, 1000)
    # Out-of-range centres are clamped to the picture.
    assert crops.box((0.0, 0.5, 2), 1000, 1000) == (0, 250, 500, 750)


def test_keys_and_urls_change_with_the_framing() -> None:
    first, second = (0.25, 0.5, 2.0), (0.25, 0.5, 2.5)
    assert crops.key(first) == crops.key((0.25, 0.5, 2))
    assert crops.key(first) != crops.key(second)
    assert len(crops.key(first)) == 12
    image_id = uuid.UUID("9b2a3c4d-0000-4000-8000-000000000000")
    assert crops.thumb_url(image_id, None) == f"/api/media/{image_id}/thumb"
    assert crops.thumb_url(image_id, first) == f"/api/media/{image_id}/thumb?v={crops.key(first)}"


# Saving and serving ------------------------------------------------------------------------------


@pytest.fixture
def family(admin: TestClient) -> dict[str, int]:
    return {"lucia": add_child(admin, "Lucía")} | category_ids(admin)


def two_tone(size: tuple[int, int] = (200, 100)) -> bytes:
    """A PNG whose left half is red and right half blue."""
    picture = Pillow.new("RGB", size, BLUE)
    picture.paste(RED, (0, 0, size[0] // 2, size[1]))
    buffer = io.BytesIO()
    picture.save(buffer, "PNG")
    return buffer.getvalue()


def pixel(content: bytes, x: float, y: float) -> tuple[int, ...]:
    """Colour at a relative position of an encoded picture."""
    with Pillow.open(io.BytesIO(content)) as picture:
        rgb = picture.convert("RGB")
        value = rgb.getpixel((int(x * (rgb.width - 1)), int(y * (rgb.height - 1))))
    assert isinstance(value, tuple)
    return value


def near(actual: tuple[int, ...], expected: tuple[int, ...], tolerance: int = 24) -> bool:
    return all(abs(a - b) <= tolerance for a, b in zip(actual, expected, strict=True))


def framed_event(
    admin: TestClient, family: dict[str, int], crop: dict[str, Any] | None
) -> dict[str, Any]:
    image = uploaded(admin, data=two_tone(), filename="dos-tonos.png", content_type="image/png")
    item: dict[str, Any] = {"id": image["id"], "name": "Dos tonos"}
    if crop is not None:
        item["crop"] = crop
    return create_event(admin, [family["lucia"]], [family["general"]], images=[item])


def test_a_framing_is_saved_normalized_with_a_versioned_thumbnail_url(
    admin: TestClient, family: dict[str, int]
) -> None:
    event = framed_event(admin, family, {"x": 0.0, "y": 0.9, "zoom": 2})
    image = event["images"][0]
    # 200 × 100 at zoom 2: a 50 px square, so x ≥ 0.125 and y ≤ 0.75.
    assert image["crop"] == {"x": 0.125, "y": 0.75, "zoom": 2.0}
    key = crops.key((0.125, 0.75, 2.0))
    assert image["thumb_url"] == f"/api/media/{image['id']}/thumb?v={key}"
    # Every view of the event shows the framed thumbnail.
    assert listed(admin)["items"][0]["cover"] == image
    assert timeline(admin, family["lucia"])["events"][0]["cover"]["thumb_url"] == image["thumb_url"]


def test_the_centred_square_needs_no_framing(admin: TestClient, family: dict[str, int]) -> None:
    for crop in (None, {"x": 0.5, "y": 0.5, "zoom": 1}):
        image = framed_event(admin, family, crop)["images"][0]
        assert image["crop"] is None
        assert image["thumb_url"] == f"/api/media/{image['id']}/thumb"


def test_framed_thumbnails_are_rendered_on_first_request(
    admin: TestClient, family: dict[str, int]
) -> None:
    event = framed_event(admin, family, {"x": 0.25, "y": 0.5, "zoom": 2})
    image = event["images"][0]
    key = crops.key((0.25, 0.5, 2.0))
    framed = folder(admin, image["id"]) / f"thumb-{key}.webp"
    assert not framed.exists()

    response = admin.get(image["thumb_url"])
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/webp"
    assert response.headers["cache-control"] == "private, max-age=31536000, immutable"
    with Pillow.open(io.BytesIO(response.content)) as picture:
        assert picture.size == (512, 512)
    # The left quarter of the picture: red from edge to edge.
    assert all(near(pixel(response.content, x, 0.5), RED) for x in (0.05, 0.5, 0.95))
    assert framed.exists()
    modified = framed.stat().st_mtime_ns
    assert admin.get(image["thumb_url"]).content == response.content
    assert framed.stat().st_mtime_ns == modified
    etag = response.headers["etag"]
    assert admin.get(image["thumb_url"], headers={"if-none-match": etag}).status_code == 304

    # The plain thumbnail is still the centred square (red on the left, blue on the right).
    plain = admin.get(f"/api/media/{image['id']}/thumb")
    assert near(pixel(plain.content, 0.1, 0.5), RED) and near(pixel(plain.content, 0.9, 0.5), BLUE)

    # Viewers get it too.
    login_as(admin, "viewer")
    assert admin.get(image["thumb_url"]).status_code == 200


def test_replaced_framings_are_removed(admin: TestClient, family: dict[str, int]) -> None:
    event = framed_event(admin, family, {"x": 0.25, "y": 0.5, "zoom": 2})
    first = event["images"][0]
    assert admin.get(first["thumb_url"]).status_code == 200

    items = [{"id": first["id"], "name": first["name"], "crop": {"x": 0.75, "y": 0.5, "zoom": 2}}]
    response = update_event(admin, event, images=items)
    assert response.status_code == 200, response.text
    second = response.json()["images"][0]
    assert second["thumb_url"] != first["thumb_url"]
    assert admin.get(first["thumb_url"]).status_code == 404
    moved = admin.get(second["thumb_url"])
    assert moved.status_code == 200
    assert near(pixel(moved.content, 0.5, 0.5), BLUE)
    assert [path.name for path in folder(admin, first["id"]).glob("thumb-*.webp")] == [
        f"thumb-{second['thumb_url'].rsplit('=', 1)[1]}.webp"
    ]

    # Back to the centred square: no framed thumbnail is left.
    response = update_event(
        admin, response.json(), images=[{"id": first["id"], "name": first["name"]}]
    )
    assert response.json()["images"][0]["thumb_url"] == f"/api/media/{first['id']}/thumb"
    assert list(folder(admin, first["id"]).glob("thumb-*.webp")) == []
    assert admin.get(second["thumb_url"]).status_code == 404


def test_only_current_framings_are_rendered(admin: TestClient, family: dict[str, int]) -> None:
    image = framed_event(admin, family, None)["images"][0]
    other = crops.key((0.25, 0.5, 2.0))
    base = f"/api/media/{image['id']}"
    assert admin.get(f"{base}/thumb", params={"v": other}).status_code == 404
    assert admin.get(f"{base}/display", params={"v": other}).status_code == 404
    response = admin.get(f"{base}/thumb", params={"v": "../display"})
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {"v": "string_pattern_mismatch"}}
    assert list(folder(admin, image["id"]).glob("thumb-*.webp")) == []


@pytest.mark.parametrize(
    ("crop", "field", "error"),
    [
        ({"x": 1.5, "y": 0.5, "zoom": 1}, "x", "less_than_equal"),
        ({"x": 0.5, "y": -0.1, "zoom": 1}, "y", "greater_than_equal"),
        ({"x": 0.5, "y": 0.5, "zoom": 0.5}, "zoom", "greater_than_equal"),
        ({"x": 0.5, "y": 0.5, "zoom": 5}, "zoom", "less_than_equal"),
        ({"x": 0.5, "y": 0.5}, "zoom", "missing"),
        ({"x": 0.5, "y": 0.5, "zoom": 1, "angle": 90}, "angle", "extra_forbidden"),
        ({"x": "left", "y": 0.5, "zoom": 1}, "x", "float_parsing"),
    ],
)
def test_framings_are_validated(
    admin: TestClient, family: dict[str, int], crop: dict[str, Any], field: str, error: str
) -> None:
    image = uploaded(admin)
    response = admin.post(
        "/api/admin/events",
        json={
            "title": "Hito",
            "date": "2025-01-01",
            "child_ids": [family["lucia"]],
            "category_ids": [family["general"]],
            "images": [{"id": image["id"], "name": "Foto", "crop": crop}],
        },
    )
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "fields": {field: error}}
