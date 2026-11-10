"""Persist superset pairing and warm-up sets on existing databases."""
from alembic import op
import sqlalchemy as sa

revision = "0005_workout_set_metadata"
down_revision = "0004_calendar_day_labels"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    exercise_columns = {column["name"] for column in inspector.get_columns("workout_exercises")}
    if "superset_id" not in exercise_columns:
        op.add_column("workout_exercises", sa.Column("superset_id", sa.String(40), nullable=True))

    set_columns = {column["name"] for column in inspector.get_columns("workout_sets")}
    if "is_warmup" not in set_columns:
        op.add_column("workout_sets", sa.Column("is_warmup", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("workout_sets", "is_warmup")
    op.drop_column("workout_exercises", "superset_id")
