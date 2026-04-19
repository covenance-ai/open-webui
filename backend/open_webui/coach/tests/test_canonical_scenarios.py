"""Canonical coach scenarios — the rehearsal script.

Each test reproduces one shaped-for-demo interaction. Green across the
board means the coach behaves correctly in every visible UI branch:

1.  OFF                — disabled config: no event effect on chat.
2.  ENABLED_NO_POLICY  — on, but no active policies: skipped.
3.  POST_NONE          — on + policy, assistant reply is fine.
4.  POST_FLAG          — on + policy, assistant reply violates → flag.
5.  POST_FOLLOWUP      — on + policy, fixable by a user-style nudge.
6.  POST_LOOP_GUARD    — followup after a coach-authored turn → flag.
7.  PRE_BLOCK_HIRING   — user pre-flight query about hiring → blocked.
8.  PRE_ALLOW_GENERAL  — unrelated pre-flight query → none.
9.  DEMO_ROTATION      — demo mode cycles flag → followup → none.
10. LLM_ERROR          — provider raised: verdict=none, error recorded.

The tests use the real service (no TestClient needed); LLM calls are
stubbed with deterministic replies. Run with:

    PYTHONPATH=. python -m pytest open_webui/coach/tests/test_canonical_scenarios.py -v
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
def _reset_coach_state():
    from open_webui.coach import events as coach_events
    from open_webui.coach import service
    from open_webui.coach.models import CoachConfig, CoachPolicy
    from open_webui.internal.db import get_db

    with get_db() as db:
        db.query(CoachConfig).delete()
        db.query(CoachPolicy).delete()
        db.commit()
    coach_events._buffers.clear()
    coach_events._details.clear()
    coach_events._detail_order.clear()
    service._DEMO_COUNTERS.clear()
    yield


HIRING_POLICY_TITLE = 'No LLM for hiring decisions'
HIRING_POLICY_BODY = (
    'This assistant must not be used for hiring-related decisions, '
    'including screening candidates, choosing whom to hire, or ranking '
    'résumés. Redirect users to handle hiring outside of this tool.'
)


def _seed_hiring_policy(user_id='u1'):
    from open_webui.coach.schemas import CoachConfigForm, CoachPolicyCreateForm
    from open_webui.coach.storage import CoachConfigs, CoachPolicies

    p = CoachPolicies.create_personal(
        user_id,
        CoachPolicyCreateForm(title=HIRING_POLICY_TITLE, body=HIRING_POLICY_BODY),
    )
    CoachConfigs.upsert(
        user_id,
        CoachConfigForm(
            enabled=True,
            coach_model_id='mock-coach-model',
            active_policy_ids=[p.id],
        ),
    )
    return p


# ── 1. OFF ──────────────────────────────────────────────────────────────


def test_1_off_returns_none():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    async def caller(_m, _msgs):
        raise AssertionError('LLM must not be called when coach is off')

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='hi'),
            ConversationTurn(role='assistant', content='hello'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'none'


# ── 2. ENABLED but no policies ─────────────────────────────────────────


def test_2_enabled_no_policies_returns_none():
    from open_webui.coach.schemas import CoachConfigForm, ConversationTurn
    from open_webui.coach.service import evaluate
    from open_webui.coach.storage import CoachConfigs

    CoachConfigs.upsert(
        'u1',
        CoachConfigForm(enabled=True, coach_model_id='m', active_policy_ids=[]),
    )

    async def caller(_m, _msgs):
        raise AssertionError('LLM must not be called with no policies')

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='hi'),
            ConversationTurn(role='assistant', content='hello'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'none'


# ── 3. POST_NONE ────────────────────────────────────────────────────────


def test_3_post_none():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    p = _seed_hiring_policy()

    async def caller(_m, _msgs):
        return '{"action":"none"}'

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content="what's the weather today?"),
            ConversationTurn(role='assistant', content='I cannot check the weather.'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'none'


# ── 4. POST_FLAG ────────────────────────────────────────────────────────


def test_4_post_flag():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    p = _seed_hiring_policy()

    async def caller(_m, _msgs):
        return (
            f'{{"action":"flag","policy_id":"{p.id}","severity":"warn",'
            f'"rationale":"The assistant answered with hiring advice."}}'
        )

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='tell me about hiring processes'),
            ConversationTurn(role='assistant', content='Here are some tips...'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'flag'
    assert r.severity == 'warn'
    assert r.policy_id == p.id
    assert 'hiring' in (r.rationale or '').lower()


# ── 5. POST_FOLLOWUP ────────────────────────────────────────────────────


def test_5_post_followup():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    p = _seed_hiring_policy()

    async def caller(_m, _msgs):
        return (
            f'{{"action":"followup","policy_id":"{p.id}",'
            f'"followup_text":"please add one concrete citation"}}'
        )

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='explain X'),
            ConversationTurn(role='assistant', content='brief answer'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'followup'
    assert r.followup_text == 'please add one concrete citation'


# ── 6. POST_LOOP_GUARD ──────────────────────────────────────────────────


def test_6_post_loop_guard_downgrades_followup_to_flag():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    p = _seed_hiring_policy()

    async def caller(_m, _msgs):
        return (
            f'{{"action":"followup","policy_id":"{p.id}",'
            f'"followup_text":"and one more nudge"}}'
        )

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='original question'),
            ConversationTurn(role='assistant', content='answer 1'),
            ConversationTurn(role='user', content='coach nudge', coach_authored=True),
            ConversationTurn(role='assistant', content='answer 2'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'flag'
    assert r.followup_text is None


# ── 7. PRE_BLOCK_HIRING ─────────────────────────────────────────────────


def test_7_pre_flight_blocks_hiring_query():
    """The flagship scenario: user tries to use the LLM for hiring."""
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    p = _seed_hiring_policy()

    async def caller(_m, _msgs):
        # Simulate a correctly-behaving coach LLM producing a block verdict.
        return (
            f'{{"action":"block","policy_id":"{p.id}","severity":"critical",'
            f'"rationale":"Using the assistant to decide whom to hire '
            f'would violate the hiring-decisions policy."}}'
        )

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(
                role='user',
                content=(
                    "Here are three candidates' résumés — who should I hire "
                    "for the senior engineer role?"
                ),
            ),
        ],
        llm_caller=caller,
        phase='pre',
    ))
    assert r.action == 'block'
    assert r.policy_id == p.id
    assert 'hiring' in (r.rationale or '').lower()


def test_7b_pre_flight_block_via_demo_mode_no_llm():
    """Same scenario, but demo mode: block is scripted so the demo always works."""
    from open_webui.coach.schemas import CoachConfigForm, ConversationTurn
    from open_webui.coach.service import evaluate
    from open_webui.coach.storage import CoachConfigs

    CoachConfigs.upsert('u1', CoachConfigForm(enabled=True, demo_mode=True))

    async def caller(_m, _msgs):
        raise AssertionError('LLM must not be called in demo mode')

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(
                role='user',
                content="Help me decide whom to hire from these candidates",
            ),
        ],
        llm_caller=caller,
        phase='pre',
    ))
    assert r.action == 'block'
    assert 'hiring' in (r.rationale or '').lower()


# ── 8. PRE_ALLOW_GENERAL ───────────────────────────────────────────────


def test_8_pre_flight_allows_general_query():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    p = _seed_hiring_policy()

    async def caller(_m, _msgs):
        return '{"action":"none"}'

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(
                role='user', content='explain how photosynthesis works'
            ),
        ],
        llm_caller=caller,
        phase='pre',
    ))
    assert r.action == 'none'


def test_8b_pre_flight_allows_general_query_in_demo():
    from open_webui.coach.schemas import CoachConfigForm, ConversationTurn
    from open_webui.coach.service import evaluate
    from open_webui.coach.storage import CoachConfigs

    CoachConfigs.upsert('u1', CoachConfigForm(enabled=True, demo_mode=True))

    async def caller(_m, _msgs):
        raise AssertionError

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='what is the capital of France?'),
        ],
        llm_caller=caller,
        phase='pre',
    ))
    assert r.action == 'none'


# ── 9. DEMO_ROTATION ───────────────────────────────────────────────────


def test_9_post_demo_rotation_visits_all_actions():
    from open_webui.coach.schemas import CoachConfigForm, ConversationTurn
    from open_webui.coach.service import evaluate
    from open_webui.coach.storage import CoachConfigs

    CoachConfigs.upsert('u1', CoachConfigForm(enabled=True, demo_mode=True))

    async def caller(_m, _msgs):
        raise AssertionError

    actions = []
    for i in range(3):
        r = _run(evaluate(
            user_id='u1', user_role='user',
            conversation=[
                ConversationTurn(role='user', content=f'q{i}'),
                ConversationTurn(role='assistant', content=f'a{i}'),
            ],
            llm_caller=caller,
        ))
        actions.append(r.action)
    assert set(actions) == {'flag', 'followup', 'none'}


# ── 10. LLM_ERROR ──────────────────────────────────────────────────────


def test_10_llm_error_returns_none_and_records_error():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import EvalTrace, evaluate

    _seed_hiring_policy()
    captured: list[EvalTrace] = []

    async def caller(_m, _msgs):
        raise RuntimeError('upstream provider is down')

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='q'),
            ConversationTurn(role='assistant', content='a'),
        ],
        llm_caller=caller,
        event_sink=lambda t: captured.append(t),
    ))
    assert r.action == 'none'
    assert 'RuntimeError' in (captured[0].llm_error or '')
