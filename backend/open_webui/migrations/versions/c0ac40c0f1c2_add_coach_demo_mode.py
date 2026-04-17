"""Add demo_mode column to coach_config

Revision ID: c0ac40c0f1c2
Revises: c0ac40c0f1c1
Create Date: 2026-04-17 07:30:00.000000

When demo_mode is true, coach.service bypasses the LLM and emits
scripted verdicts keyed off the last user message (see coach.service).
We persist the flag on coach_config so it survives restarts and follows
the user across sessions — essential for rehearsed demos.
"""

from alembic import op
import sqlalchemy as sa


revision = 'c0ac40c0f1c2'
down_revision = 'c0ac40c0f1c1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'coach_config',
        sa.Column(
            'demo_mode',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )


def downgrade():
    op.drop_column('coach_config', 'demo_mode')
