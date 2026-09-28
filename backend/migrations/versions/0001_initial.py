"""Initial DealBattle v2 schema (frozen; does not import application metadata)."""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('auth_sessions',
        sa.Column('token_hash', sa.String(length=64), nullable=False, primary_key=True),
        sa.Column('owner', sa.String(length=80), nullable=False, primary_key=False),
        sa.Column('csrf', sa.String(length=80), nullable=False, primary_key=False),
        sa.Column('expires_at', sa.String(length=40), nullable=False, primary_key=False),
    )
    op.create_table('chain_nonces',
        sa.Column('key', sa.String(length=100), nullable=False, primary_key=True),
        sa.Column('next_nonce', sa.Integer(), nullable=False, primary_key=False),
    )
    op.create_table('idempotency',
        sa.Column('id', sa.String(length=32), nullable=False, primary_key=True),
        sa.Column('owner', sa.String(length=80), nullable=False, primary_key=False),
        sa.Column('scope', sa.String(length=150), nullable=False, primary_key=False),
        sa.Column('key', sa.String(length=128), nullable=False, primary_key=False),
        sa.Column('digest', sa.String(length=64), nullable=False, primary_key=False),
        sa.Column('result_id', sa.String(length=32), nullable=False, primary_key=False),
        sa.UniqueConstraint('owner', 'scope', 'key'),
    )
    op.create_table('products',
        sa.Column('id', sa.String(length=80), nullable=False, primary_key=True),
        sa.Column('data', sa.JSON(), nullable=False, primary_key=False),
        sa.Column('stock', sa.Integer(), nullable=False, primary_key=False),
    )
    op.create_table('proposals',
        sa.Column('id', sa.String(length=32), nullable=False, primary_key=True),
        sa.Column('data', sa.JSON(), nullable=False, primary_key=False),
    )
    op.create_table('deals',
        sa.Column('id', sa.String(length=32), nullable=False, primary_key=True),
        sa.Column('owner', sa.String(length=80), nullable=False, primary_key=False),
        sa.Column('product_id', sa.String(length=80), sa.ForeignKey('products.id'), nullable=False, primary_key=False),
        sa.Column('policy_version', sa.Integer(), nullable=False, primary_key=False),
        sa.Column('confirmed', sa.Boolean(), nullable=False, primary_key=False),
        sa.Column('status', sa.String(length=40), nullable=False, primary_key=False),
        sa.Column('reasons', sa.JSON(), nullable=False, primary_key=False),
        sa.Column('created_at', sa.String(length=40), nullable=False, primary_key=False),
    )
    op.create_index('ix_deals_owner', 'deals', ['owner'], unique=False)
    op.create_table('seller_policies',
        sa.Column('product_id', sa.String(length=80), sa.ForeignKey('products.id'), nullable=False, primary_key=True),
        sa.Column('seller_id', sa.String(length=80), nullable=False, primary_key=False),
        sa.Column('version', sa.Integer(), nullable=False, primary_key=False),
        sa.Column('floor', sa.Integer(), nullable=False, primary_key=False),
    )
    op.create_table('agreements',
        sa.Column('id', sa.String(length=32), nullable=False, primary_key=True),
        sa.Column('deal_id', sa.String(length=32), sa.ForeignKey('deals.id'), nullable=False, primary_key=False),
        sa.Column('policy_version', sa.Integer(), nullable=False, primary_key=False),
        sa.Column('snapshot', sa.JSON(), nullable=False, primary_key=False),
        sa.Column('snapshot_hash', sa.String(length=64), nullable=False, primary_key=False),
        sa.Column('valid', sa.Boolean(), nullable=False, primary_key=False),
        sa.UniqueConstraint('deal_id', 'policy_version'),
    )
    op.create_index('ix_agreements_deal_id', 'agreements', ['deal_id'], unique=False)
    op.create_table('audit_events',
        sa.Column('id', sa.String(length=32), nullable=False, primary_key=True),
        sa.Column('deal_id', sa.String(length=32), sa.ForeignKey('deals.id'), nullable=False, primary_key=False),
        sa.Column('event_type', sa.String(length=40), nullable=False, primary_key=False),
        sa.Column('policy_version', sa.Integer(), nullable=False, primary_key=False),
        sa.Column('details', sa.JSON(), nullable=False, primary_key=False),
        sa.Column('created_at', sa.String(length=40), nullable=False, primary_key=False),
    )
    op.create_index('ix_audit_events_deal_id', 'audit_events', ['deal_id'], unique=False)
    op.create_table('buyer_policies',
        sa.Column('id', sa.String(length=32), nullable=False, primary_key=True),
        sa.Column('deal_id', sa.String(length=32), sa.ForeignKey('deals.id'), nullable=False, primary_key=False),
        sa.Column('version', sa.Integer(), nullable=False, primary_key=False),
        sa.Column('data', sa.JSON(), nullable=False, primary_key=False),
        sa.UniqueConstraint('deal_id', 'version'),
    )
    op.create_index('ix_buyer_policies_deal_id', 'buyer_policies', ['deal_id'], unique=False)
    op.create_table('model_usage',
        sa.Column('id', sa.String(length=32), nullable=False, primary_key=True),
        sa.Column('deal_id', sa.String(length=32), sa.ForeignKey('deals.id'), nullable=False, primary_key=False),
        sa.Column('data', sa.JSON(), nullable=False, primary_key=False),
        sa.Column('created_at', sa.String(length=40), nullable=False, primary_key=False),
    )
    op.create_index('ix_model_usage_deal_id', 'model_usage', ['deal_id'], unique=False)
    op.create_table('negotiations',
        sa.Column('id', sa.String(length=32), nullable=False, primary_key=True),
        sa.Column('deal_id', sa.String(length=32), sa.ForeignKey('deals.id'), nullable=False, primary_key=False),
        sa.Column('policy_version', sa.Integer(), nullable=False, primary_key=False),
        sa.Column('status', sa.String(length=30), nullable=False, primary_key=False),
        sa.UniqueConstraint('deal_id', 'policy_version'),
    )
    op.create_table('rounds',
        sa.Column('id', sa.String(length=32), nullable=False, primary_key=True),
        sa.Column('deal_id', sa.String(length=32), sa.ForeignKey('deals.id'), nullable=False, primary_key=False),
        sa.Column('proposal_id', sa.String(length=32), sa.ForeignKey('proposals.id'), nullable=True, primary_key=False),
        sa.Column('policy_version', sa.Integer(), nullable=False, primary_key=False),
        sa.Column('number', sa.Integer(), nullable=False, primary_key=False),
        sa.Column('actor', sa.String(length=10), nullable=False, primary_key=False),
        sa.Column('decision', sa.JSON(), nullable=False, primary_key=False),
        sa.Column('valid', sa.Boolean(), nullable=False, primary_key=False),
        sa.Column('created_at', sa.String(length=40), nullable=False, primary_key=False),
        sa.UniqueConstraint('deal_id', 'policy_version', 'number'),
    )
    op.create_index('ix_rounds_deal_id', 'rounds', ['deal_id'], unique=False)
    op.create_table('approvals',
        sa.Column('id', sa.String(length=32), nullable=False, primary_key=True),
        sa.Column('agreement_id', sa.String(length=32), sa.ForeignKey('agreements.id'), nullable=False, primary_key=False),
        sa.Column('owner', sa.String(length=80), nullable=False, primary_key=False),
        sa.Column('snapshot_hash', sa.String(length=64), nullable=False, primary_key=False),
        sa.Column('valid', sa.Boolean(), nullable=False, primary_key=False),
        sa.Column('created_at', sa.String(length=40), nullable=False, primary_key=False),
        sa.UniqueConstraint('agreement_id'),
    )
    op.create_table('chain_records',
        sa.Column('id', sa.String(length=64), nullable=False, primary_key=True),
        sa.Column('deal_id', sa.String(length=32), sa.ForeignKey('deals.id'), nullable=False, primary_key=False),
        sa.Column('agreement_id', sa.String(length=32), sa.ForeignKey('agreements.id'), nullable=False, primary_key=False),
        sa.Column('audit_hash', sa.String(length=64), nullable=False, primary_key=False),
        sa.Column('status', sa.String(length=30), nullable=False, primary_key=False),
        sa.Column('data', sa.JSON(), nullable=False, primary_key=False),
        sa.Column('raw_tx', sa.Text(), nullable=True, primary_key=False),
        sa.UniqueConstraint('agreement_id'),
        sa.UniqueConstraint('deal_id'),
    )

def downgrade():
    op.drop_table('chain_records')
    op.drop_table('approvals')
    op.drop_table('rounds')
    op.drop_table('negotiations')
    op.drop_table('model_usage')
    op.drop_table('buyer_policies')
    op.drop_table('audit_events')
    op.drop_table('agreements')
    op.drop_table('seller_policies')
    op.drop_table('deals')
    op.drop_table('proposals')
    op.drop_table('products')
    op.drop_table('idempotency')
    op.drop_table('chain_nonces')
    op.drop_table('auth_sessions')
