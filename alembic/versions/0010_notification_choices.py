"""Notifications to choose: whether each user wants each day's memories and the milestones other
people add (``users.notify_memories``, ``users.notify_milestones``; true for every existing user),
and the new milestones each device is still to be told about (``milestone_notifications``)."""

from collections.abc import Iterator
from contextlib import contextmanager

import sqlalchemy as sa

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


@contextmanager
def keeping_sqlite_counter(table: str) -> Iterator[None]:
    """Keep the AUTOINCREMENT counter of a table SQLite rebuilds: the copy would restart it at
    its highest remaining id and hand the ids of deleted rows out again."""
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        yield
        return
    query = "SELECT seq FROM sqlite_sequence WHERE name = :name"
    counter = bind.execute(sa.text(query), {"name": table}).scalar()
    yield
    if counter is not None:
        bind.execute(sa.text("DELETE FROM sqlite_sequence WHERE name = :name"), {"name": table})
        bind.execute(
            sa.text("INSERT INTO sqlite_sequence (name, seq) VALUES (:name, :seq)"),
            {"name": table, "seq": counter},
        )


def upgrade() -> None:
    # Plain ADD COLUMN (no batch): SQLite adds both columns in place, without rebuilding users.
    for column in ("notify_memories", "notify_milestones"):
        op.add_column(
            "users", sa.Column(column, sa.Boolean(), server_default=sa.true(), nullable=False)
        )
    op.create_table(
        "milestone_notifications",
        sa.Column("subscription_id", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["subscription_id"],
            ["push_subscriptions.id"],
            name=op.f("fk_milestone_notifications_subscription_id_push_subscriptions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["event_id"], ["events.id"], name=op.f("fk_milestone_notifications_event_id_events"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "subscription_id", "event_id", name=op.f("pk_milestone_notifications")
        ),
    )
    op.create_index(
        op.f("ix_milestone_notifications_event_id"), "milestone_notifications", ["event_id"]
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_milestone_notifications_event_id"), table_name="milestone_notifications"
    )
    op.drop_table("milestone_notifications")
    # SQLite rebuilds the table to drop the columns; reflection misses AUTOINCREMENT.
    with (
        keeping_sqlite_counter("users"),
        op.batch_alter_table("users", table_kwargs={"sqlite_autoincrement": True}) as batch,
    ):
        batch.drop_column("notify_milestones")
        batch.drop_column("notify_memories")
