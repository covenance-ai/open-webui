"""Tests for demo mode + event log.

Covers the behavioural promises we just added:
- Demo mode skips the LLM entirely (verdicts come from the script).
- Keyword triggers in the last user message pick specific verdicts.
- Rotation fallback exercises all three actions over three turns.
- Loop protection still fires in demo mode.
- evaluate()'s event_sink receives a trace describing what happened.
- The in-memory ring buffer is per-user and bounded.
"""

import asyncio

import pytest


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@pytest.fixture(autouse=True)
def _reset_coach_tables():
    from open_webui.coach.models import CoachConfig, CoachPolicy
    from open_webui.internal.db import get_db

    with get_db() as db:
        db.query(CoachConfig).delete()
        db.query(CoachPolicy).delete()
        db.commit()
    yield


@pytest.fixture(autouse=True)
def _reset_events_and_demo():
    from open_webui.coach import events as coach_events
    from open_webui.coach import service

    coach_events._buffers.clear()
    service._DEMO_COUNTERS.clear()
    yield
    coach_events._buffers.clear()
    service._DEMO_COUNTERS.clear()


def _enable_demo(user_id='u1'):
    from open_webui.coach.schemas import CoachConfigForm
    from open_webui.coach.storage import CoachConfigs

    CoachConfigs.upsert(
        user_id,
        CoachConfigForm(enabled=True, demo_mode=True),
    )


# ─── Demo keyword triggers ──────────────────────────────────────────


def test_demo_trigger_flag():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    _enable_demo()

    async def caller(_m, _msgs):
        raise AssertionError('LLM must not be called in demo mode')

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='hello demo:flag here'),
            ConversationTurn(role='assistant', content='ok'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'flag'
    assert r.severity == 'warn'
    assert r.rationale


def test_demo_trigger_critical():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    _enable_demo()

    async def caller(_m, _msgs):
        raise AssertionError('LLM must not be called in demo mode')

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='demo:critical scenario'),
            ConversationTurn(role='assistant', content='ok'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'flag'
    assert r.severity == 'critical'


def test_demo_trigger_followup():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    _enable_demo()

    async def caller(_m, _msgs):
        raise AssertionError('LLM must not be called in demo mode')

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='please demo:followup now'),
            ConversationTurn(role='assistant', content='ok'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'followup'
    assert r.followup_text


def test_demo_trigger_none():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    _enable_demo()

    async def caller(_m, _msgs):
        raise AssertionError('LLM must not be called in demo mode')

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='demo:none quiet please'),
            ConversationTurn(role='assistant', content='ok'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'none'


def test_demo_rotation_visits_all_three_actions():
    """No trigger → rotate flag → followup → none across consecutive calls."""
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    _enable_demo()

    async def caller(_m, _msgs):
        raise AssertionError('LLM must not be called in demo mode')

    actions = []
    for i in range(3):
        r = _run(evaluate(
            user_id='u1', user_role='user',
            conversation=[
                ConversationTurn(role='user', content=f'plain question {i}'),
                ConversationTurn(role='assistant', content='a'),
            ],
            llm_caller=caller,
        ))
        actions.append(r.action)
    assert set(actions) == {'flag', 'followup', 'none'}


def test_demo_loop_protection_downgrades_followup():
    """Demo followups still respect loop protection."""
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    _enable_demo()

    async def caller(_m, _msgs):
        raise AssertionError('LLM must not be called in demo mode')

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='real question'),
            ConversationTurn(role='assistant', content='answer 1'),
            ConversationTurn(role='user', content='demo:followup', coach_authored=True),
            ConversationTurn(role='assistant', content='answer 2'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'flag'


# ─── event_sink / EvalTrace ─────────────────────────────────────────


def test_event_sink_invoked_when_disabled():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import EvalTrace, evaluate

    captured: list[EvalTrace] = []

    async def caller(_m, _msgs):
        raise AssertionError('should not reach LLM')

    _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[ConversationTurn(role='assistant', content='x')],
        llm_caller=caller,
        event_sink=lambda t: captured.append(t),
    ))
    assert len(captured) == 1
    assert captured[0].skip_reason == 'disabled'
    assert captured[0].llm_called is False
    assert captured[0].demo is False


def test_event_sink_demo_flag_true():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import EvalTrace, evaluate

    _enable_demo()
    captured: list[EvalTrace] = []

    async def caller(_m, _msgs):
        raise AssertionError

    _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='demo:flag'),
            ConversationTurn(role='assistant', content='a'),
        ],
        llm_caller=caller,
        event_sink=lambda t: captured.append(t),
    ))
    assert len(captured) == 1
    assert captured[0].demo is True
    assert captured[0].llm_called is False


def test_event_sink_captures_llm_error():
    from open_webui.coach.schemas import (
        CoachConfigForm,
        CoachPolicyCreateForm,
        ConversationTurn,
    )
    from open_webui.coach.service import EvalTrace, evaluate
    from open_webui.coach.storage import CoachConfigs, CoachPolicies

    p = CoachPolicies.create_personal('u1', CoachPolicyCreateForm(title='t', body='b'))
    CoachConfigs.upsert(
        'u1',
        CoachConfigForm(enabled=True, coach_model_id='m', active_policy_ids=[p.id]),
    )

    captured: list[EvalTrace] = []

    async def caller(_m, _msgs):
        raise RuntimeError('upstream boom')

    _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='q'),
            ConversationTurn(role='assistant', content='a'),
        ],
        llm_caller=caller,
        event_sink=lambda t: captured.append(t),
    ))
    assert captured and captured[0].llm_called is True
    assert captured[0].model_id == 'm'
    assert 'RuntimeError' in (captured[0].llm_error or '')


# ─── Ring buffer ─────────────────────────────────────────────────────


def test_events_ring_buffer_is_per_user_and_newest_first():
    from open_webui.coach import events

    for i in range(3):
        events.record(
            user_id='u1', status='ok', action='none', reason=None,
            model_id=None, policy_count=0, duration_ms=i, tokens_in=None,
            tokens_out=None, error=None,
        )
    events.record(
        user_id='u2', status='ok', action='none', reason=None, model_id=None,
        policy_count=0, duration_ms=99, tokens_in=None, tokens_out=None, error=None,
    )

    a = events.list_for_user('u1')
    b = events.list_for_user('u2')
    assert [e.duration_ms for e in a] == [2, 1, 0]  # newest first
    assert len(b) == 1
    assert b[0].duration_ms == 99


def test_events_ring_buffer_cap():
    from open_webui.coach import events

    cap = events._PER_USER_LIMIT
    for i in range(cap + 25):
        events.record(
            user_id='u1', status='ok', action='none', reason=None,
            model_id=None, policy_count=0, duration_ms=i, tokens_in=None,
            tokens_out=None, error=None,
        )
    got = events.list_for_user('u1', limit=cap + 50)
    assert len(got) == cap
    assert got[0].duration_ms == cap + 24  # newest
