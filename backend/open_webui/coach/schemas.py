"""Pydantic request/response schemas for the Coach API."""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class CoachConfigResponse(BaseModel):
    user_id: str
    enabled: bool
    demo_mode: bool = False
    coach_model_id: Optional[str] = None
    active_policy_ids: list[str]
    created_at: int
    updated_at: int

    model_config = ConfigDict(from_attributes=True)


class CoachConfigForm(BaseModel):
    """Partial update. Only non-None fields are applied."""

    enabled: Optional[bool] = None
    demo_mode: Optional[bool] = None
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


# ─── Evaluate ──────────────────────────────────────────────────────────


class ConversationTurn(BaseModel):
    role: str  # 'user' | 'assistant' | 'system'
    content: str
    coach_authored: bool = False


class EvaluateRequest(BaseModel):
    chat_id: Optional[str] = None
    message_id: Optional[str] = None
    conversation: list[ConversationTurn]


class EvaluateResponse(BaseModel):
    """Coach verdict. One of three actions, with the optional payload for
    `flag` and `followup`. `action=none` means nothing to do; frontend
    renders nothing."""

    action: str  # 'none' | 'flag' | 'followup'
    policy_id: Optional[str] = None
    severity: Optional[str] = None  # 'info' | 'warn' | 'critical'
    rationale: Optional[str] = None
    followup_text: Optional[str] = None


class CoachEventResponse(BaseModel):
    """One row of the evaluation activity log (see coach.events)."""

    id: str
    user_id: str
    ts_ms: int
    status: str  # 'ok' | 'error' | 'skipped' | 'demo'
    action: Optional[str] = None
    reason: Optional[str] = None
    model_id: Optional[str] = None
    policy_count: int
    duration_ms: int
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    error: Optional[str] = None
    chat_id: Optional[str] = None
    message_id: Optional[str] = None
