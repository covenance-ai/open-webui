"""Tests for the coach evaluation service.

We exercise ``coach.service.evaluate`` with a mocked LLM caller. The
coverage targets:
- Prompt builder stability (no placeholder mismatches; policies render).
- Parse robustness against malformed JSON (Hypothesis fuzz).
- Loop protection: a coach-authored preceding user turn downgrades
  followup → flag.
- End-to-end with a stubbed LLM: none/flag/followup paths.
"""

import asyncio

import pytest
from hypothesis import given, settings, strategies as st


def _run(coro):
    # New loop per call — prevents warnings about event-loop reuse across
    # pytest items without pulling in pytest-asyncio as a dep.
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@pytest.fixture(autouse=True)
def _reset_coach_tables():
    """Wipe both coach tables between tests."""
    from open_webui.coach.models import CoachConfig, CoachPolicy
    from open_webui.internal.db import get_db

    with get_db() as db:
        db.query(CoachConfig).delete()
        db.query(CoachPolicy).delete()
        db.commit()
    yield


# ── prompt rendering ────────────────────────────────────────────────


def test_build_prompt_includes_every_active_policy():
    from open_webui.coach.prompts import build_evaluation_prompt
    from open_webui.coach.schemas import ConversationTurn, CoachPolicyResponse

    policies = [
        CoachPolicyResponse(
            id='p1', user_id='u1', is_shared=False, title='No medical advice',
            body='Do not offer diagnoses.', created_at=0, updated_at=0,
        ),
        CoachPolicyResponse(
            id='p2', user_id=None, is_shared=True, title='Cite sources',
            body='Always cite when making factual claims.', created_at=0, updated_at=0,
        ),
    ]
    conv = [
        ConversationTurn(role='user', content='Hello'),
        ConversationTurn(role='assistant', content='Hi'),
    ]
    msgs = build_evaluation_prompt(policies, conv)

    assert len(msgs) == 2
    assert msgs[0]['role'] == 'system'
    assert msgs[1]['role'] == 'user'
    rendered = msgs[1]['content']
    assert 'p1' in rendered
    assert 'No medical advice' in rendered
    assert 'p2' in rendered
    assert 'Cite sources' in rendered


def test_prompt_conversation_tail_caps_turns():
    from open_webui.coach.prompts import format_conversation
    from open_webui.coach.schemas import ConversationTurn

    turns = [ConversationTurn(role='user', content=f'q{i}') for i in range(50)]
    rendered = format_conversation(turns, max_turns=3)
    assert 'q47' in rendered
    assert 'q48' in rendered
    assert 'q49' in rendered
    assert 'q46' not in rendered


# ── parse_verdict robustness ────────────────────────────────────────


def test_parse_rejects_unknown_action():
    from open_webui.coach.service import parse_verdict

    r = parse_verdict('{"action":"explode"}', valid_policy_ids={'p1'})
    assert r.action == 'none'


def test_parse_extracts_json_from_prose():
    """Coaches sometimes wrap JSON in chatty prose. We should still parse."""
    from open_webui.coach.service import parse_verdict

    r = parse_verdict(
        'Here is my verdict:\n{"action":"flag","rationale":"ok","policy_id":"p1"}\nEnd.',
        valid_policy_ids={'p1'},
    )
    assert r.action == 'flag'
    assert r.rationale == 'ok'
    assert r.policy_id == 'p1'


def test_parse_drops_unknown_policy_id_but_keeps_action():
    from open_webui.coach.service import parse_verdict

    r = parse_verdict(
        '{"action":"flag","rationale":"x","policy_id":"does-not-exist"}',
        valid_policy_ids={'p1'},
    )
    assert r.action == 'flag'
    assert r.rationale == 'x'
    assert r.policy_id is None


def test_parse_followup_without_text_becomes_none():
    from open_webui.coach.service import parse_verdict

    r = parse_verdict('{"action":"followup"}', valid_policy_ids={'p1'})
    assert r.action == 'none'


def test_parse_flag_without_rationale_becomes_none():
    from open_webui.coach.service import parse_verdict

    r = parse_verdict('{"action":"flag"}', valid_policy_ids={'p1'})
    assert r.action == 'none'


@given(st.text(max_size=500))
@settings(max_examples=150, deadline=None)
def test_parse_never_raises_on_arbitrary_strings(raw):
    """Property: the parser tolerates any string and returns a valid verdict."""
    from open_webui.coach.service import parse_verdict

    r = parse_verdict(raw, valid_policy_ids={'p1'})
    assert r.action in {'none', 'flag', 'followup'}


# ── end-to-end evaluate() with mocked LLM ──────────────────────────


def _enable_coach_with_policy(title='rule', body='do not do bad things'):
    from open_webui.coach.schemas import CoachConfigForm, CoachPolicyCreateForm
    from open_webui.coach.storage import CoachConfigs, CoachPolicies

    p = CoachPolicies.create_personal('u1', CoachPolicyCreateForm(title=title, body=body))
    CoachConfigs.upsert(
        'u1',
        CoachConfigForm(enabled=True, coach_model_id='mock-model', active_policy_ids=[p.id]),
    )
    return p


def test_evaluate_disabled_returns_none():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    async def caller(_m, _msgs):
        raise AssertionError('LLM must not be called when coach is disabled')

    r = _run(evaluate(
        user_id='u1',
        user_role='user',
        conversation=[ConversationTurn(role='assistant', content='hi')],
        llm_caller=caller,
    ))
    assert r.action == 'none'


def test_evaluate_admin_access_disabled_blocks_even_when_user_enabled():
    """Admin gate (access_enabled=False) takes precedence over user's own enabled.

    Otherwise an admin couldn't actually deny access to a user who had
    already turned the coach on themselves.
    """
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate
    from open_webui.coach.storage import CoachConfigs

    _enable_coach_with_policy()  # user u1 has enabled=True + a policy
    CoachConfigs.set_access('u1', access_enabled=False)

    async def caller(_m, _msgs):
        raise AssertionError('LLM must not be called when access is denied')

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='hi'),
            ConversationTurn(role='assistant', content='reply'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'none'


def test_evaluate_admin_access_reenable_restores_flow():
    """Toggling access back on must restore normal evaluation."""
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate
    from open_webui.coach.storage import CoachConfigs

    p = _enable_coach_with_policy()
    CoachConfigs.set_access('u1', access_enabled=False)
    CoachConfigs.set_access('u1', access_enabled=True)

    async def caller(_m, _msgs):
        return f'{{"action":"flag","rationale":"violation","policy_id":"{p.id}","severity":"warn"}}'

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='hi'),
            ConversationTurn(role='assistant', content='reply'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'flag'


def test_set_access_creates_row_for_unseen_user():
    """An admin must be able to deny access to a user who has never opened
    the panel — set_access creates the row in that case."""
    from open_webui.coach.storage import CoachConfigs

    cfg = CoachConfigs.set_access('never-seen-user', access_enabled=False)
    assert cfg.user_id == 'never-seen-user'
    assert cfg.access_enabled is False
    assert cfg.enabled is False  # default off

    # And it survives a re-read.
    again = CoachConfigs.get_or_default('never-seen-user')
    assert again.access_enabled is False


def test_get_access_map_defaults_unseen_users_to_true():
    """Property: an unseen user_id resolves to True (column default), not
    a missing key — admins listing all users always get a per-row state."""
    from open_webui.coach.storage import CoachConfigs

    CoachConfigs.set_access('seen-off', access_enabled=False)
    CoachConfigs.set_access('seen-on', access_enabled=True)
    m = CoachConfigs.get_access_map(['seen-off', 'seen-on', 'never-seen'])
    assert m == {'seen-off': False, 'seen-on': True, 'never-seen': True}


def test_evaluate_flag_path():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    p = _enable_coach_with_policy()

    async def caller(_m, _msgs):
        return f'{{"action":"flag","rationale":"violation","policy_id":"{p.id}","severity":"warn"}}'

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='hi'),
            ConversationTurn(role='assistant', content='reply'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'flag'
    assert r.rationale == 'violation'
    assert r.severity == 'warn'
    assert r.policy_id == p.id


def test_evaluate_followup_downgrades_on_coach_chain():
    """Loop protection: if preceding user turn was coach-authored, never followup."""
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    p = _enable_coach_with_policy()

    async def caller(_m, _msgs):
        return (
            f'{{"action":"followup","followup_text":"please correct X",'
            f'"policy_id":"{p.id}","severity":"warn"}}'
        )

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='original'),
            ConversationTurn(role='assistant', content='answer 1'),
            ConversationTurn(role='user', content='coach follow-up', coach_authored=True),
            ConversationTurn(role='assistant', content='answer 2'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'flag'  # downgraded
    assert r.followup_text is None


def test_evaluate_followup_allowed_when_no_coach_chain():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    p = _enable_coach_with_policy()

    async def caller(_m, _msgs):
        return (
            f'{{"action":"followup","followup_text":"please correct X",'
            f'"policy_id":"{p.id}","severity":"warn"}}'
        )

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[
            ConversationTurn(role='user', content='original'),
            ConversationTurn(role='assistant', content='answer 1'),
        ],
        llm_caller=caller,
    ))
    assert r.action == 'followup'
    assert r.followup_text == 'please correct X'


def test_evaluate_lllm_exception_is_swallowed():
    from open_webui.coach.schemas import ConversationTurn
    from open_webui.coach.service import evaluate

    _enable_coach_with_policy()

    async def caller(_m, _msgs):
        raise RuntimeError('upstream down')

    r = _run(evaluate(
        user_id='u1', user_role='user',
        conversation=[ConversationTurn(role='assistant', content='hi')],
        llm_caller=caller,
    ))
    assert r.action == 'none'
