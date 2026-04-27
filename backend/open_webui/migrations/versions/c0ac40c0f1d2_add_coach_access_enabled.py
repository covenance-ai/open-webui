"""Add access_enabled column to coach_config

Revision ID: c0ac40c0f1d2
Revises: c0ac40c0f1d1
Create Date: 2026-04-27 00:00:00.000000

Admin-controlled per-user gate. When ``access_enabled=false`` the coach
short-circuits server-side regardless of the user's own ``enabled`` flag,
and the frontend disables the user-facing toggle. Default ``true`` so
existing users keep working after the migration.
"""

from alembic import op
import sqlalchemy as sa


revision = 'c0ac40c0f1d2'
down_revision = 'c0ac40c0f1d1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'coach_config',
        sa.Column(
            'access_enabled',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('true'),
        ),
    )


def downgrade():
    op.drop_column('coach_config', 'access_enabled')
