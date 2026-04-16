"""Access object for coach_config (and, in later phases, coach_policy)."""

import time
from typing import Optional

from sqlalchemy.orm import Session

from open_webui.coach.models import CoachConfig
from open_webui.coach.schemas import CoachConfigForm, CoachConfigResponse
from open_webui.internal.db import get_db_context


class CoachConfigTable:
    def get_or_default(
        self, user_id: str, db: Optional[Session] = None
    ) -> CoachConfigResponse:
        """Return this user's config, creating a disabled default row if absent."""
        with get_db_context(db) as db:
            row = db.query(CoachConfig).filter_by(user_id=user_id).first()
            if row is None:
                now = int(time.time())
                row = CoachConfig(
                    user_id=user_id,
                    enabled=False,
                    coach_model_id=None,
                    active_policy_ids=[],
                    created_at=now,
                    updated_at=now,
                )
                db.add(row)
                db.commit()
                db.refresh(row)
            return CoachConfigResponse.model_validate(row)

    def upsert(
        self,
        user_id: str,
        form: CoachConfigForm,
        db: Optional[Session] = None,
    ) -> CoachConfigResponse:
        """Create or update. Fields set to None in ``form`` are left untouched."""
        with get_db_context(db) as db:
            row = db.query(CoachConfig).filter_by(user_id=user_id).first()
            now = int(time.time())
            if row is None:
                row = CoachConfig(
                    user_id=user_id,
                    enabled=form.enabled if form.enabled is not None else False,
                    coach_model_id=form.coach_model_id,
                    active_policy_ids=form.active_policy_ids or [],
                    created_at=now,
                    updated_at=now,
                )
                db.add(row)
            else:
                if form.enabled is not None:
                    row.enabled = form.enabled
                if form.coach_model_id is not None:
                    row.coach_model_id = form.coach_model_id
                if form.active_policy_ids is not None:
                    row.active_policy_ids = form.active_policy_ids
                row.updated_at = now
            db.commit()
            db.refresh(row)
            return CoachConfigResponse.model_validate(row)


CoachConfigs = CoachConfigTable()
