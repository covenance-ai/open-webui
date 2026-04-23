"""Add coach_policy.explanation_url

Revision ID: c0ac40c0f1d1
Revises: c0ac40c0f1d0
Create Date: 2026-04-23 00:00:00.000000

Optional hyperlink per policy, shown in the block banner when that
policy fires. For the demo seed we backfill the hiring policy with a
Wikipedia link to the EU AI Act (see storage.py
DEFAULT_HIRING_POLICY_EXPLANATION_URL).
"""

import sqlalchemy as sa
from alembic import op

revision = 'c0ac40c0f1d1'
down_revision = 'c0ac40c0f1d0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'coach_policy',
        sa.Column('explanation_url', sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column('coach_policy', 'explanation_url')
