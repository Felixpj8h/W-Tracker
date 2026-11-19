"""Store AI Coach output length by account."""
from alembic import op
from app.main import AccountSettings

revision = "0008_account_settings"
down_revision = "0007_google_health"
branch_labels = None
depends_on = None


def upgrade():
    AccountSettings.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    AccountSettings.__table__.drop(op.get_bind())
