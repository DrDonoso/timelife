"""Every request/response schema of the API. Class names are the OpenAPI component names used by
the frontend (``frontend/src/api/schema.gen.ts``), so keep them stable."""

import datetime as dt
import unicodedata
import uuid
from collections.abc import Hashable
from typing import Annotated, Literal, TypeVar

from fastapi import Path, Query
from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
)

from . import passwords

ID_MAX = 2_147_483_647
SLUG_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"
HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"
ICON_PATTERN = r"^[a-z0-9-]{1,64}$"

Role = Literal["admin", "viewer"]
Zoom = Literal["years", "months", "events"]
# How time runs along the timeline, oldest → newest (the newest milestone at the arrow's head).
Direction = Literal["left_to_right", "right_to_left", "top_to_bottom", "bottom_to_top"]
ImagePurpose = Literal["event", "avatar", "background"]
ImageVariant = Literal["thumb", "display"]
MediaKind = Literal["image", "video"]
VideoStatus = Literal["processing", "ready", "failed"]

T = TypeVar("T", bound=Hashable)


def _lower(value: str) -> str:
    return value.lower()


def _single_line(value: str) -> str:
    """Collapse whitespace runs (newlines included) and reject other control characters."""
    value = " ".join(value.split())
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise ValueError("Control characters are not allowed")
    return value


def _multiline(value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    if any(
        unicodedata.category(character) == "Cc" and character not in "\n\t" for character in value
    ):
        raise ValueError("Control characters are not allowed")
    return value


def _blank_to_none(value: object) -> object:
    if isinstance(value, str) and not value.strip():
        return None
    return value


def _unique(values: list[T]) -> list[T]:
    if len(set(values)) != len(values):
        raise ValueError("Items must be unique")
    return values


def _local_path(value: str) -> str:
    if (
        not value.startswith("/")
        or value.startswith("//")
        or "\\" in value
        or any(unicodedata.category(character) == "Cc" for character in value)
    ):
        raise ValueError("Expected a local absolute path")
    return value


def _new_password(value: str) -> str:
    if not value.strip():
        raise ValueError("Blank passwords are not allowed")
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise ValueError("Control characters are not allowed")
    return value


def _utc(value: dt.datetime) -> dt.datetime:
    return value.replace(tzinfo=dt.UTC) if value.tzinfo is None else value.astimezone(dt.UTC)


# Reusable field types.
Id = Annotated[int, Field(ge=1, le=ID_MAX)]
UtcDatetime = Annotated[dt.datetime, AfterValidator(_utc)]
HexColor = Annotated[str, Field(pattern=HEX_COLOR_PATTERN), AfterValidator(_lower)]
Email = Annotated[EmailStr, AfterValidator(_lower)]
Password = Annotated[str, StringConstraints(strip_whitespace=False, min_length=1, max_length=200)]
# A password being chosen (8-200 characters, not blank, no control characters).
NewPassword = Annotated[
    str,
    StringConstraints(
        strip_whitespace=False,
        min_length=passwords.MIN_LENGTH,
        max_length=passwords.MAX_LENGTH,
    ),
    AfterValidator(_new_password),
]
# Single-use codes of e-mailed links and recovery links: 32 random bytes in lower-case hex.
LinkToken = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Locale = Literal["es", "en", "pt"]
UserName = Annotated[str, Field(min_length=1, max_length=120), AfterValidator(_single_line)]
OptionalUserName = Annotated[UserName | None, BeforeValidator(_blank_to_none)]
LocalPath = Annotated[str, Field(min_length=1, max_length=512), AfterValidator(_local_path)]

# Reusable route parameter types (ids are bounded to the 32-bit integer columns).
IdPath = Annotated[int, Path(ge=1, le=ID_MAX)]
IdQuery = Annotated[int | None, Query(ge=1, le=ID_MAX)]
SearchQuery = Annotated[str | None, Query(max_length=200)]


class Contract(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        from_attributes=True,
        # Response schemas mark every field as required: nullable fields are always present.
        json_schema_serialization_defaults_required=True,
    )


# Platform
class HealthOut(Contract):
    status: str


class VersionOut(Contract):
    version: str
    build_date: str


# Authentication
class AuthConfigOut(Contract):
    google_enabled: bool
    dev_login_enabled: bool
    # "Forgot password" e-mails can be sent (SMTP is configured).
    password_reset_enabled: bool
    # No enabled administrator exists yet: the login page offers to create one.
    setup_required: bool


class SessionUserOut(Contract):
    id: int
    email: str
    name: str | None
    role: Role
    has_password: bool


class SessionOut(Contract):
    authenticated: bool
    user: SessionUserOut | None


class GoogleStartIn(Contract):
    return_path: LocalPath = "/"


class GoogleStartOut(Contract):
    authorization_url: str


class DevLoginIn(Contract):
    username: Literal["admin", "viewer"]
    password: Password


class PasswordLoginIn(Contract):
    email: Email
    password: Password
    # The new password, when the current one is temporary (``password_change_required``);
    # ignored otherwise.
    new_password: NewPassword | None = None


class PasswordChangeIn(Contract):
    current_password: Password
    new_password: NewPassword


class PasswordForgotIn(Contract):
    email: Email
    # Language of the e-mail.
    locale: Locale = "es"


class PasswordResetIn(Contract):
    token: LinkToken
    new_password: NewPassword


class SetupIn(Contract):
    email: Email
    password: NewPassword
    name: OptionalUserName = None
    # Code of a recovery link (``python -m timelife.setup``); not needed while no enabled
    # administrator exists.
    token: LinkToken | None = None


# Users
class UserOut(Contract):
    id: int
    email: str
    name: str | None
    role: Role
    disabled: bool
    google_linked: bool
    has_password: bool
    # The password is temporary: it must be changed at the next sign-in.
    must_change_password: bool
    created_at: UtcDatetime
    last_login_at: UtcDatetime | None


class UserCreateIn(Contract):
    email: Email
    role: Role = "viewer"
    name: OptionalUserName = None
    # Temporary password, changed at the first sign-in. Required unless Google sign-in is on
    # (without it the user signs in with Google only).
    password: NewPassword | None = None


class UserUpdateIn(Contract):
    """PATCH: only fields present in the body (``model_fields_set``) change; '' name → null."""

    role: Role | None = None
    disabled: bool | None = None
    name: OptionalUserName = None


class UserPasswordIn(Contract):
    # The new temporary password: the user changes it at the next sign-in.
    password: NewPassword


# Media
class ImageCrop(Contract):
    """Thumbnail framing: centre of the square shown (fractions of the picture's width and
    height) and zoom (1 = the square's side is the short edge)."""

    x: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
    y: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
    zoom: Annotated[float, Field(ge=1, le=4, allow_inf_nan=False)]


class ImageOut(Contract):
    id: uuid.UUID
    name: str
    # "video": an event video, whose poster frame makes the thumbnail and display images.
    kind: MediaKind
    width: int
    height: int
    dominant_color: str
    # Event images only; null = the centred square.
    crop: ImageCrop | None
    thumb_url: str
    display_url: str
    # The MP4 of a video or of a Live Photo's motion (a photo with a status; null for other
    # photos), converted after the upload. ``video_url`` is set once it is ready.
    video_status: VideoStatus | None
    video_url: str | None
    # Seconds of the video or of the Live Photo's motion.
    duration: float | None
    # Live Photos: the motion is shown (false for anything else).
    live: bool


class UploadOut(ImageOut):
    # Share of a video's conversion already done (0–1) while it is processing; else null.
    progress: float | None = None


# Children
class ChildOut(Contract):
    id: int
    name: str
    # Address of the child's timeline (``/c/<slug>``): made from the name when the child is added
    # and never changed afterwards.
    slug: str
    birth_date: dt.date | None
    avatar: ImageOut | None
    # Colour of the child's line on the family timeline; null = the theme's automatic colour.
    color: str | None
    sort_order: int


class ChildIn(Contract):
    name: Annotated[str, Field(min_length=1, max_length=80), AfterValidator(_single_line)]
    birth_date: dt.date | None = None
    avatar_image_id: uuid.UUID | None = None


class ChildColorIn(Contract):
    color: HexColor


class OrderIn(Contract):
    ids: list[Id]


# Categories
class CategoryOut(Contract):
    id: int
    key: str | None
    name_es: str
    name_en: str
    name_pt: str
    icon: str
    color: str
    sort_order: int


class CategoryIn(Contract):
    name_es: Annotated[str, Field(min_length=1, max_length=60), AfterValidator(_single_line)]
    name_en: Annotated[str, Field(min_length=1, max_length=60), AfterValidator(_single_line)]
    name_pt: Annotated[str, Field(min_length=1, max_length=60), AfterValidator(_single_line)]
    icon: Annotated[str, Field(pattern=ICON_PATTERN)]
    color: HexColor


# Events
class EventImageIn(Contract):
    id: uuid.UUID
    name: Annotated[str, Field(min_length=1, max_length=160), AfterValidator(_single_line)]
    # Thumbnail framing (kept inside the picture); null = the centred square.
    crop: ImageCrop | None = None
    # Live Photos: show the motion (ignored for other images).
    live: bool = True


class EventIn(Contract):
    title: Annotated[str, Field(min_length=1, max_length=120), AfterValidator(_single_line)]
    date: dt.date
    notes: Annotated[str, Field(max_length=5000), AfterValidator(_multiline)] = ""
    location: Annotated[
        Annotated[str, Field(max_length=200), AfterValidator(_single_line)] | None,
        BeforeValidator(_blank_to_none),
    ] = None
    child_ids: Annotated[list[Id], Field(min_length=1, max_length=20), AfterValidator(_unique)]
    category_ids: Annotated[
        list[Id], Field(min_length=1, max_length=20), AfterValidator(_unique)
    ]
    images: Annotated[list[EventImageIn], Field(max_length=50)] = []
    cover_image_id: uuid.UUID | None = None

    @field_validator("images")
    @classmethod
    def unique_images(cls, value: list[EventImageIn]) -> list[EventImageIn]:
        _unique([image.id for image in value])
        return value


class EventUpdateIn(EventIn):
    version: Id


class EventOut(Contract):
    id: int
    title: str
    date: dt.date
    notes: str
    location: str | None
    child_ids: list[int]
    category_ids: list[int]
    images: list[ImageOut]
    cover_image_id: uuid.UUID | None
    version: int
    created_at: UtcDatetime
    updated_at: UtcDatetime
    deleted_at: UtcDatetime | None


class EventSummaryOut(Contract):
    id: int
    title: str
    date: dt.date
    location: str | None
    child_ids: list[int]
    category_ids: list[int]
    cover: ImageOut | None
    # Photos and videos; ``video_count`` of them are videos.
    image_count: int
    video_count: int
    updated_at: UtcDatetime


class EventPageOut(Contract):
    items: list[EventSummaryOut]
    total: int
    page: int
    page_size: int


class LocationOut(Contract):
    """A place used by events outside the trash (its most used spelling) and how many use it."""

    name: str
    count: int


class DayOrderIn(Contract):
    """Events of ``date`` in the order they should be shown (the first one first)."""

    date: dt.date
    ids: Annotated[list[Id], Field(min_length=1, max_length=500), AfterValidator(_unique)]


class TrashItemOut(Contract):
    id: int
    title: str
    date: dt.date
    child_ids: list[int]
    category_ids: list[int]
    cover: ImageOut | None
    # Photos and videos; ``video_count`` of them are videos.
    image_count: int
    video_count: int
    deleted_at: UtcDatetime
    deleted_by: str | None


# Timeline
class TimelineCoverOut(Contract):
    id: uuid.UUID
    thumb_url: str
    dominant_color: str


class TimelineEventOut(Contract):
    id: int
    title: str
    date: dt.date
    # Order among the events of the same date (lower first; then the most recently created).
    day_order: int
    category_ids: list[int]
    child_ids: list[int]
    cover: TimelineCoverOut | None
    image_count: int
    created_at: UtcDatetime


class TimelineOut(Contract):
    # Null for the family timeline (every child together).
    child_id: int | None
    total: int
    events: list[TimelineEventOut]


# Appearance
class YearColorOut(Contract):
    year: int
    color: str


class AppearanceOut(Contract):
    year_colors: list[YearColorOut]
    event_years: list[int]
    background: ImageOut | None
    background_opacity: float
    default_zoom: Zoom
    # Timeline direction on desktops and tablets (≥ 768 px wide) and on phones.
    direction_desktop: Direction
    direction_mobile: Direction


class YearColorIn(Contract):
    color: HexColor


class SettingsIn(Contract):
    background_image_id: uuid.UUID | None
    background_opacity: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
    default_zoom: Zoom
    direction_desktop: Direction
    direction_mobile: Direction


# Backup (export and import)
# "uploading" → (every byte received) "ready", or "invalid" when the file is no Timelife backup;
# "ready" → (start) "running" → "finished", or back to "ready" with ``error`` when the run fails,
# is cancelled or a restart interrupts it (nothing has changed then).
ImportStatus = Literal["uploading", "invalid", "ready", "running", "finished"]
# "merge": add what is missing, never change or delete anything; "replace": restore the backup
# exactly, removing everything else (except the importing administrator).
ImportMode = Literal["merge", "replace"]
# "media": photos and videos are being processed (``done`` of ``total``); "saving": the changes
# are being written, all at once.
ImportPhase = Literal["media", "saving"]
ImportItemKind = Literal["user", "category", "child", "event", "media", "year_color", "settings"]
ImportId = Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")]


class BackupSummaryOut(Contract):
    events: int
    trashed_events: int
    # Photos of events (Live Photos included; ``live_photos`` of them) and videos of events.
    photos: int
    live_photos: int
    videos: int
    children: int
    categories: int
    users: int
    admins: int
    year_colors: int
    background: bool
    # Size of the original files in bytes (exported servers: Live Photo clips not counted).
    media_bytes: int


class ImportArchiveOut(Contract):
    exported_at: UtcDatetime
    app_version: str
    summary: BackupSummaryOut
    # Files the manifest names that the archive lacks (their photos or videos are skipped).
    missing_files: int


class ImportProgressOut(Contract):
    phase: ImportPhase
    done: int
    total: int


class ImportCountsOut(Contract):
    created: int
    skipped: int
    failed: int


class ImportIssueOut(Contract):
    kind: ImportItemKind
    # What could not be imported: an e-mail, a name, a title or "title · photo name".
    name: str
    # Error code (translated by the client).
    code: str


class ImportReportOut(Contract):
    mode: ImportMode
    users: ImportCountsOut
    categories: ImportCountsOut
    children: ImportCountsOut
    # Events in the trash included.
    events: ImportCountsOut
    media: ImportCountsOut
    year_colors: ImportCountsOut
    issues: list[ImportIssueOut]
    # Issues left out of ``issues`` (it lists the first ones).
    more_issues: int
    finished_at: UtcDatetime


class ImportOut(Contract):
    id: str
    status: ImportStatus
    filename: str
    size: int
    received: int
    # ``last_modified`` the client sent (milliseconds), to recognise the same file again.
    last_modified: int | None
    # Bytes to send per ``PUT …/content`` request (the last one may be shorter).
    chunk_size: int
    archive: ImportArchiveOut | None
    mode: ImportMode | None
    progress: ImportProgressOut | None
    report: ImportReportOut | None
    # Why the archive is invalid, or why the last run stopped.
    error: str | None
    created_at: UtcDatetime
    updated_at: UtcDatetime


class ImportCreateIn(Contract):
    filename: Annotated[str, Field(min_length=1, max_length=255)]
    # Bytes of the whole file (at most 4 TiB).
    size: Annotated[int, Field(ge=1, le=4 * 1024**4)]
    last_modified: Annotated[int, Field(ge=0, le=2**53)] | None = None


class ImportStartIn(Contract):
    mode: ImportMode
