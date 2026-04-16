"""Access objects for coach_config and coach_policy."""

import time
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from open_webui.coach.models import CoachConfig, CoachPolicy
from open_webui.coach.schemas import (
    CoachConfigForm,
    CoachConfigResponse,
    CoachPolicyCreateForm,
    CoachPolicyResponse,
    CoachPolicyUpdateForm,
)
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


class CoachPolicyTable:
    def list_visible(
        self, user_id: str, db: Optional[Session] = None
    ) -> list[CoachPolicyResponse]:
        """All policies this user can see: own personal + all shared."""
        with get_db_context(db) as db:
            rows = (
                db.query(CoachPolicy)
                .filter(
                    (CoachPolicy.user_id == user_id) | (CoachPolicy.is_shared.is_(True))
                )
                .order_by(CoachPolicy.is_shared.desc(), CoachPolicy.updated_at.desc())
                .all()
            )
            return [CoachPolicyResponse.model_validate(r) for r in rows]

    def get_by_id(
        self, policy_id: str, db: Optional[Session] = None
    ) -> Optional[CoachPolicyResponse]:
        with get_db_context(db) as db:
            row = db.query(CoachPolicy).filter_by(id=policy_id).first()
            return CoachPolicyResponse.model_validate(row) if row else None

    def create_personal(
        self,
        user_id: str,
        form: CoachPolicyCreateForm,
        db: Optional[Session] = None,
    ) -> CoachPolicyResponse:
        with get_db_context(db) as db:
            now = int(time.time())
            row = CoachPolicy(
                id=str(uuid.uuid4()),
                user_id=user_id,
                is_shared=False,
                title=form.title,
                body=form.body,
                created_at=now,
                updated_at=now,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return CoachPolicyResponse.model_validate(row)

    def update(
        self,
        policy_id: str,
        form: CoachPolicyUpdateForm,
        db: Optional[Session] = None,
    ) -> Optional[CoachPolicyResponse]:
        with get_db_context(db) as db:
            row = db.query(CoachPolicy).filter_by(id=policy_id).first()
            if row is None:
                return None
            if form.title is not None:
                row.title = form.title
            if form.body is not None:
                row.body = form.body
            row.updated_at = int(time.time())
            db.commit()
            db.refresh(row)
            return CoachPolicyResponse.model_validate(row)

    def delete(self, policy_id: str, db: Optional[Session] = None) -> bool:
        with get_db_context(db) as db:
            row = db.query(CoachPolicy).filter_by(id=policy_id).first()
            if row is None:
                return False
            db.delete(row)
            db.commit()
            return True

    def set_shared(
        self,
        policy_id: str,
        is_shared: bool,
        db: Optional[Session] = None,
    ) -> Optional[CoachPolicyResponse]:
        """Admin-only: promote a personal policy to shared, or vice versa.

        When sharing, ``user_id`` is cleared so the policy loses its owner.
        Unsharing is destructive of that attribution; a previously-shared
        policy that is unshared becomes an orphan unless the caller also
        reassigns ``user_id`` (not yet exposed in the API).
        """
        with get_db_context(db) as db:
            row = db.query(CoachPolicy).filter_by(id=policy_id).first()
            if row is None:
                return None
            row.is_shared = is_shared
            if is_shared:
                row.user_id = None
            row.updated_at = int(time.time())
            db.commit()
            db.refresh(row)
            return CoachPolicyResponse.model_validate(row)


CoachPolicies = CoachPolicyTable()
