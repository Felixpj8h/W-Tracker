"""Create the clean multi-user schema.

Revision ID: 0001_secure_multi_user
Revises: None
"""
from alembic import op

from app.main import Base


revision = "0001_secure_multi_user"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The pre-deployment database is explicitly disposable test data. Building
    # from metadata keeps this baseline identical to the application schema.
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
