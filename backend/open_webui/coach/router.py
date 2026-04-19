"""FastAPI router for /api/v1/coach/*."""

import copy
import json
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request, status

from open_webui.coach import events as coach_events
from open_webui.coach import service as coach_service
from open_webui.coach.schemas import (
    CoachConfigForm,
    CoachConfigResponse,
    CoachEventDetailResponse,
    CoachEventResponse,
    CoachPolicyCreateForm,
    CoachPolicyResponse,
    CoachPolicyUpdateForm,
    DryRunRequest,
    EvaluateRequest,
    EvaluateResponse,
)
from open_webui.coach.storage import CoachConfigs, CoachPolicies
from open_webui.models.chats import Chats
from open_webui.utils.auth import get_admin_user, get_verified_user

log = logging.getLogger(__name__)

router = APIRouter()


# ─── Config ────────────────────────────────────────────────────────────


@router.get('/config', response_model=CoachConfigResponse)
async def get_config(user=Depends(get_verified_user)) -> CoachConfigResponse:
    """Return the calling user's coach config; autocreate a default row if absent."""
    return CoachConfigs.get_or_default(user.id)


@router.post('/config', response_model=CoachConfigResponse)
async def upsert_config(
    form: CoachConfigForm, user=Depends(get_verified_user)
) -> CoachConfigResponse:
    """Upsert the calling user's coach config. None-valued fields are left untouched."""
    return CoachConfigs.upsert(user.id, form)


# ─── Policies ──────────────────────────────────────────────────────────


@router.get('/policies', response_model=list[CoachPolicyResponse])
async def list_policies(user=Depends(get_verified_user)) -> list[CoachPolicyResponse]:
    """Union of the caller's personal policies + all shared policies."""
    return CoachPolicies.list_visible(user.id)


@router.post('/policies', response_model=CoachPolicyResponse)
async def create_policy(
    form: CoachPolicyCreateForm, user=Depends(get_verified_user)
) -> CoachPolicyResponse:
    """Create a personal policy owned by the calling user."""
    return CoachPolicies.create_personal(user.id, form)


def _assert_mutate_allowed(policy: CoachPolicyResponse, user) -> None:
    """User can modify their own personal policy; admin can modify any shared one."""
    if policy.is_shared or policy.user_id is None:
        if user.role != 'admin':
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail='Only admins can modify shared policies.',
            )
    else:
        if policy.user_id != user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail='You can only modify your own policies.',
            )


@router.patch('/policies/{policy_id}', response_model=CoachPolicyResponse)
async def update_policy(
    policy_id: str,
    form: CoachPolicyUpdateForm,
    user=Depends(get_verified_user),
) -> CoachPolicyResponse:
    existing = CoachPolicies.get_by_id(policy_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Policy not found.')
    _assert_mutate_allowed(existing, user)
    updated = CoachPolicies.update(policy_id, form)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Policy not found.')
    return updated


@router.delete('/policies/{policy_id}')
async def delete_policy(
    policy_id: str, user=Depends(get_verified_user)
) -> dict:
    existing = CoachPolicies.get_by_id(policy_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Policy not found.')
    _assert_mutate_allowed(existing, user)
    deleted = CoachPolicies.delete(policy_id)
    return {'deleted': deleted}


@router.post('/policies/{policy_id}/share', response_model=CoachPolicyResponse)
async def share_policy(
    policy_id: str, _admin=Depends(get_admin_user)
) -> CoachPolicyResponse:
    """Admin-only: promote a personal policy to the shared library.

    The policy loses its owner (user_id set to NULL). Everyone can then see
    it in their policies list.
    """
    updated = CoachPolicies.set_shared(policy_id, True)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Policy not found.')
    return updated


@router.post('/policies/{policy_id}/unshare', response_model=CoachPolicyResponse)
async def unshare_policy(
    policy_id: str, _admin=Depends(get_admin_user)
) -> CoachPolicyResponse:
    """Admin-only: demote a shared policy. The policy becomes orphaned
    (no user_id); a future admin action may reassign ownership."""
    updated = CoachPolicies.set_shared(policy_id, False)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Policy not found.')
    return updated


# ─── LLM bridge ────────────────────────────────────────────────────────


async def _call_coach_llm(
    request: Request, user, model_id: str, messages: list[dict]
) -> tuple[str, int | None, int | None]:
    """In-process call to Open WebUI's chat completion surface.

    We reuse ``utils.chat.generate_chat_completion`` so that provider auth,
    model routing, and access-control live in one place. `stream=False` —
    we want the full response synchronously. Returns
    ``(content, tokens_in, tokens_out)``; token counts come from the
    OpenAI-compatible ``usage`` field and are ``None`` when the provider
    omits them.
    """
    from open_webui.utils.chat import generate_chat_completion

    payload = {'model': model_id, 'messages': messages, 'stream': False}
    result = await generate_chat_completion(request, payload, user, bypass_filter=True)
    content = ''
    try:
        content = result['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError) as exc:
        log.warning('coach: unexpected LLM response shape: %s', exc)

    tokens_in: int | None = None
    tokens_out: int | None = None
    usage = None
    if isinstance(result, dict):
        usage = result.get('usage')
    if isinstance(usage, dict):
        p = usage.get('prompt_tokens')
        c = usage.get('completion_tokens')
        if isinstance(p, int):
            tokens_in = p
        if isinstance(c, int):
            tokens_out = c
    return content, tokens_in, tokens_out


def _persist_flag(chat_id: str, message_id: str, user_id: str, verdict: EvaluateResponse) -> None:
    """Patch chat.chat.history.messages[message_id].coach with the flag details.

    Silently no-ops if the chat / message cannot be found — this is a
    post-hoc annotation and losing it on a race is acceptable.
    """
    chat = Chats.get_chat_by_id_and_user_id(chat_id, user_id)
    if chat is None:
        return
    chat_json = copy.deepcopy(chat.chat) if chat.chat else {}
    history = chat_json.setdefault('history', {})
    messages = history.setdefault('messages', {})
    if message_id not in messages:
        # Message isn't in the saved chat yet (race between client save and
        # evaluate). Skip persistence; the transient frontend store still
        # shows the flag for this session.
        return
    messages[message_id]['coach'] = {
        'severity': verdict.severity or 'warn',
        'rationale': verdict.rationale,
        'policy_id': verdict.policy_id,
        'created_at': int(time.time()),
    }
    Chats.update_chat_by_id(chat_id, chat_json)


def _status_label(trace: coach_service.EvalTrace) -> str:
    if trace.demo:
        return 'demo'
    if trace.llm_error is not None:
        return 'error'
    if trace.skip_reason is not None and not trace.llm_called:
        return 'skipped'
    return 'ok'


# ─── Evaluate (hot path) ───────────────────────────────────────────────


@router.post('/evaluate', response_model=EvaluateResponse)
async def evaluate(
    request: Request,
    body: EvaluateRequest,
    user=Depends(get_verified_user),
) -> EvaluateResponse:
    """Run the coach against the given conversation.

    The caller (frontend) sends the last few turns; we independently
    re-load the user's config + policies server-side so clients cannot
    inject arbitrary policy state. On action=flag we persist the flag into
    the chat's stored JSON so it survives reload; action=followup has no
    backend side effect — the frontend replays it via submitPrompt.

    Every call records one event in coach.events (headline row) plus a
    parallel detail blob with prompt + raw reply + verdict. One structured
    JSON log line is also emitted so Cloud Logging can index the run.
    """
    # Capture token usage from within the LLM caller closure so the outer
    # scope can read it after coach_service.evaluate returns — without
    # changing llm_caller's signature and breaking the unit tests.
    metrics: dict[str, int | None] = {'tokens_in': None, 'tokens_out': None}

    async def caller(model_id: str, messages: list[dict]) -> str:
        content, t_in, t_out = await _call_coach_llm(request, user, model_id, messages)
        metrics['tokens_in'] = t_in
        metrics['tokens_out'] = t_out
        return content

    trace_holder: dict[str, coach_service.EvalTrace] = {}

    def sink(trace: coach_service.EvalTrace) -> None:
        trace_holder['trace'] = trace

    t0 = time.monotonic()
    verdict = await coach_service.evaluate(
        user_id=user.id,
        user_role=user.role,
        conversation=body.conversation,
        llm_caller=caller,
        event_sink=sink,
        phase=body.phase,
    )
    duration_ms = int((time.monotonic() - t0) * 1000)
    trace = trace_holder.get('trace') or coach_service.EvalTrace()

    # Only post-flight flags get persisted into chat history. Pre-flight
    # verdicts refer to a message that hasn't been sent yet.
    if (
        body.phase == 'post'
        and verdict.action == 'flag'
        and body.chat_id
        and body.message_id
    ):
        try:
            _persist_flag(body.chat_id, body.message_id, user.id, verdict)
        except Exception as exc:
            log.warning('coach: persist_flag failed: %s', exc)

    status_label = _status_label(trace)

    evt = coach_events.record(
        user_id=user.id,
        status=status_label,
        action=verdict.action,
        reason=trace.skip_reason,
        model_id=trace.model_id,
        policy_count=trace.policy_count,
        duration_ms=duration_ms,
        tokens_in=metrics.get('tokens_in'),
        tokens_out=metrics.get('tokens_out'),
        error=trace.llm_error,
        chat_id=body.chat_id,
        message_id=body.message_id,
    )

    coach_events.record_detail(
        user_id=user.id,
        event_id=evt.id,
        rendered_prompt=trace.rendered_prompt,
        raw_reply=trace.raw_reply,
        verdict=trace.verdict_dict,
        active_policies=trace.active_policies,
        conversation=trace.conversation,
    )

    # One structured line per evaluate — Cloud Logging auto-parses the JSON
    # payload so you can filter by jsonPayload.status / .action / etc.
    log.info(
        json.dumps({
            'event': 'coach.evaluate',
            'event_id': evt.id,
            'user_id': user.id,
            'phase': body.phase,
            'status': status_label,
            'action': verdict.action,
            'model': trace.model_id,
            'tokens_in': metrics.get('tokens_in'),
            'tokens_out': metrics.get('tokens_out'),
            'duration_ms': duration_ms,
            'policy_count': trace.policy_count,
            'demo': trace.demo,
            'skip_reason': trace.skip_reason,
            'error': trace.llm_error,
            'chat_id': body.chat_id,
            'message_id': body.message_id,
        })
    )

    return verdict


# ─── Events (activity log) ─────────────────────────────────────────────


@router.get('/events', response_model=list[CoachEventResponse])
async def list_events(
    limit: int = 50, user=Depends(get_verified_user)
) -> list[CoachEventResponse]:
    """Return the calling user's recent coach evaluations (newest first).

    In-memory only (see coach.events module docstring); resets on
    container restart. Default 50, hard-capped at the buffer size.
    """
    limit = max(1, min(limit, 100))
    rows = coach_events.list_for_user(user.id, limit=limit)
    return [CoachEventResponse(**coach_events.to_dict(e)) for e in rows]


@router.get('/events/{event_id}', response_model=CoachEventDetailResponse)
async def get_event_detail(
    event_id: str, user=Depends(get_verified_user)
) -> CoachEventDetailResponse:
    """Full detail for one event: prompt + raw reply + verdict + policies.

    Details are kept in a smaller parallel ring; older entries fall out
    before their headline row does. A 404 here just means "too old", not
    "never existed" — the activity row may still be visible.
    """
    # Find the headline row so we can stitch duration / status / tokens.
    rows = coach_events.list_for_user(user.id, limit=coach_events._PER_USER_LIMIT)
    headline = next((r for r in rows if r.id == event_id), None)
    detail = coach_events.get_detail(user.id, event_id)
    if headline is None or detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail='Event detail expired or not found.',
        )
    return CoachEventDetailResponse(
        id=headline.id,
        user_id=headline.user_id,
        ts_ms=headline.ts_ms,
        status=headline.status,
        action=headline.action,
        reason=headline.reason,
        model_id=headline.model_id,
        duration_ms=headline.duration_ms,
        tokens_in=headline.tokens_in,
        tokens_out=headline.tokens_out,
        error=headline.error,
        demo=headline.status == 'demo',
        rendered_prompt=detail.rendered_prompt,
        raw_reply=detail.raw_reply,
        verdict=detail.verdict,
        active_policies=detail.active_policies,
        conversation=detail.conversation,
    )


@router.delete('/events')
async def clear_events(user=Depends(get_verified_user)) -> dict:
    """Wipe the calling user's activity log. Useful before a demo run."""
    cleared = coach_events.clear_for_user(user.id)
    return {'cleared': cleared}


# ─── Dry run (playground) ──────────────────────────────────────────────


@router.post('/dry-run', response_model=CoachEventDetailResponse)
async def dry_run(
    request: Request,
    body: DryRunRequest,
    user=Depends(get_verified_user),
) -> CoachEventDetailResponse:
    """Evaluate a hypothetical transcript without persisting anything.

    Overrides (``policy_ids``, ``coach_model_id``, ``demo_mode``,
    ``enabled``) default to the caller's saved config when unset. Returns
    the same detail shape as GET /events/{id} so the playground and the
    activity drawer render with one component on the frontend.

    No chat is patched, no event is recorded, no structured log is
    written — this is purely diagnostic.
    """
    cfg = CoachConfigs.get_or_default(user.id)
    enabled = body.enabled if body.enabled is not None else cfg.enabled
    demo_mode = (
        body.demo_mode
        if body.demo_mode is not None
        else bool(getattr(cfg, 'demo_mode', False))
    )
    coach_model_id = (
        body.coach_model_id if body.coach_model_id is not None else cfg.coach_model_id
    )

    # Resolve policies. None → caller's current active set; [] → no policies.
    if body.policy_ids is None:
        policy_ids = cfg.active_policy_ids
    else:
        policy_ids = body.policy_ids
    visible = {p.id: p for p in CoachPolicies.list_visible(user.id)}
    policies = [visible[pid] for pid in policy_ids if pid in visible]

    metrics: dict[str, int | None] = {'tokens_in': None, 'tokens_out': None}

    async def caller(model_id: str, messages: list[dict]) -> str:
        content, t_in, t_out = await _call_coach_llm(request, user, model_id, messages)
        metrics['tokens_in'] = t_in
        metrics['tokens_out'] = t_out
        return content

    trace_holder: dict[str, coach_service.EvalTrace] = {}

    def sink(trace: coach_service.EvalTrace) -> None:
        trace_holder['trace'] = trace

    t0 = time.monotonic()
    verdict = await coach_service.run_core(
        user_id=user.id,
        enabled=enabled,
        demo_mode=demo_mode,
        coach_model_id=coach_model_id,
        policies=policies,
        conversation=body.conversation,
        llm_caller=caller,
        event_sink=sink,
        phase=body.phase,
    )
    duration_ms = int((time.monotonic() - t0) * 1000)
    trace = trace_holder.get('trace') or coach_service.EvalTrace()

    return CoachEventDetailResponse(
        id=f'dry-run-{int(time.time() * 1000)}',
        user_id=user.id,
        ts_ms=int(time.time() * 1000),
        status=_status_label(trace),
        action=verdict.action,
        reason=trace.skip_reason,
        model_id=trace.model_id,
        duration_ms=duration_ms,
        tokens_in=metrics.get('tokens_in'),
        tokens_out=metrics.get('tokens_out'),
        error=trace.llm_error,
        demo=trace.demo,
        rendered_prompt=trace.rendered_prompt,
        raw_reply=trace.raw_reply,
        verdict=trace.verdict_dict,
        active_policies=trace.active_policies,
        conversation=trace.conversation,
    )
