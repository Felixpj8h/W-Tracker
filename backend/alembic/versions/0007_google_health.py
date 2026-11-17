"""Private Google Health connection and expiring OAuth attempts."""
from alembic import op
from app.main import HealthConnection, HealthOAuthAttempt

revision = "0007_google_health"
down_revision = "0006_security_boundaries"
branch_labels = None
depends_on = None


def upgrade():
    for model in (HealthConnection, HealthOAuthAttempt):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    HealthOAuthAttempt.__table__.drop(op.get_bind())
    HealthConnection.__table__.drop(op.get_bind())
