"""Thumbnail framing of images: ``images.crop_x``, ``crop_y`` and ``crop_zoom`` (all NULL = the
centred square)."""

import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

COLUMNS = ("crop_x", "crop_y", "crop_zoom")


def upgrade() -> None:
    with op.batch_alter_table("images") as batch:
        for name in COLUMNS:
            batch.add_column(sa.Column(name, sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("images") as batch:
        for name in reversed(COLUMNS):
            batch.drop_column(name)
