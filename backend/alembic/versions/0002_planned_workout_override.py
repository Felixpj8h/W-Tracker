"""Add per-date planned workout overrides."""
from alembic import op
import sqlalchemy as sa

revision = "0002_planned_workout_override"
down_revision = "0001_secure_multi_user"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("calendar_assignments")}
    if "workout_override" not in columns:
        op.add_column("calendar_assignments", sa.Column("workout_override", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("calendar_assignments", "workout_override")
