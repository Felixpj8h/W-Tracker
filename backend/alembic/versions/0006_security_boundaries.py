"""Revocable browser sessions, workout revisions and folder ownership guards."""
from alembic import op
import sqlalchemy as sa
from app.main import BrowserSession
from app.database_security import install_folder_guards, TRIGGERS

revision = "0006_security_boundaries"
down_revision = "0005_workout_set_metadata"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    BrowserSession.__table__.create(connection, checkfirst=True)
    if "revision" not in {column["name"] for column in sa.inspect(connection).get_columns("workouts")}:
        op.add_column("workouts", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
    install_folder_guards(connection)
    if "ix_workouts_owner_completed_date" not in {index["name"] for index in sa.inspect(connection).get_indexes("workouts")}:
        op.create_index("ix_workouts_owner_completed_date", "workouts", ["owner_email", "completed", "performed_on", "id"])
    if "ix_workout_exercises_workout" not in {index["name"] for index in sa.inspect(connection).get_indexes("workout_exercises")}:
        op.create_index("ix_workout_exercises_workout", "workout_exercises", ["workout_id"])
    if "ix_workout_sets_exercise" not in {index["name"] for index in sa.inspect(connection).get_indexes("workout_sets")}:
        op.create_index("ix_workout_sets_exercise", "workout_sets", ["workout_exercise_id"])


def downgrade():
    op.drop_index("ix_workout_sets_exercise", "workout_sets")
    op.drop_index("ix_workout_exercises_workout", "workout_exercises")
    op.drop_index("ix_workouts_owner_completed_date", "workouts")
    for name in TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {name}")
    op.drop_column("workouts", "revision")
    op.drop_table("browser_sessions")
