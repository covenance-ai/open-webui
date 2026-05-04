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

from open_webui.coach.prompts import build_evaluation_prompt, build_preflight_prompt
from open_webui.coach.schemas import (
    ConversationTurn,
    CoachPolicyResponse,
    EvaluateResponse,
)
# NOTE: storage is imported lazily inside evaluate() so this module can be
# used by standalone scripts (scripts/coach_e2e.py) that want run_core
# without pulling in the DB stack. Storage transitively imports
# open_webui.internal.db, which eagerly creates an async engine at module
# load — unwanted when run_core is the only thing the caller needs.

log = logging.getLogger(__name__)

_POST_ACTIONS = {'none', 'flag', 'followup'}
_PRE_ACTIONS = {'none', 'block'}
_VALID_SEVERITIES = {'info', 'warn', 'critical', None}

# Maps the user-facing CoachPolicy.kind to the action verb the coach
# emits when that policy fires. ``intervene`` is the user-facing name;
# ``followup`` is the legacy action name kept on the wire to avoid a
# data migration of historical CoachEvent rows.
_KIND_TO_ACTION = {
    'block': 'block',
    'flag': 'flag',
    'intervene': 'followup',
}


def _valid_actions_for_phase(phase: str) -> set[str]:
    return _PRE_ACTIONS if phase == 'pre' else _POST_ACTIONS


def _kinds_for_phase(phase: str) -> set[str]:
    """Which policy kinds run in each phase.

    Pre-flight runs only ``block`` policies (they're the only ones that
    can refuse a message before the LLM sees it). Post-flight runs the
    other two (``flag`` annotates, ``intervene`` self-corrects).
    """
    return {'block'} if phase == 'pre' else {'flag', 'intervene'}


def filter_policies_for_phase(
    policies: list[CoachPolicyResponse], phase: str
) -> list[CoachPolicyResponse]:
    """Drop policies whose kind doesn't apply in this phase.

    Used by run_core to keep the LLM prompt focused — pre-flight should
    not see flag/intervene policies, post-flight should not see block
    policies.
    """
    keep = _kinds_for_phase(phase)
    return [p for p in policies if getattr(p, 'kind', 'flag') in keep]


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


def _coerce_action_to_kind(
    verdict: EvaluateResponse, policies: list[CoachPolicyResponse]
) -> EvaluateResponse:
    """Force the verdict's action to match the cited policy's kind.

    The LLM is told what to emit but can still drift — return action=flag
    when the matching policy is kind=intervene, etc. We resolve in favour
    of the policy's kind so the user-facing semantics stay stable: a
    policy that's tagged as a "flagger" never silently auto-corrects.

    No-op when action=none (nothing to coerce) or when the verdict cites
    no policy.
    """
    if verdict.action == 'none':
        return verdict
    if not verdict.policy_id:
        return verdict
    by_id = {p.id: p for p in policies}
    cited = by_id.get(verdict.policy_id)
    if cited is None:
        return verdict
    expected = _KIND_TO_ACTION[getattr(cited, 'kind', 'flag')]
    if verdict.action == expected:
        return verdict
    # Action mismatch. Rebuild the verdict in the right shape.
    if expected == 'followup':
        # Need followup_text. The model may not have produced one when
        # it thought it was emitting a flag; synthesize a minimal one
        # rather than dropping the verdict entirely.
        ft = (
            verdict.followup_text
            or verdict.rationale
            or 'Please revise your previous reply to address the policy concern.'
        )
        return EvaluateResponse(
            action='followup',
            policy_id=verdict.policy_id,
            severity=verdict.severity,
            rationale=verdict.rationale,
            followup_text=ft,
        )
    if expected == 'flag':
        return EvaluateResponse(
            action='flag',
            policy_id=verdict.policy_id,
            severity=verdict.severity or 'warn',
            rationale=verdict.rationale or 'Coach: policy concern.',
            followup_text=None,
        )
    if expected == 'block':
        return EvaluateResponse(
            action='block',
            policy_id=verdict.policy_id,
            severity=verdict.severity or 'critical',
            rationale=verdict.rationale or 'Coach: blocked by policy.',
            followup_text=None,
        )
    return verdict


def parse_verdict(
    raw: str, valid_policy_ids: set[str], phase: str = 'post'
) -> EvaluateResponse:
    """Parse a coach LLM reply into an EvaluateResponse.

    Allowed actions depend on ``phase``: post allows none/flag/followup;
    pre allows none/block. Malformed or phase-mismatched output falls
    through to action=none. Unknown ``policy_id`` is dropped to null
    rather than failing the whole verdict. Deliberately resilient: inputs
    are untrusted LLM strings.
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
    allowed = _valid_actions_for_phase(phase)
    if action not in allowed:
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

    # Defensive: each non-none action needs its payload to be actionable.
    if action == 'followup' and not (followup_text and followup_text.strip()):
        return _noop()
    if action in ('flag', 'block') and not (rationale and rationale.strip()):
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


def _first_policy_id_of_kind(
    policies: Optional[list[CoachPolicyResponse]], kind: str
) -> Optional[str]:
    """Return the id of the first active policy with the given kind, or None.

    Used by demo mode to cite a kind-appropriate policy in the verdict
    (so the frontend renders the matching seed policy's title/body
    instead of a generic placeholder).
    """
    if not policies:
        return None
    for p in policies:
        if getattr(p, 'kind', 'flag') == kind:
            return p.id
    return None


_POST_DEMO_ROTATION = (
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


# Hiring-related keywords: used by demo mode to trigger a canonical
# pre-flight block. Keep the list focused — false positives on pre-flight
# are worse than false negatives, because they surprise the user.
_HIRING_KEYWORDS = (
    'hire ',
    'hiring',
    'candidate',
    'resume',
    'cv ',
    'whom to hire',
    'who to hire',
    'reject the candidate',
)


def _scripted_verdict(
    user_id: str,
    conversation: list[ConversationTurn],
    phase: str = 'post',
    policies: Optional[list[CoachPolicyResponse]] = None,
) -> EvaluateResponse:
    """Produce a demo-mode verdict.

    Phase-aware so pre-flight demos can show a realistic block. Triggers
    (checked in order) in the latest user message:

    Pre-flight:
    - ``demo:block`` or any hiring keyword → ``block``.
    - ``demo:none``                         → silent no-op.
    - otherwise                             → ``none``.

    Post-flight:
    - ``demo:flag``     → 'warn' flag.
    - ``demo:critical`` → 'critical' flag.
    - ``demo:followup`` → coach-authored follow-up.
    - ``demo:none``     → silent no-op.
    - otherwise         → rotate flag → followup → none.

    When ``policies`` is supplied (run_core always passes the active set),
    the block verdict cites the first policy's id so the frontend's block
    card renders the real title / body / explanation_url instead of the
    generic "Policy violation" fallback.
    """
    last_user = next(
        (t.content for t in reversed(conversation) if t.role == 'user'),
        '',
    )
    text = (last_user or '').lower()

    if 'demo:none' in text:
        return EvaluateResponse(action='none')

    block_id = _first_policy_id_of_kind(policies, 'block')
    flag_id = _first_policy_id_of_kind(policies, 'flag')

    if phase == 'pre':
        triggered = 'demo:block' in text or any(k in text for k in _HIRING_KEYWORDS)
        if triggered:
            return EvaluateResponse(
                action='block',
                severity='critical',
                policy_id=block_id,
                rationale=(
                    'This request appears to involve using an LLM for hiring '
                    'decisions, which your coach policy forbids. Please handle '
                    'candidate evaluation outside of this assistant.'
                ),
            )
        return EvaluateResponse(action='none')

    # Post-flight demo scripts.
    if 'demo:critical' in text:
        return EvaluateResponse(
            action='flag',
            severity='critical',
            policy_id=flag_id,
            rationale='Demo critical flag: simulating a high-severity policy hit.',
        )
    if 'demo:flag' in text:
        return EvaluateResponse(
            action='flag',
            severity='warn',
            policy_id=flag_id,
            rationale='Demo flag: simulating a policy hit.',
        )
    if 'demo:followup' in text or 'demo:intervene' in text:
        return EvaluateResponse(
            action='followup',
            policy_id=_first_policy_id_of_kind(policies, 'intervene'),
            followup_text='(demo) please add one concrete example to your answer.',
        )

    idx = _next_demo_index(user_id) % len(_POST_DEMO_ROTATION)
    return _POST_DEMO_ROTATION[idx]


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
    phase: str = 'post',
    access_enabled: bool = True,
) -> EvaluateResponse:
    """Evaluate with fully-resolved inputs; no DB reads.

    ``evaluate()`` is the thin wrapper that loads cfg + policies from
    storage; /dry-run reuses this directly with caller-supplied overrides.

    ``phase`` selects post-flight ('post', default — judge the last
    assistant reply) vs pre-flight ('pre' — screen the pending user
    query). Allowed verdict actions differ by phase; see parse_verdict.
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

    # Admin gate. Checked before the user's own ``enabled`` so admins can
    # deny access to users who have already turned the coach on themselves.
    if not access_enabled:
        trace.skip_reason = 'no_access'
        return emit(_noop())

    if not enabled:
        trace.skip_reason = 'disabled'
        return emit(_noop())

    # Filter to the policies whose kind applies in this phase. The
    # snapshot reflects what was *actually* considered, not the full
    # active list, so the activity-log detail view doesn't lie.
    policies = filter_policies_for_phase(policies, phase)

    # Demo mode short-circuits the LLM; policies + model are not required.
    if demo_mode:
        trace.active_policies = _policies_snapshot(policies)
        trace.policy_count = len(policies)
        verdict = _scripted_verdict(user_id, conversation, phase=phase, policies=policies)
        if (
            phase == 'post'
            and verdict.action == 'followup'
            and _loop_protection_violated(conversation)
        ):
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

    prompt_builder = build_preflight_prompt if phase == 'pre' else build_evaluation_prompt
    messages = prompt_builder(policies, conversation)
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
    verdict = parse_verdict(reply or '', {p.id for p in policies}, phase=phase)
    verdict = _coerce_action_to_kind(verdict, policies)

    # Loop protection (post only): never chain a followup on top of a
    # coach-authored user turn. Pre-flight doesn't produce followups so
    # the rule is inert there.
    if (
        phase == 'post'
        and verdict.action == 'followup'
        and _loop_protection_violated(conversation)
    ):
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
    phase: str = 'post',
) -> EvaluateResponse:
    """Load the user's config + policies and run the core algorithm."""
    from open_webui.coach.storage import CoachConfigs, CoachPolicies
    cfg = CoachConfigs.get_or_default(user_id)
    visible = {p.id: p for p in CoachPolicies.list_visible(user_id)}
    policies: list[CoachPolicyResponse] = [
        visible[pid] for pid in cfg.active_policy_ids if pid in visible
    ]
    return await run_core(
        user_id=user_id,
        enabled=cfg.enabled,
        access_enabled=getattr(cfg, 'access_enabled', True),
        demo_mode=cfg.demo_mode,
        coach_model_id=cfg.coach_model_id,
        policies=policies,
        conversation=conversation,
        llm_caller=llm_caller,
        event_sink=event_sink,
        phase=phase,
    )
