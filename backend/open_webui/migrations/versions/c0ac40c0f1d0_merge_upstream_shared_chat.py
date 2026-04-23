"""Merge upstream head into coach branch

Revision ID: c0ac40c0f1d0
Revises: c0ac40c0f1c2, 56359461a091
Create Date: 2026-04-23 00:00:00.000000

Empty merge migration. When we rebased the coach branch onto
upstream/main (for v0.9.1), alembic ended up with two heads:
  - c0ac40c0f1c2 (our coach tip: demo_mode)
  - 56359461a091 (upstream tip: calendar tables, extending through
                  shared_chat -> is_pinned_to_note -> last_read_at ->
                  automations -> tasks_and_summary -> scim_column)

`alembic upgrade head` requires a single head. This migration does
nothing but declare both as its parents, so the graph collapses again.

Same pattern as the original c0ac40c0f1c0 which merged two earlier
upstream heads; see COACH.md.

To find the upstream tip after a future rebase: look for any migration
whose revision id does NOT appear as a down_revision in any other file.
Mind that some files use `revision: str = '...'` (type-annotated) and
others use bare `revision = '...'` — parser regex must match both.
"""

# Revision identifiers, used by Alembic.
revision = 'c0ac40c0f1d0'
down_revision = ('c0ac40c0f1c2', '56359461a091')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
