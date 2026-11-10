"""Add reusable calendar day labels."""
from alembic import op
import sqlalchemy as sa

revision = "0004_calendar_day_labels"
down_revision = "0003_workout_set_completion"
branch_labels = None
depends_on = None


def upgrade():
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "calendar_labels" not in existing:
        op.create_table(
            "calendar_labels",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("owner_email", sa.String(320), nullable=False),
            sa.Column("name", sa.String(40), nullable=False),
            sa.Column("color", sa.String(20), nullable=False),
        )
        op.create_index("ix_calendar_labels_owner_email", "calendar_labels", ["owner_email"])
    if "calendar_day_labels" not in existing:
        op.create_table(
            "calendar_day_labels",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("owner_email", sa.String(320), nullable=False),
            sa.Column("day", sa.Date(), nullable=False),
            sa.Column("label_id", sa.Integer(), sa.ForeignKey("calendar_labels.id"), nullable=False),
            sa.UniqueConstraint("owner_email", "day", name="uq_calendar_day_label_owner_day"),
        )
        op.create_index("ix_calendar_day_labels_owner_email", "calendar_day_labels", ["owner_email"])


def downgrade():
    op.drop_index("ix_calendar_day_labels_owner_email", table_name="calendar_day_labels")
    op.drop_table("calendar_day_labels")
    op.drop_index("ix_calendar_labels_owner_email", table_name="calendar_labels")
    op.drop_table("calendar_labels")
