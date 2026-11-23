"""Remember which device made the latest workout save."""
from alembic import op
import sqlalchemy as sa

revision = "0010_workout_last_writer"
down_revision = "0009_workout_substitution"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("workouts")}
    if "last_writer_id" not in columns:
        op.add_column("workouts", sa.Column("last_writer_id", sa.String(length=64), nullable=True))


def downgrade():
    op.drop_column("workouts", "last_writer_id")
