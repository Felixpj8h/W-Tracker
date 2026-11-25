"""Distinguish checkbox-aware workouts from earlier logs."""
from alembic import op
import sqlalchemy as sa

revision = "0013_set_completion"
down_revision = "0012_weight_goal"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("workouts")}
    if "tracks_set_completion" not in columns:
        op.add_column("workouts", sa.Column("tracks_set_completion", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("workouts", "tracks_set_completion")
