"""Save the original exercise with an active workout substitution."""
from alembic import op
import sqlalchemy as sa

revision = "0009_workout_substitution"
down_revision = "0008_account_settings"
branch_labels = None
depends_on = None


def upgrade():
    columns = sa.inspect(op.get_bind()).get_columns("workout_exercises")
    if not any(column["name"] == "substituted_from" for column in columns):
        op.add_column("workout_exercises", sa.Column("substituted_from", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("workout_exercises", "substituted_from")
