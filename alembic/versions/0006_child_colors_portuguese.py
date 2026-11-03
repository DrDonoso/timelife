"""Children's own line colour on the family timeline (``children.color``) and the Portuguese name
of every category (``categories.name_pt``).

Existing categories get a Portuguese name straight away: a default category still called as when
it was created gets its translation; any other one (renamed defaults included) starts with its
Spanish name, for an administrator to translate."""

from collections.abc import Iterator
from contextlib import contextmanager

import sqlalchemy as sa

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

# key, Spanish name it was created with, Portuguese name (copied from ``timelife.seed`` so that
# this migration never changes when the seed does).
DEFAULT_NAMES = (
    ("general", "General", "Geral"),
    ("academic", "Académico", "Académico"),
    ("teething", "Dentición", "Dentição"),
    ("language", "Lenguaje y comunicación", "Linguagem e comunicação"),
    ("sleep", "Sueño", "Sono"),
    ("gross-motor", "Motricidad gruesa", "Motricidade global"),
    ("fine-motor", "Motricidad fina", "Motricidade fina"),
    ("cognitive", "Desarrollo cognitivo", "Desenvolvimento cognitivo"),
    ("social-emotional", "Desarrollo social y emocional", "Desenvolvimento social e emocional"),
    ("feeding", "Alimentación", "Alimentação"),
    ("self-care", "Autonomía y cuidado personal", "Autonomia e cuidados pessoais"),
)


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
    op.add_column("children", sa.Column("color", sa.String(7), nullable=True))
    op.add_column("categories", sa.Column("name_pt", sa.String(60), nullable=True))
    categories = sa.table(
        "categories",
        sa.column("key", sa.String),
        sa.column("name_es", sa.String),
        sa.column("name_pt", sa.String),
    )
    for key, name_es, name_pt in DEFAULT_NAMES:
        op.execute(
            categories.update()
            .where(categories.c.key == key, categories.c.name_es == name_es)
            .values(name_pt=name_pt)
        )
    op.execute(
        categories.update()
        .where(categories.c.name_pt.is_(None))
        .values(name_pt=categories.c.name_es)
    )
    # SQLite rebuilds the table to make the column NOT NULL; reflection misses AUTOINCREMENT.
    with (
        keeping_sqlite_counter("categories"),
        op.batch_alter_table("categories", table_kwargs={"sqlite_autoincrement": True}) as batch,
    ):
        batch.alter_column("name_pt", existing_type=sa.String(60), nullable=False)


def downgrade() -> None:
    with (
        keeping_sqlite_counter("categories"),
        op.batch_alter_table("categories", table_kwargs={"sqlite_autoincrement": True}) as batch,
    ):
        batch.drop_column("name_pt")
    with (
        keeping_sqlite_counter("children"),
        op.batch_alter_table("children", table_kwargs={"sqlite_autoincrement": True}) as batch,
    ):
        batch.drop_column("color")
