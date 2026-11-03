"""Videos and Live Photos: ``images.kind``, ``video_status``, ``duration`` and ``live``, and a
64-bit ``byte_size`` (videos may exceed 2 GiB).

Every existing row stays a plain photo (kind 'image', no video, Live off). On SQLite the new CHECK
constraints rebuild ``images`` (foreign keys are off during migrations, so nothing cascades)."""

import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("images") as batch:
        batch.alter_column(
            "byte_size", existing_type=sa.Integer(), type_=sa.BigInteger(), existing_nullable=False
        )
        batch.add_column(sa.Column("kind", sa.String(8), server_default="image", nullable=False))
        batch.add_column(sa.Column("video_status", sa.String(12), nullable=True))
        batch.add_column(sa.Column("duration", sa.Float(), nullable=True))
        batch.add_column(
            sa.Column("live", sa.Boolean(), server_default=sa.false(), nullable=False)
        )
        batch.create_check_constraint(op.f("ck_images_kind"), "kind IN ('image', 'video')")
        batch.create_check_constraint(
            op.f("ck_images_video_status"), "video_status IN ('processing', 'ready', 'failed')"
        )


def downgrade() -> None:
    with op.batch_alter_table("images") as batch:
        batch.drop_constraint(op.f("ck_images_video_status"), type_="check")
        batch.drop_constraint(op.f("ck_images_kind"), type_="check")
        batch.drop_column("live")
        batch.drop_column("duration")
        batch.drop_column("video_status")
        batch.drop_column("kind")
        # Fails on PostgreSQL while a file of 2 GiB or more is stored.
        batch.alter_column(
            "byte_size", existing_type=sa.BigInteger(), type_=sa.Integer(), existing_nullable=False
        )
