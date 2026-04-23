"""Merge upstream shared_chat head into coach branch

Revision ID: c0ac40c0f1d0
Revises: c0ac40c0f1c2, c1d2e3f4a5b6
Create Date: 2026-04-23 00:00:00.000000

Empty merge migration. When we rebased the coach branch onto
upstream/main (for v0.9.1), alembic ended up with two heads:
  - c0ac40c0f1c2 (our coach tip: demo_mode)
  - c1d2e3f4a5b6 (upstream's shared_chat_table)

`alembic upgrade head` requires a single head. This migration does
nothing but declare both as its parents, so the graph collapses again.

Same pattern as the original c0ac40c0f1c0 which merged two earlier
upstream heads; see COACH.md.
"""

# Revision identifiers, used by Alembic.
revision = 'c0ac40c0f1d0'
down_revision = ('c0ac40c0f1c2', 'c1d2e3f4a5b6')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
