"""Add coach_policy table

Revision ID: c0ac40c0f1c1
Revises: c0ac40c0f1c0
Create Date: 2026-04-16 18:00:00.000000

Coach fork — second coach-specific migration. Creates `coach_policy`.

Ownership model:
- ``user_id`` non-null  → personal policy owned by that user.
- ``user_id`` NULL + ``is_shared`` TRUE → admin-published; visible to all.
"""

from alembic import op
import sqlalchemy as sa

# Revision identifiers, used by Alembic.
revision = 'c0ac40c0f1c1'
down_revision = 'c0ac40c0f1c0'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'coach_policy',
        sa.Column('id', sa.Text(), primary_key=True),
        sa.Column('user_id', sa.Text(), nullable=True),
        sa.Column(
            'is_shared', sa.Boolean(), nullable=False, server_default=sa.text('false')
        ),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False),
    )
    op.create_index('coach_policy_user_id_idx', 'coach_policy', ['user_id'])
    op.create_index('coach_policy_is_shared_idx', 'coach_policy', ['is_shared'])


def downgrade():
    op.drop_index('coach_policy_is_shared_idx', table_name='coach_policy')
    op.drop_index('coach_policy_user_id_idx', table_name='coach_policy')
    op.drop_table('coach_policy')
