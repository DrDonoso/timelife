"""Birthdays: whether each user wants to be told about the children's birthdays
(``users.notify_birthdays``; true for every existing user), and the last day each device was told
about them (``push_subscriptions.birthdays_notified_on``; NULL: never)."""

from collections.abc import Iterator
from contextlib import contextmanager

import sqlalchemy as sa

from alembic import op

revision = "0011"
down_revision = "0010"
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
    # Plain ADD COLUMN (no batch): SQLite adds both columns in place, without rebuilding tables.
    op.add_column(
        "users",
        sa.Column("notify_birthdays", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.add_column(
        "push_subscriptions", sa.Column("birthdays_notified_on", sa.Date(), nullable=True)
    )


def downgrade() -> None:
    # SQLite rebuilds the tables to drop the columns (named CHECK constraints are kept);
    # reflection misses the AUTOINCREMENT of users.
    with op.batch_alter_table("push_subscriptions") as batch:
        batch.drop_column("birthdays_notified_on")
    with (
        keeping_sqlite_counter("users"),
        op.batch_alter_table("users", table_kwargs={"sqlite_autoincrement": True}) as batch,
    ):
        batch.drop_column("notify_birthdays")
