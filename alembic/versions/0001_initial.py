"""Initial schema: users and authentication, categories, events, images, children, appearance."""

import sqlalchemy as sa

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def created_updated() -> tuple[sa.Column, sa.Column]:
    return (
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("name", sa.String(120), nullable=True),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("google_subject", sa.String(255), nullable=True),
        sa.Column("disabled", sa.Boolean(), nullable=False),
        sa.Column("auth_version", sa.Integer(), nullable=False),
        sa.Column("invited_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("role IN ('admin', 'viewer')", name=op.f("ck_users_role")),
        sa.ForeignKeyConstraint(
            ["invited_by_id"], ["users.id"], name=op.f("fk_users_invited_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
        sa.UniqueConstraint("google_subject", name=op.f("uq_users_google_subject")),
        sqlite_autoincrement=True,
    )

    op.create_table(
        "user_sessions",
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("auth_version", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_user_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("token_hash", name=op.f("pk_user_sessions")),
    )
    op.create_index(op.f("ix_user_sessions_user_id"), "user_sessions", ["user_id"])
    op.create_index(op.f("ix_user_sessions_expires_at"), "user_sessions", ["expires_at"])

    op.create_table(
        "google_auth_flows",
        sa.Column("state_hash", sa.String(64), nullable=False),
        sa.Column("browser_hash", sa.String(64), nullable=False),
        sa.Column("origin", sa.String(255), nullable=False),
        sa.Column("return_path", sa.String(512), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("state_hash", name=op.f("pk_google_auth_flows")),
    )
    op.create_index(
        op.f("ix_google_auth_flows_browser_hash"), "google_auth_flows", ["browser_hash"]
    )
    op.create_index(op.f("ix_google_auth_flows_expires_at"), "google_auth_flows", ["expires_at"])

    op.create_table(
        "auth_limits",
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("hits", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_auth_limits")),
    )
    op.create_index(op.f("ix_auth_limits_expires_at"), "auth_limits", ["expires_at"])

    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(64), nullable=True),
        sa.Column("name_es", sa.String(60), nullable=False),
        sa.Column("name_en", sa.String(60), nullable=False),
        sa.Column("icon", sa.String(64), nullable=False),
        sa.Column("color", sa.String(7), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        *created_updated(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_categories")),
        sa.UniqueConstraint("key", name=op.f("uq_categories_key")),
        sqlite_autoincrement=True,
    )

    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("title_search", sa.String(240), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("location", sa.String(200), nullable=True),
        # No foreign key: images.event_id already references events (avoids a cycle).
        sa.Column("cover_image_id", sa.Uuid(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("deleted_by_id", sa.Integer(), nullable=True),
        *created_updated(),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["users.id"], name=op.f("fk_events_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_id"], ["users.id"], name=op.f("fk_events_updated_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by_id"], ["users.id"], name=op.f("fk_events_deleted_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_events")),
        sqlite_autoincrement=True,
    )
    op.create_index(op.f("ix_events_title_search"), "events", ["title_search"])
    op.create_index(op.f("ix_events_date"), "events", ["date"])
    op.create_index(op.f("ix_events_deleted_at"), "events", ["deleted_at"])

    op.create_table(
        "images",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("original_ext", sa.String(10), nullable=False),
        sa.Column("content_type", sa.String(64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("dominant_color", sa.String(7), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('event', 'avatar', 'background')", name=op.f("ck_images_purpose")
        ),
        sa.ForeignKeyConstraint(
            ["event_id"], ["events.id"], name=op.f("fk_images_event_id_events"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by_id"], ["users.id"], name=op.f("fk_images_uploaded_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_images")),
    )
    op.create_index(op.f("ix_images_event_id"), "images", ["event_id"])
    op.create_index(op.f("ix_images_expires_at"), "images", ["expires_at"])

    op.create_table(
        "children",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("avatar_image_id", sa.Uuid(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        *created_updated(),
        sa.ForeignKeyConstraint(
            ["avatar_image_id"], ["images.id"], name=op.f("fk_children_avatar_image_id_images"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_children")),
        sa.UniqueConstraint("slug", name=op.f("uq_children_slug")),
        sqlite_autoincrement=True,
    )

    op.create_table(
        "event_children",
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("child_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"], ["events.id"], name=op.f("fk_event_children_event_id_events"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["child_id"], ["children.id"], name=op.f("fk_event_children_child_id_children"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("event_id", "child_id", name=op.f("pk_event_children")),
    )
    op.create_index(op.f("ix_event_children_child_id"), "event_children", ["child_id"])

    op.create_table(
        "event_categories",
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"], ["events.id"], name=op.f("fk_event_categories_event_id_events"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"],
            name=op.f("fk_event_categories_category_id_categories"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("event_id", "category_id", name=op.f("pk_event_categories")),
    )
    op.create_index(
        op.f("ix_event_categories_category_id"), "event_categories", ["category_id"]
    )

    op.create_table(
        "year_colors",
        sa.Column("year", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("color", sa.String(7), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("year", name=op.f("pk_year_colors")),
    )

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_app_settings")),
    )


def downgrade() -> None:
    for table in (
        "app_settings",
        "year_colors",
        "event_categories",
        "event_children",
        "children",
        "images",
        "events",
        "categories",
        "auth_limits",
        "google_auth_flows",
        "user_sessions",
        "users",
    ):
        op.drop_table(table)
