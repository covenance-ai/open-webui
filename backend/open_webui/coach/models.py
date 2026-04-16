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
    coach_model_id = Column(Text, nullable=True)
    active_policy_ids = Column(JSON, nullable=False, default=list)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)
