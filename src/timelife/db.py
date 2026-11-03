import datetime as dt
import uuid
from pathlib import Path
from typing import Any, Literal, overload

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    MetaData,
    String,
    Text,
    Uuid,
    event,
    false,
)
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from . import crops

UserRole = Literal["admin", "viewer"]
ImagePurpose = Literal["event", "avatar", "background"]
MediaKind = Literal["image", "video"]
VideoStatus = Literal["processing", "ready", "failed"]

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


@overload
def aware(value: dt.datetime) -> dt.datetime: ...


@overload
def aware(value: None) -> None: ...


def aware(value: dt.datetime | None) -> dt.datetime | None:
    """Re-attach UTC to naive datetimes (SQLite drops the offset)."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=dt.UTC)


def create_db_engine(url: str, *, foreign_keys: bool = True) -> AsyncEngine:
    """Create the async engine; on SQLite also create the file's folder and enforce foreign keys."""
    parsed = make_url(url)
    if parsed.get_backend_name() == "sqlite":
        database = parsed.database or ""
        if database and database != ":memory:" and not database.startswith("file:"):
            Path(database).parent.mkdir(parents=True, exist_ok=True)
    # hide_parameters keeps bound values (emails, notes, token hashes) out of error messages/logs.
    engine = create_async_engine(url, pool_pre_ping=True, hide_parameters=True)
    if engine.dialect.name == "sqlite" and foreign_keys:

        @event.listens_for(engine.sync_engine, "connect")
        def enable_foreign_keys(connection: Any, record: Any) -> None:
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'viewer')", name="role"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str | None] = mapped_column(String(120))
    role: Mapped[UserRole] = mapped_column(String(10))
    google_subject: Mapped[str | None] = mapped_column(String(255), unique=True)
    # scrypt hash (see ``passwords``); NULL: no password (Google sign-in only).
    password_hash: Mapped[str | None] = mapped_column(String(255))
    # The password is temporary (set by an administrator): the next sign-in must change it.
    must_change_password: Mapped[bool] = mapped_column(default=False, server_default=false())
    disabled: Mapped[bool] = mapped_column(default=False)
    auth_version: Mapped[int] = mapped_column(default=1)
    invited_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def google_linked(self) -> bool:
        return self.google_subject is not None

    @property
    def has_password(self) -> bool:
        return self.password_hash is not None


class UserSession(Base):
    __tablename__ = "user_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    auth_version: Mapped[int]
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GoogleAuthFlow(Base):
    __tablename__ = "google_auth_flows"

    state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    browser_hash: Mapped[str] = mapped_column(String(64), index=True)
    origin: Mapped[str] = mapped_column(String(255))
    return_path: Mapped[str] = mapped_column(String(512))
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)


class AuthLimit(Base):
    __tablename__ = "auth_limits"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    hits: Mapped[int]
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)


class PasswordReset(Base):
    """A pending "forgot password" link: the HMAC of its token (single use)."""

    __tablename__ = "password_resets"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str | None] = mapped_column(String(64), unique=True)
    name_es: Mapped[str] = mapped_column(String(60))
    name_en: Mapped[str] = mapped_column(String(60))
    name_pt: Mapped[str] = mapped_column(String(60))
    icon: Mapped[str] = mapped_column(String(64))
    color: Mapped[str] = mapped_column(String(7))
    sort_order: Mapped[int]
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Event(Base):
    __tablename__ = "events"
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    title_search: Mapped[str] = mapped_column(String(240), index=True)
    date: Mapped[dt.date] = mapped_column(Date, index=True)
    # Order among the events of the same date (lower first; ties: most recently created first).
    day_order: Mapped[int] = mapped_column(default=0, server_default="0")
    notes: Mapped[str] = mapped_column(Text, default="")
    location: Mapped[str | None] = mapped_column(String(200))
    # No foreign key on purpose (images.event_id already points here); the app keeps it valid.
    cover_image_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    version: Mapped[int] = mapped_column(default=1)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    deleted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    deleted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    # Relationships never lazy-load (async): load them explicitly with selectinload()/joinedload().
    child_links: Mapped[list["EventChild"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="EventChild.child_id",
        lazy="raise",
    )
    category_links: Mapped[list["EventCategory"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="EventCategory.position",
        lazy="raise",
    )
    images: Mapped[list["Image"]] = relationship(
        back_populates="event", passive_deletes=True, order_by="Image.position", lazy="raise",
    )
    deleted_by: Mapped[User | None] = relationship(foreign_keys=[deleted_by_id], lazy="raise")

    @property
    def child_ids(self) -> list[int]:
        return [link.child_id for link in self.child_links]

    @property
    def category_ids(self) -> list[int]:
        return [link.category_id for link in sorted(self.category_links, key=lambda x: x.position)]


class Image(Base):
    __tablename__ = "images"
    __table_args__ = (
        CheckConstraint("purpose IN ('event', 'avatar', 'background')", name="purpose"),
        CheckConstraint("kind IN ('image', 'video')", name="kind"),
        CheckConstraint("video_status IN ('processing', 'ready', 'failed')", name="video_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    purpose: Mapped[ImagePurpose] = mapped_column(String(16))
    # "video": an event video; its poster frame makes the thumbnail and display variants.
    kind: Mapped[MediaKind] = mapped_column(String(8), default="image", server_default="image")
    event_id: Mapped[int | None] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160))
    original_filename: Mapped[str] = mapped_column(String(255))
    original_ext: Mapped[str] = mapped_column(String(10))
    content_type: Mapped[str] = mapped_column(String(64))
    # 64-bit: videos may exceed 2 GiB (MAX_VIDEO_UPLOAD_MB goes up to 4096).
    byte_size: Mapped[int] = mapped_column(BigInteger)
    width: Mapped[int]
    height: Mapped[int]
    dominant_color: Mapped[str] = mapped_column(String(7))
    position: Mapped[int] = mapped_column(default=0)
    # Thumbnail framing of event images (see ``crops``); all NULL = the centred square.
    crop_x: Mapped[float | None] = mapped_column(Float)
    crop_y: Mapped[float | None] = mapped_column(Float)
    crop_zoom: Mapped[float | None] = mapped_column(Float)
    # The playable ``video.mp4`` of a video or of a Live Photo's motion (a photo with a status);
    # NULL for every other photo. See ``video``.
    video_status: Mapped[VideoStatus | None] = mapped_column(String(12))
    # Seconds of the video or of the Live Photo's motion.
    duration: Mapped[float | None] = mapped_column(Float)
    # Live Photos: the motion is shown (chosen with the event's images); false for anything else.
    live: Mapped[bool] = mapped_column(default=False, server_default=false())
    uploaded_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Set only while the upload is pending (not yet attached); NULL once attached.
    expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    event: Mapped[Event | None] = relationship(back_populates="images", lazy="raise")

    @property
    def framing(self) -> crops.Framing | None:
        if self.crop_x is None or self.crop_y is None or self.crop_zoom is None:
            return None
        return self.crop_x, self.crop_y, self.crop_zoom

    @property
    def crop(self) -> dict[str, float] | None:
        framing = self.framing
        return None if framing is None else dict(zip(("x", "y", "zoom"), framing, strict=True))

    @property
    def thumb_url(self) -> str:
        return crops.thumb_url(self.id, self.framing)

    @property
    def display_url(self) -> str:
        return f"/api/media/{self.id}/display"

    @property
    def video_url(self) -> str | None:
        return f"/api/media/{self.id}/video" if self.video_status == "ready" else None

    @property
    def is_live_photo(self) -> bool:
        return self.kind == "image" and self.video_status is not None


class Child(Base):
    __tablename__ = "children"
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    # Never changes once the child exists (links to ``/c/<slug>`` keep working).
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    birth_date: Mapped[dt.date | None] = mapped_column(Date)
    avatar_image_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("images.id", ondelete="SET NULL")
    )
    # Own colour of the child's line on the family timeline (``#rrggbb``); NULL = automatic.
    color: Mapped[str | None] = mapped_column(String(7))
    sort_order: Mapped[int]
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    avatar: Mapped[Image | None] = relationship(lazy="raise")


class EventChild(Base):
    __tablename__ = "event_children"

    event_id: Mapped[int] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    child_id: Mapped[int] = mapped_column(
        ForeignKey("children.id", ondelete="RESTRICT"), primary_key=True, index=True
    )

    event: Mapped[Event] = relationship(back_populates="child_links", lazy="raise")
    child: Mapped[Child] = relationship(lazy="raise")


class EventCategory(Base):
    __tablename__ = "event_categories"

    event_id: Mapped[int] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), primary_key=True, index=True
    )
    position: Mapped[int]

    event: Mapped[Event] = relationship(back_populates="category_links", lazy="raise")
    category: Mapped[Category] = relationship(lazy="raise")


class YearColor(Base):
    __tablename__ = "year_colors"

    year: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    color: Mapped[str] = mapped_column(String(7))
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
