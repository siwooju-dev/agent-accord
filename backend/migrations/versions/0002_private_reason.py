"""Keep seller model explanations private; public API uses safe descriptions."""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("proposals", sa.Column("private_reason", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("proposals", "private_reason")
