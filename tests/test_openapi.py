"""The OpenAPI document is the frontend's contract (spec 20-api): paths, status codes, schemas."""

from typing import Any

import pytest

from timelife.app import create_app

SCHEMA_NAMES = {
    "HealthOut", "VersionOut", "AuthConfigOut", "SessionUserOut", "SessionOut", "GoogleStartIn",
    "GoogleStartOut", "DevLoginIn", "PasswordLoginIn", "PasswordChangeIn", "PasswordForgotIn",
    "PasswordResetIn", "SetupIn", "UserOut", "UserCreateIn", "UserUpdateIn", "UserPasswordIn",
    "ImageOut", "UploadOut", "ChildOut", "ChildIn", "ChildColorIn", "OrderIn", "CategoryOut",
    "CategoryIn", "EventImageIn", "EventIn", "EventUpdateIn", "EventOut", "EventSummaryOut",
    "EventPageOut", "DayOrderIn", "TrashItemOut", "TimelineCoverOut", "TimelineEventOut",
    "TimelineOut", "YearColorOut", "AppearanceOut", "YearColorIn", "SettingsIn", "ImageCrop",
    "LocationOut",
}

# (method, path) → (success status, request schema, response schema); "[X]" means a list of X.
ENDPOINTS: dict[tuple[str, str], tuple[str, str | None, str | None]] = {
    ("get", "/health"): ("200", None, "HealthOut"),
    ("get", "/api/version"): ("200", None, "VersionOut"),
    ("get", "/api/auth/config"): ("200", None, "AuthConfigOut"),
    ("get", "/api/auth/session"): ("200", None, "SessionOut"),
    ("post", "/api/auth/google/start"): ("200", "GoogleStartIn", "GoogleStartOut"),
    ("post", "/api/auth/logout"): ("204", None, None),
    ("post", "/api/auth/dev-login"): ("200", "DevLoginIn", "SessionOut"),
    ("post", "/api/auth/login"): ("200", "PasswordLoginIn", "SessionOut"),
    ("post", "/api/auth/password"): ("200", "PasswordChangeIn", "SessionOut"),
    ("post", "/api/auth/password/forgot"): ("204", "PasswordForgotIn", None),
    ("post", "/api/auth/password/reset"): ("200", "PasswordResetIn", "SessionOut"),
    ("post", "/api/auth/setup"): ("200", "SetupIn", "SessionOut"),
    ("get", "/api/admin/users"): ("200", None, "[UserOut]"),
    ("post", "/api/admin/users"): ("201", "UserCreateIn", "UserOut"),
    ("patch", "/api/admin/users/{user_id}"): ("200", "UserUpdateIn", "UserOut"),
    ("put", "/api/admin/users/{user_id}/password"): ("200", "UserPasswordIn", "UserOut"),
    ("delete", "/api/admin/users/{user_id}"): ("204", None, None),
    ("get", "/api/children"): ("200", None, "[ChildOut]"),
    ("post", "/api/admin/children"): ("201", "ChildIn", "ChildOut"),
    ("put", "/api/admin/children/order"): ("200", "OrderIn", "[ChildOut]"),
    ("put", "/api/admin/children/{child_id}"): ("200", "ChildIn", "ChildOut"),
    ("delete", "/api/admin/children/{child_id}"): ("204", None, None),
    ("put", "/api/admin/children/{child_id}/color"): ("200", "ChildColorIn", "ChildOut"),
    ("delete", "/api/admin/children/{child_id}/color"): ("200", None, "ChildOut"),
    ("get", "/api/categories"): ("200", None, "[CategoryOut]"),
    ("post", "/api/admin/categories"): ("201", "CategoryIn", "CategoryOut"),
    ("put", "/api/admin/categories/order"): ("200", "OrderIn", "[CategoryOut]"),
    ("put", "/api/admin/categories/{category_id}"): ("200", "CategoryIn", "CategoryOut"),
    ("delete", "/api/admin/categories/{category_id}"): ("204", None, None),
    ("post", "/api/admin/uploads"): ("201", None, "UploadOut"),
    ("get", "/api/admin/uploads/{image_id}"): ("200", None, "UploadOut"),
    ("get", "/api/media/{image_id}/{variant}"): ("200", None, None),
    ("get", "/api/admin/events"): ("200", None, "EventPageOut"),
    ("post", "/api/admin/events"): ("201", "EventIn", "EventOut"),
    ("put", "/api/admin/events/day-order"): ("200", "DayOrderIn", "[EventSummaryOut]"),
    ("get", "/api/admin/events/{event_id}"): ("200", None, "EventOut"),
    ("put", "/api/admin/events/{event_id}"): ("200", "EventUpdateIn", "EventOut"),
    ("delete", "/api/admin/events/{event_id}"): ("204", None, None),
    ("get", "/api/admin/locations"): ("200", None, "[LocationOut]"),
    ("get", "/api/admin/trash"): ("200", None, "[TrashItemOut]"),
    ("post", "/api/admin/trash/{event_id}/restore"): ("200", None, "EventOut"),
    ("delete", "/api/admin/trash/{event_id}"): ("204", None, None),
    ("get", "/api/events/{event_id}"): ("200", None, "EventOut"),
    ("get", "/api/children/{child_id}/timeline"): ("200", None, "TimelineOut"),
    ("get", "/api/timeline"): ("200", None, "TimelineOut"),
    ("get", "/api/appearance"): ("200", None, "AppearanceOut"),
    ("put", "/api/admin/year-colors/{year}"): ("200", "YearColorIn", "AppearanceOut"),
    ("delete", "/api/admin/year-colors/{year}"): ("200", None, "AppearanceOut"),
    ("put", "/api/admin/settings"): ("200", "SettingsIn", "AppearanceOut"),
}


@pytest.fixture(scope="module")
def spec() -> dict[str, Any]:
    return create_app().openapi()


def schema_name(schema: dict[str, Any] | None) -> str | None:
    if schema is None:
        return None
    if "$ref" in schema:
        return str(schema["$ref"]).rsplit("/", 1)[1]
    if schema.get("type") == "array":
        return f"[{schema_name(schema['items'])}]"
    raise AssertionError(f"Unexpected schema {schema}")


def json_schema(content: dict[str, Any] | None) -> dict[str, Any] | None:
    if not content or "application/json" not in content:
        return None
    return content["application/json"].get("schema")


def test_every_schema_is_published_with_its_exact_name(spec: dict[str, Any]) -> None:
    names = set(spec["components"]["schemas"])
    assert SCHEMA_NAMES <= names
    assert not [name for name in names if name.endswith(("-Input", "-Output"))]


@pytest.mark.parametrize(("method", "path"), list(ENDPOINTS))
def test_endpoint_contract(spec: dict[str, Any], method: str, path: str) -> None:
    status, request, response = ENDPOINTS[(method, path)]
    operation = spec["paths"][path][method]
    assert status in operation["responses"]
    assert schema_name(json_schema(operation.get("requestBody", {}).get("content"))) == request
    assert schema_name(json_schema(operation["responses"][status].get("content"))) == response


def test_google_callback_is_not_part_of_the_schema(spec: dict[str, Any]) -> None:
    assert "/api/auth/google/callback" not in spec["paths"]


def parameters(spec: dict[str, Any], method: str, path: str) -> dict[str, dict[str, Any]]:
    return {item["name"]: item for item in spec["paths"][path][method].get("parameters", [])}


def test_query_parameters(spec: dict[str, Any]) -> None:
    timeline = parameters(spec, "get", "/api/children/{child_id}/timeline")
    assert set(timeline) == {"child_id", "q", "date_from", "date_to", "category_id"}
    category_types = [item.get("type") for item in timeline["category_id"]["schema"]["anyOf"]]
    assert "array" in category_types

    events = parameters(spec, "get", "/api/admin/events")
    assert set(events) == {
        "q", "child_id", "category_id", "date_from", "date_to", "page", "page_size",
    }
    assert events["page"]["schema"]["default"] == 1
    assert events["page_size"]["schema"]["default"] == 50
    assert events["page_size"]["schema"]["maximum"] == 100

    upload = spec["paths"]["/api/admin/uploads"]["post"]
    assert parameters(spec, "post", "/api/admin/uploads")["purpose"]["required"] is True
    assert "multipart/form-data" in upload["requestBody"]["content"]
    form = upload["requestBody"]["content"]["multipart/form-data"]["schema"]["$ref"]
    body = spec["components"]["schemas"][form.rsplit("/", 1)[1]]
    assert (set(body["properties"]), body["required"]) == ({"file", "motion"}, ["file"])
    media = spec["paths"]["/api/media/{image_id}/{variant}"]["get"]
    assert {"image/webp", "video/mp4"} <= set(media["responses"]["200"]["content"])
    variant = parameters(spec, "get", "/api/media/{image_id}/{variant}")["variant"]
    assert variant["schema"]["enum"] == ["thumb", "display", "video"]


def test_response_fields_are_always_present(spec: dict[str, Any]) -> None:
    schemas = spec["components"]["schemas"]
    for name in sorted(SCHEMA_NAMES):
        if name.endswith("Out"):
            schema = schemas[name]
            assert set(schema.get("required", [])) == set(schema["properties"]), name
