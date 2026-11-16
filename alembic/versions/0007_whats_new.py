"""What's new: the notes each user has read (``users.whats_new_seen``).

NULL means the interface never recorded any, as for a new user: it then marks every current note
as read without showing them. Existing users get an empty list instead, so the next time they
open Timelife they read the notes that come with this version."""

from collections.abc import Iterator
from contextlib import contextmanager

import sqlalchemy as sa

from alembic import op

revision = "0007"
down_revision = "0006"
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
    # Plain ADD COLUMN (no batch): SQLite adds the nullable column in place.
    op.add_column("users", sa.Column("whats_new_seen", sa.JSON(), nullable=True))
    users = sa.table("users", sa.column("whats_new_seen", sa.JSON()))
    op.execute(users.update().values(whats_new_seen=[]))


def downgrade() -> None:
    # SQLite rebuilds the table to drop the column; reflection misses AUTOINCREMENT.
    with (
        keeping_sqlite_counter("users"),
        op.batch_alter_table("users", table_kwargs={"sqlite_autoincrement": True}) as batch,
    ):
        batch.drop_column("whats_new_seen")
