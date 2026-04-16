"""Coach evaluation — the hot path behind POST /api/v1/coach/evaluate.

Given the calling user + a conversation transcript, returns one of:
- action=none — no-op.
- action=flag — attach a non-blocking annotation to the assistant message.
- action=followup — emit a user-style follow-up the frontend should send.

The coach picks at most one policy hit per message. Infinite-loop
protection downgrades `followup` to `flag` if the preceding user turn is
already coach-authored (to avoid a chain of auto-corrections).
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from open_webui.coach.prompts import build_evaluation_prompt
from open_webui.coach.schemas import (
    ConversationTurn,
    CoachPolicyResponse,
    EvaluateResponse,
)
from open_webui.coach.storage import CoachConfigs, CoachPolicies

log = logging.getLogger(__name__)

_VALID_ACTIONS = {'none', 'flag', 'followup'}
_VALID_SEVERITIES = {'info', 'warn', 'critical', None}


def _noop() -> EvaluateResponse:
    return EvaluateResponse(action='none')


def _loop_protection_violated(conversation: list[ConversationTurn]) -> bool:
    """True if the preceding user message is already coach-authored.

    We look for the latest user turn. The assistant turn we're evaluating
    is normally the last element; for robustness we allow any trailing
    position.
    """
    for t in reversed(conversation):
        if t.role == 'user':
            return t.coach_authored
    return False


def parse_verdict(raw: str, valid_policy_ids: set[str]) -> EvaluateResponse:
    """Parse a coach LLM reply into an EvaluateResponse.

    Malformed output → action=none (logged). Unknown ``policy_id`` is
    dropped to null rather than failing the whole verdict. This function is
    deliberately resilient: its inputs are untrusted LLM strings.
    """
    if not raw or not isinstance(raw, str):
        return _noop()

    # Find the first JSON object in the response. LLMs sometimes wrap JSON
    # in prose even when told not to.
    match = re.search(r'\{.*\}', raw, flags=re.DOTALL)
    if not match:
        log.debug('coach: no JSON object in LLM reply')
        return _noop()

    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        log.debug('coach: JSON parse failed: %s', exc)
        return _noop()

    if not isinstance(data, dict):
        return _noop()

    action = data.get('action')
    if action not in _VALID_ACTIONS:
        return _noop()

    # Normalise: drop unknown policy_ids.
    policy_id = data.get('policy_id')
    if policy_id is not None and policy_id not in valid_policy_ids:
        policy_id = None

    severity = data.get('severity')
    if severity not in _VALID_SEVERITIES:
        severity = None

    rationale = data.get('rationale')
    if rationale is not None and not isinstance(rationale, str):
        rationale = None

    followup_text = data.get('followup_text')
    if followup_text is not None and not isinstance(followup_text, str):
        followup_text = None

    # Defensive: followup without text is useless; flag without rationale is
    # worthless. Fall back to none.
    if action == 'followup' and not (followup_text and followup_text.strip()):
        return _noop()
    if action == 'flag' and not (rationale and rationale.strip()):
        return _noop()

    return EvaluateResponse(
        action=action,
        policy_id=policy_id,
        severity=severity,
        rationale=rationale,
        followup_text=followup_text,
    )


async def evaluate(
    *,
    user_id: str,
    user_role: str,
    conversation: list[ConversationTurn],
    llm_caller,  # async callable: (model_id, messages) -> str (assistant content)
) -> EvaluateResponse:
    """Run one evaluation cycle for the given user + conversation.

    ``llm_caller`` is injected so tests can mock it and so the router can
    pass the real in-process ``utils.chat.generate_chat_completion`` adapter
    without this module taking a hard dep on FastAPI Request objects.
    """
    if not conversation:
        return _noop()

    cfg = CoachConfigs.get_or_default(user_id)
    if not cfg.enabled or not cfg.coach_model_id or not cfg.active_policy_ids:
        return _noop()

    # Load the active policies visible to this user (union of personal + shared).
    visible = {p.id: p for p in CoachPolicies.list_visible(user_id)}
    active: list[CoachPolicyResponse] = [visible[pid] for pid in cfg.active_policy_ids if pid in visible]
    if not active:
        # User activated ids that have since been deleted / unshared. No-op.
        return _noop()

    messages = build_evaluation_prompt(active, conversation)
    try:
        reply = await llm_caller(cfg.coach_model_id, messages)
    except Exception as exc:
        log.warning('coach: LLM call failed: %s', exc)
        return _noop()

    verdict = parse_verdict(reply or '', {p.id for p in active})

    # Loop protection: never chain a follow-up on top of a coach-authored one.
    if verdict.action == 'followup' and _loop_protection_violated(conversation):
        log.debug('coach: loop-protection downgrade followup → flag')
        return EvaluateResponse(
            action='flag',
            policy_id=verdict.policy_id,
            severity=verdict.severity or 'warn',
            rationale=(
                verdict.rationale
                or 'Coach already suggested a correction; skipping further follow-ups.'
            ),
            followup_text=None,
        )

    return verdict
