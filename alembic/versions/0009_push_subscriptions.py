"""Push notifications: the browsers and installed apps that asked to be told about each day's
memories (``push_subscriptions``)."""

import sqlalchemy as sa

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("auth_version", sa.Integer(), nullable=False),
        sa.Column("session_hash", sa.String(64), nullable=False),
        sa.Column("endpoint", sa.String(2048), nullable=False),
        sa.Column("p256dh", sa.String(100), nullable=False),
        sa.Column("auth", sa.String(40), nullable=False),
        sa.Column("origin", sa.String(255), nullable=False),
        sa.Column("locale", sa.String(2), nullable=False),
        sa.Column("time_zone", sa.String(64), nullable=False),
        sa.Column("memories_notified_on", sa.Date(), nullable=True),
        sa.Column("failures", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "locale IN ('es', 'en', 'pt')", name=op.f("ck_push_subscriptions_locale")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_push_subscriptions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_push_subscriptions")),
        sa.UniqueConstraint("endpoint", name=op.f("uq_push_subscriptions_endpoint")),
    )
    op.create_index(op.f("ix_push_subscriptions_user_id"), "push_subscriptions", ["user_id"])
    op.create_index(
        op.f("ix_push_subscriptions_session_hash"), "push_subscriptions", ["session_hash"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_push_subscriptions_session_hash"), table_name="push_subscriptions")
    op.drop_index(op.f("ix_push_subscriptions_user_id"), table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
