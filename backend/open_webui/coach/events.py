"""In-memory ring buffer of coach evaluation events.

Why in-memory, not a DB table: the Cloud Run service is sized min=max=1
(see our_webui README §5.8) — there's exactly one writer, one reader, one
process. A persisted table would buy nothing (events are diagnostic, not
billing-critical) and would cost a migration + a write per evaluate. A
deque per user covers every consumer: the frontend "Recent activity"
strip, ad-hoc debugging, and demo rehearsals.

On container restart the log resets — intentional. If we ever scale
horizontally (README §6.9 forbids that for now) or we want durable audit
trails, swap this module's internals; callers see the same surface.
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import asdict, dataclass, field
from threading import RLock
from typing import Deque, Optional
import time
import uuid

_PER_USER_LIMIT = 100
_DETAIL_PER_USER_LIMIT = 30  # Details carry prompt + reply — heavier.


@dataclass
class CoachEvent:
    id: str
    user_id: str
    ts_ms: int
    status: str  # 'ok' | 'error' | 'skipped' | 'demo'
    action: Optional[str]  # verdict action when applicable
    reason: Optional[str]  # skip reason when status=='skipped'
    model_id: Optional[str]
    policy_count: int
    duration_ms: int
    tokens_in: Optional[int]
    tokens_out: Optional[int]
    error: Optional[str]
    chat_id: Optional[str] = None
    message_id: Optional[str] = None


@dataclass
class CoachEventDetail:
    """Full per-event payload: prompt, raw reply, verdict, policies.

    Separate from CoachEvent so the headline ring stays light (for the
    activity strip) while the detail ring, which is bigger and less
    frequently viewed, caps at a smaller size.
    """

    id: str
    ts_ms: int
    rendered_prompt: list[dict]  # [{role, content}] — exactly what we sent
    raw_reply: Optional[str]  # LLM's unparsed output; None if LLM not called
    verdict: dict  # final EvaluateResponse as dict
    active_policies: list[dict]  # [{id, title, body, is_shared}]
    conversation: list[dict]  # [{role, content, coach_authored}] as supplied


_buffers: dict[str, Deque[CoachEvent]] = defaultdict(lambda: deque(maxlen=_PER_USER_LIMIT))
_details: dict[str, dict[str, CoachEventDetail]] = defaultdict(dict)
_detail_order: dict[str, Deque[str]] = defaultdict(
    lambda: deque(maxlen=_DETAIL_PER_USER_LIMIT)
)
_lock = RLock()


def record(
    *,
    user_id: str,
    status: str,
    action: Optional[str],
    reason: Optional[str],
    model_id: Optional[str],
    policy_count: int,
    duration_ms: int,
    tokens_in: Optional[int],
    tokens_out: Optional[int],
    error: Optional[str],
    chat_id: Optional[str] = None,
    message_id: Optional[str] = None,
) -> CoachEvent:
    evt = CoachEvent(
        id=str(uuid.uuid4()),
        user_id=user_id,
        ts_ms=int(time.time() * 1000),
        status=status,
        action=action,
        reason=reason,
        model_id=model_id,
        policy_count=policy_count,
        duration_ms=duration_ms,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        error=error,
        chat_id=chat_id,
        message_id=message_id,
    )
    with _lock:
        _buffers[user_id].append(evt)
    return evt


def list_for_user(user_id: str, limit: int = 50) -> list[CoachEvent]:
    with _lock:
        buf = _buffers.get(user_id)
        if not buf:
            return []
        # Newest first.
        events = list(buf)
    events.reverse()
    return events[:limit]


def clear_for_user(user_id: str) -> int:
    with _lock:
        buf = _buffers.get(user_id)
        n = len(buf) if buf else 0
        if buf:
            buf.clear()
        _details.pop(user_id, None)
        _detail_order.pop(user_id, None)
        return n


def record_detail(
    *,
    user_id: str,
    event_id: str,
    rendered_prompt: list[dict],
    raw_reply: Optional[str],
    verdict: dict,
    active_policies: list[dict],
    conversation: list[dict],
) -> CoachEventDetail:
    """Stash the full per-event payload, evicting the oldest detail for
    this user when we exceed the cap. Indexed by event_id so GET
    /events/{id}/detail can O(1) lookup."""
    detail = CoachEventDetail(
        id=event_id,
        ts_ms=int(time.time() * 1000),
        rendered_prompt=rendered_prompt,
        raw_reply=raw_reply,
        verdict=verdict,
        active_policies=active_policies,
        conversation=conversation,
    )
    with _lock:
        order = _detail_order[user_id]
        if len(order) >= order.maxlen:
            evicted = order[0]  # deque will drop this when we append below
            _details[user_id].pop(evicted, None)
        order.append(event_id)
        _details[user_id][event_id] = detail
    return detail


def get_detail(user_id: str, event_id: str) -> Optional[CoachEventDetail]:
    with _lock:
        return _details.get(user_id, {}).get(event_id)


def to_dict(evt: CoachEvent) -> dict:
    return asdict(evt)


def detail_to_dict(d: CoachEventDetail) -> dict:
    return asdict(d)
