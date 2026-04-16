"""Pydantic request/response schemas for the Coach API."""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


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


class CoachPolicyResponse(BaseModel):
    id: str
    user_id: Optional[str] = None
    is_shared: bool
    title: str
    body: str
    created_at: int
    updated_at: int

    model_config = ConfigDict(from_attributes=True)


class CoachPolicyCreateForm(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=5000)


class CoachPolicyUpdateForm(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    body: Optional[str] = Field(default=None, min_length=1, max_length=5000)
