"""Persist individual set completion for active workout logging."""
from alembic import op
import sqlalchemy as sa

revision = "0003_workout_set_completion"
down_revision = "0002_planned_workout_override"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column['name'] for column in sa.inspect(op.get_bind()).get_columns('workout_sets')}
    if 'completed' not in columns:
        op.add_column('workout_sets', sa.Column('completed', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column('workout_sets', 'completed')
