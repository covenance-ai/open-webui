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
    # 'post' (default) — evaluate the assistant's last reply.
    # 'pre'            — screen a pending user query before it reaches the LLM.
    phase: str = 'post'


class EvaluateResponse(BaseModel):
    """Coach verdict.

    Post-flight actions: 'none' | 'flag' | 'followup'.
    Pre-flight actions:  'none' | 'block' (block requires a rationale).

    `action=none` means nothing to do; frontend renders nothing.
    """

    action: str
    policy_id: Optional[str] = None
    severity: Optional[str] = None  # 'info' | 'warn' | 'critical'
    rationale: Optional[str] = None
    followup_text: Optional[str] = None


class CoachPolicySnapshot(BaseModel):
    """Minimal policy view embedded in event details."""

    id: str
    title: str
    body: str
    is_shared: bool = False


class CoachEventDetailResponse(BaseModel):
    """Full payload for one evaluation — everything the coach saw + produced.

    Powers the activity detail drawer and the /dry-run endpoint.
    """

    id: str
    user_id: Optional[str] = None
    ts_ms: int
    status: str  # 'ok' | 'error' | 'skipped' | 'demo'
    action: Optional[str] = None
    reason: Optional[str] = None
    model_id: Optional[str] = None
    duration_ms: int
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    error: Optional[str] = None
    demo: bool = False

    rendered_prompt: list[dict]
    raw_reply: Optional[str] = None
    verdict: dict
    active_policies: list[CoachPolicySnapshot]
    conversation: list[dict]


class DryRunRequest(BaseModel):
    """Evaluate a hypothetical transcript without persisting anything.

    All overrides are optional; None falls back to the caller's stored
    config. policy_ids=[] forces an empty active set (useful for "what
    if the user had no policies?" sanity checks).
    """

    conversation: list[ConversationTurn]
    policy_ids: Optional[list[str]] = None
    coach_model_id: Optional[str] = None
    demo_mode: Optional[bool] = None
    enabled: Optional[bool] = None  # override the on/off switch for one-off runs
    phase: str = 'post'  # 'pre' | 'post'


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
