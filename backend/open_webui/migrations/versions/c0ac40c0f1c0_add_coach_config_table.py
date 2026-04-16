"""Add coach_config table (and merge the two upstream heads)

Revision ID: c0ac40c0f1c0
Revises: 018012973d35, b2c3d4e5f6a7
Create Date: 2026-04-16 17:30:00.000000

Coach fork — first coach-specific migration. Serves double duty:
1. Creates `coach_config` (per-user coach settings).
2. Merges upstream's two heads (`018012973d35` add_indexes and
   `b2c3d4e5f6a7` add_scim_column_to_user_table) so `alembic upgrade head`
   unambiguously reaches a single tip.

See COACH.md at the fork root. `user_id` is the primary key (1:1 per
user, upserted on save).
"""

from alembic import op
import sqlalchemy as sa

# Revision identifiers, used by Alembic.
revision = 'c0ac40c0f1c0'
down_revision = ('018012973d35', 'b2c3d4e5f6a7')
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'coach_config',
        sa.Column('user_id', sa.Text(), primary_key=True),
        sa.Column(
            'enabled', sa.Boolean(), nullable=False, server_default=sa.text('false')
        ),
        sa.Column('coach_model_id', sa.Text(), nullable=True),
        sa.Column('active_policy_ids', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False),
    )


def downgrade():
    op.drop_table('coach_config')
