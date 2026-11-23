"""Make custom exercises private to the account that created them."""
from alembic import op
import sqlalchemy as sa

from app.exercise_ownership import assign_custom_exercise_owners

revision = "0011_private_custom_exercises"
down_revision = "0010_workout_last_writer"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if "owner_email" not in {column["name"] for column in inspector.get_columns("exercises")}:
        op.add_column("exercises", sa.Column("owner_email", sa.String(length=320), nullable=True))
    if "ix_exercises_owner_email" not in {index["name"] for index in inspector.get_indexes("exercises")}:
        op.create_index("ix_exercises_owner_email", "exercises", ["owner_email"])
    # A custom exercise used by exactly one account becomes that account's.
    # Shared catalogue rows keep owner_email NULL.
    assign_custom_exercise_owners(connection)


def downgrade():
    op.drop_index("ix_exercises_owner_email", "exercises")
    op.drop_column("exercises", "owner_email")
