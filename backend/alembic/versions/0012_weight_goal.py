"""Store each account's bodyweight goal and optional target weight."""
from alembic import op
import sqlalchemy as sa

revision = "0012_weight_goal"
down_revision = "0011_private_custom_exercises"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("account_settings")}
    if "weight_goal" not in columns:
        op.add_column("account_settings", sa.Column("weight_goal", sa.String(length=8), nullable=True))
    if "target_weight" not in columns:
        op.add_column("account_settings", sa.Column("target_weight", sa.Float(), nullable=True))


def downgrade():
    op.drop_column("account_settings", "target_weight")
    op.drop_column("account_settings", "weight_goal")
