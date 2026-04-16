"""Pydantic request/response schemas for the Coach API."""

from typing import Optional

from pydantic import BaseModel, ConfigDict


class CoachConfigResponse(BaseModel):
    user_id: str
    enabled: bool
    coach_model_id: Optional[str] = None
    active_policy_ids: list[str]
    created_at: int
    updated_at: int

    model_config = ConfigDict(from_attributes=True)


class CoachConfigForm(BaseModel):
    """Partial update. Only non-None fields are applied."""

    enabled: Optional[bool] = None
    coach_model_id: Optional[str] = None
    active_policy_ids: Optional[list[str]] = None
