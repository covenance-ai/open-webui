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


_buffers: dict[str, Deque[CoachEvent]] = defaultdict(lambda: deque(maxlen=_PER_USER_LIMIT))
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
        if not buf:
            return 0
        n = len(buf)
        buf.clear()
        return n


def to_dict(evt: CoachEvent) -> dict:
    return asdict(evt)
