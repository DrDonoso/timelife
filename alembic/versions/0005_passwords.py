"""Passwords: ``users.password_hash`` and ``users.must_change_password``, and the pending "forgot
password" links (``password_resets``).

Existing users keep their sign-in (Google) and have no password until an administrator gives
them one, they follow a "forgot password" e-mail or use a ``timelife.setup`` link."""

from collections.abc import Iterator
from contextlib import contextmanager

import sqlalchemy as sa

from alembic import op

revision = "0005"
down_revision = "0004"
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
    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "must_change_password", sa.Boolean(), server_default=sa.false(), nullable=False
        ),
    )
    op.create_table(
        "password_resets",
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_password_resets_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("token_hash", name=op.f("pk_password_resets")),
    )
    op.create_index(op.f("ix_password_resets_user_id"), "password_resets", ["user_id"])
    op.create_index(op.f("ix_password_resets_expires_at"), "password_resets", ["expires_at"])


def downgrade() -> None:
    op.drop_index(op.f("ix_password_resets_expires_at"), table_name="password_resets")
    op.drop_index(op.f("ix_password_resets_user_id"), table_name="password_resets")
    op.drop_table("password_resets")
    # SQLite rebuilds the table to drop the columns; reflection misses AUTOINCREMENT.
    with (
        keeping_sqlite_counter("users"),
        op.batch_alter_table("users", table_kwargs={"sqlite_autoincrement": True}) as batch,
    ):
        batch.drop_column("must_change_password")
        batch.drop_column("password_hash")
