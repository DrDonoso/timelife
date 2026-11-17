"""Memories ("on this day"): the last day each user was told about the milestones that turn a
whole number of months or years old that day (``users.memories_announced_on``), and the last day
they looked at them (``users.memories_opened_on``). NULL: never, as for every existing user."""

from collections.abc import Iterator
from contextlib import contextmanager

import sqlalchemy as sa

from alembic import op

revision = "0008"
down_revision = "0007"
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
    # Plain ADD COLUMN (no batch): SQLite adds the nullable columns in place.
    op.add_column("users", sa.Column("memories_announced_on", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("memories_opened_on", sa.Date(), nullable=True))


def downgrade() -> None:
    # SQLite rebuilds the table to drop the columns; reflection misses AUTOINCREMENT.
    with (
        keeping_sqlite_counter("users"),
        op.batch_alter_table("users", table_kwargs={"sqlite_autoincrement": True}) as batch,
    ):
        batch.drop_column("memories_opened_on")
        batch.drop_column("memories_announced_on")
