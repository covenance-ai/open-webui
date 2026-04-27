"""SQLAlchemy ORM tables for Coach."""

from sqlalchemy import BigInteger, Boolean, Column, JSON, Text

from open_webui.internal.db import Base


class CoachConfig(Base):
    """Per-user coach configuration.

    One row per user. ``active_policy_ids`` is a JSON list of policy ids
    (union of personal and shared) that the user has switched on.
    """

    __tablename__ = 'coach_config'

    user_id = Column(Text, primary_key=True)
    enabled = Column(Boolean, nullable=False, default=False)
    # Admin-controlled gate. When false, the coach short-circuits in
    # service.run_core regardless of the user's own ``enabled`` flag and
    # the frontend disables the user-facing toggles. Default true so a
    # newly-promoted user gets coach access until an admin says otherwise.
    access_enabled = Column(Boolean, nullable=False, default=True)
    demo_mode = Column(Boolean, nullable=False, default=False)
    coach_model_id = Column(Text, nullable=True)
    active_policy_ids = Column(JSON, nullable=False, default=list)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)


class CoachPolicy(Base):
    """A natural-language coach policy.

    ``user_id`` IS NULL (and ``is_shared`` TRUE) → admin-published, visible
    to everyone. Non-null ``user_id`` → personal policy owned by that user.
    """

    __tablename__ = 'coach_policy'

    id = Column(Text, primary_key=True)
    user_id = Column(Text, nullable=True, index=True)
    is_shared = Column(Boolean, nullable=False, default=False, index=True)
    title = Column(Text, nullable=False)
    body = Column(Text, nullable=False)
    # Optional URL the user can follow for a full explanation when a policy
    # fires (e.g. a Wikipedia article, a regulation page, an internal wiki).
    # Rendered by the frontend as a hyperlink in the block banner.
    explanation_url = Column(Text, nullable=True)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)
