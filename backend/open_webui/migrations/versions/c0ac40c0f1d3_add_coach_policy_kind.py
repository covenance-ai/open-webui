"""Add coach_policy.kind

Revision ID: c0ac40c0f1d3
Revises: c0ac40c0f1d2
Create Date: 2026-05-04 00:00:00.000000

`kind` is the policy's family — one of {block, flag, intervene} — and
determines which action the policy emits when it fires:

  block      pre-flight gate; user message refused before LLM
  flag       post-flight warning; LLM replies but is annotated
  intervene  post-flight auto-correct; coach sends a follow-up prompt

Existing rows get the safe default 'flag' (post-flight, non-blocking).
The canonical seeded hiring policy is migrated to 'block' since its
text describes a refusal-style rule (and that's how demo mode treats it
via _HIRING_KEYWORDS).
"""

import sqlalchemy as sa
from alembic import op


revision = 'c0ac40c0f1d3'
down_revision = 'c0ac40c0f1d2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'coach_policy',
        sa.Column('kind', sa.Text(), nullable=False, server_default='flag'),
    )
    # Promote the canonical hiring policy to 'block'. Match by title;
    # if it's been renamed since seeding, the post-deploy seed step in
    # storage._ensure_default_shared_policies will be a no-op (already
    # seeded) and ops will fix kind manually if they care.
    op.execute(
        "UPDATE coach_policy SET kind='block' "
        "WHERE title='No LLM for hiring decisions'"
    )


def downgrade():
    op.drop_column('coach_policy', 'kind')
