"""Coach evaluation — the hot path behind POST /api/v1/coach/evaluate.

Given the calling user + a conversation transcript, returns one of:
- action=none — no-op.
- action=flag — attach a non-blocking annotation to the assistant message.
- action=followup — emit a user-style follow-up the frontend should send.

The coach picks at most one policy hit per message. Infinite-loop
protection downgrades `followup` to `flag` if the preceding user turn is
already coach-authored (to avoid a chain of auto-corrections).

Observability: ``evaluate`` optionally takes ``event_sink``; when
provided, it is invoked exactly once per call with an ``EvalTrace`` that
captures everything the coach saw and produced — rendered prompt, raw
LLM reply, active policies, final verdict. The router uses this to
populate the detail ring (coach.events.record_detail) so the frontend
can show prompt + reply + parsed output for any row in the activity log.

The pure algorithm is extracted into ``run_core`` so the /dry-run
endpoint can reuse it with caller-supplied overrides (a different
policy set, a different model, demo mode on/off) without writing
anything to storage.

Demo mode: when ``CoachConfig.demo_mode`` is set, run_core skips the LLM
entirely and emits a scripted verdict based on the last user turn (see
``_scripted_verdict``). Intended for live demos so the behaviour is
predictable and independent of upstream availability.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Callable, Optional

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


@dataclass
class EvalTrace:
    """Structured trace of one evaluate() call.

    Everything the coach saw and produced — enough for the router to
    populate both the headline activity row (status, action, tokens,
    duration — the router adds those) and the detail view (prompt, raw
    reply, verdict, policies).
    """

    llm_called: bool = False
    model_id: Optional[str] = None
    policy_count: int = 0
    skip_reason: Optional[str] = None  # set when action==none was forced pre-LLM
    llm_error: Optional[str] = None
    demo: bool = False
    # Detail-view fields:
    rendered_prompt: list[dict] = field(default_factory=list)
    raw_reply: Optional[str] = None
    verdict_dict: dict = field(default_factory=dict)
    active_policies: list[dict] = field(default_factory=list)
    conversation: list[dict] = field(default_factory=list)


EventSink = Callable[[EvalTrace], None]


def _noop() -> EvaluateResponse:
    return EvaluateResponse(action='none')


def _conversation_snapshot(conversation: list[ConversationTurn]) -> list[dict]:
    return [
        {
            'role': t.role,
            'content': t.content,
            'coach_authored': bool(t.coach_authored),
        }
        for t in conversation
    ]


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


# ─── Demo mode ─────────────────────────────────────────────────────────

# Per-user rotation counters for the fallback script. Keeps the demo
# deterministic across a single process life.
_DEMO_COUNTERS: dict[str, int] = {}
_DEMO_COUNTERS_LOCK = Lock()


def _next_demo_index(user_id: str) -> int:
    with _DEMO_COUNTERS_LOCK:
        n = _DEMO_COUNTERS.get(user_id, 0)
        _DEMO_COUNTERS[user_id] = n + 1
        return n


_DEMO_ROTATION = (
    EvaluateResponse(
        action='flag',
        severity='warn',
        rationale='Demo flag: this would be a real coach concern.',
    ),
    EvaluateResponse(
        action='followup',
        followup_text='(demo) please add one concrete example to your answer.',
    ),
    EvaluateResponse(action='none'),
)


def _scripted_verdict(
    user_id: str, conversation: list[ConversationTurn]
) -> EvaluateResponse:
    """Produce a demo-mode verdict.

    Triggered by keywords in the latest user message so a demonstrator can
    target a specific behaviour on cue:

    - ``demo:flag``     → a 'warn' flag.
    - ``demo:critical`` → a 'critical' flag.
    - ``demo:followup`` → a coach-authored follow-up message.
    - ``demo:none``     → silent no-op.

    Anything else rotates flag → followup → none per-user so every third
    turn exercises a different branch. That rotation is what lets a live
    demo show all three UI behaviours without memorising trigger words.
    """
    last_user = next(
        (t.content for t in reversed(conversation) if t.role == 'user'),
        '',
    )
    text = (last_user or '').lower()

    if 'demo:none' in text:
        return EvaluateResponse(action='none')
    if 'demo:critical' in text:
        return EvaluateResponse(
            action='flag',
            severity='critical',
            rationale='Demo critical flag: simulating a high-severity policy hit.',
        )
    if 'demo:flag' in text:
        return EvaluateResponse(
            action='flag',
            severity='warn',
            rationale='Demo flag: simulating a policy hit.',
        )
    if 'demo:followup' in text:
        return EvaluateResponse(
            action='followup',
            followup_text='(demo) please add one concrete example to your answer.',
        )

    idx = _next_demo_index(user_id) % len(_DEMO_ROTATION)
    return _DEMO_ROTATION[idx]


def _policies_snapshot(policies: list[CoachPolicyResponse]) -> list[dict]:
    return [
        {
            'id': p.id,
            'title': p.title,
            'body': p.body,
            'is_shared': p.is_shared,
        }
        for p in policies
    ]


# ─── Core algorithm (no storage access; used by evaluate + dry_run) ──


async def run_core(
    *,
    user_id: str,
    enabled: bool,
    demo_mode: bool,
    coach_model_id: Optional[str],
    policies: list[CoachPolicyResponse],
    conversation: list[ConversationTurn],
    llm_caller,
    event_sink: Optional[EventSink] = None,
) -> EvaluateResponse:
    """Evaluate with fully-resolved inputs; no DB reads.

    ``evaluate()`` is the thin wrapper that loads cfg + policies from
    storage; /dry-run reuses this directly with caller-supplied overrides.
    """
    trace = EvalTrace(demo=demo_mode)
    trace.conversation = _conversation_snapshot(conversation)

    def emit(resp: EvaluateResponse) -> EvaluateResponse:
        trace.verdict_dict = resp.model_dump()
        if event_sink is not None:
            try:
                event_sink(trace)
            except Exception as exc:  # event sink must never break evaluate
                log.warning('coach: event_sink raised: %s', exc)
        return resp

    if not conversation:
        trace.skip_reason = 'empty_conversation'
        return emit(_noop())

    if not enabled:
        trace.skip_reason = 'disabled'
        return emit(_noop())

    # Demo mode short-circuits the LLM; policies + model are not required.
    if demo_mode:
        trace.active_policies = _policies_snapshot(policies)
        trace.policy_count = len(policies)
        verdict = _scripted_verdict(user_id, conversation)
        if verdict.action == 'followup' and _loop_protection_violated(conversation):
            verdict = EvaluateResponse(
                action='flag',
                severity='warn',
                rationale='Coach already suggested a correction; skipping further follow-ups.',
            )
        return emit(verdict)

    if not coach_model_id:
        trace.skip_reason = 'no_model'
        return emit(_noop())
    if not policies:
        trace.skip_reason = 'no_active_policies'
        return emit(_noop())

    trace.active_policies = _policies_snapshot(policies)
    trace.policy_count = len(policies)

    messages = build_evaluation_prompt(policies, conversation)
    trace.rendered_prompt = messages
    trace.llm_called = True
    trace.model_id = coach_model_id

    try:
        reply = await llm_caller(coach_model_id, messages)
    except Exception as exc:
        log.warning('coach: LLM call failed: %s', exc)
        trace.llm_error = f'{type(exc).__name__}: {exc}'
        return emit(_noop())

    trace.raw_reply = reply or ''
    verdict = parse_verdict(reply or '', {p.id for p in policies})

    # Loop protection: never chain a follow-up on top of a coach-authored one.
    if verdict.action == 'followup' and _loop_protection_violated(conversation):
        log.debug('coach: loop-protection downgrade followup → flag')
        return emit(EvaluateResponse(
            action='flag',
            policy_id=verdict.policy_id,
            severity=verdict.severity or 'warn',
            rationale=(
                verdict.rationale
                or 'Coach already suggested a correction; skipping further follow-ups.'
            ),
            followup_text=None,
        ))

    return emit(verdict)


# ─── Public entrypoint ────────────────────────────────────────────────


async def evaluate(
    *,
    user_id: str,
    user_role: str,
    conversation: list[ConversationTurn],
    llm_caller,
    event_sink: Optional[EventSink] = None,
) -> EvaluateResponse:
    """Load the user's config + policies and run the core algorithm."""
    cfg = CoachConfigs.get_or_default(user_id)
    visible = {p.id: p for p in CoachPolicies.list_visible(user_id)}
    policies: list[CoachPolicyResponse] = [
        visible[pid] for pid in cfg.active_policy_ids if pid in visible
    ]
    return await run_core(
        user_id=user_id,
        enabled=cfg.enabled,
        demo_mode=bool(getattr(cfg, 'demo_mode', False)),
        coach_model_id=cfg.coach_model_id,
        policies=policies,
        conversation=conversation,
        llm_caller=llm_caller,
        event_sink=event_sink,
    )
