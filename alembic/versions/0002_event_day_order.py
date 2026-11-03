"""Same-day order of events: ``events.day_order`` (lower first among the events of one date)."""

from collections.abc import Iterator
from contextlib import contextmanager

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


@contextmanager
def keeping_sqlite_counter(table: str) -> Iterator[None]:
    """Keep the AUTOINCREMENT counter of a table SQLite rebuilds: the copy would restart it at
    its highest remaining id and hand the ids of purged rows out again."""
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
    # A plain string default lets SQLite add the column in place (no table rebuild).
    with op.batch_alter_table("events") as batch:
        batch.add_column(sa.Column("day_order", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    # SQLite rebuilds the table to drop the column; reflection misses AUTOINCREMENT.
    with (
        keeping_sqlite_counter("events"),
        op.batch_alter_table("events", table_kwargs={"sqlite_autoincrement": True}) as batch,
    ):
        batch.drop_column("day_order")