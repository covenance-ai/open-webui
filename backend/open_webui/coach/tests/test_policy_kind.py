"""Property tests for the policy ``kind`` contract.

A policy's kind decides which action it can produce when it fires:

  block      → action=block (pre-flight only)
  flag       → action=flag (post-flight)
  intervene  → action=followup (post-flight)

These tests pin the invariants:
  1. Filtering by phase keeps only the right kinds (pre→block; post→flag,intervene).
  2. _coerce_action_to_kind forces verdicts to match the cited policy's kind
     even when the LLM returns a mismatched action.
  3. The /coach demo seed library contains exactly one shared policy of
     each kind (block / flag / intervene) plus the canonical hiring rule.
"""

from open_webui.coach.schemas import CoachPolicyResponse, EvaluateResponse
from open_webui.coach.service import (
    _coerce_action_to_kind,
    filter_policies_for_phase,
)


def _policy(pid: str, kind: str) -> CoachPolicyResponse:
    """Build a Pydantic policy with a given kind for service-level tests."""
    return CoachPolicyResponse(
        id=pid,
        user_id=None,
        is_shared=True,
        title=f'p-{pid}',
        body='b',
        kind=kind,
        created_at=0,
        updated_at=0,
    )


def test_filter_pre_flight_keeps_only_block():
    pols = [
        _policy('a', 'block'),
        _policy('b', 'flag'),
        _policy('c', 'intervene'),
    ]
    kept = filter_policies_for_phase(pols, 'pre')
    assert [p.id for p in kept] == ['a']


def test_filter_post_flight_keeps_flag_and_intervene():
    pols = [
        _policy('a', 'block'),
        _policy('b', 'flag'),
        _policy('c', 'intervene'),
    ]
    kept = filter_policies_for_phase(pols, 'post')
    assert {p.id for p in kept} == {'b', 'c'}


def test_filter_default_kind_treated_as_flag():
    """Policies without a kind attribute default to 'flag' — protects
    against legacy fixtures that predate the column."""

    class Stub:
        def __init__(self, pid):
            self.id = pid

    pols = [Stub('legacy')]  # no .kind attr
    kept = filter_policies_for_phase(pols, 'post')
    assert [p.id for p in kept] == ['legacy']
    assert filter_policies_for_phase(pols, 'pre') == []


def test_coerce_flag_policy_emits_flag_even_when_llm_says_followup():
    pols = [_policy('p1', 'flag')]
    raw = EvaluateResponse(
        action='followup',
        policy_id='p1',
        followup_text='please add an example',
    )
    out = _coerce_action_to_kind(raw, pols)
    assert out.action == 'flag'
    assert out.policy_id == 'p1'
    # rationale is synthesised when missing.
    assert out.rationale


def test_coerce_intervene_policy_emits_followup_even_when_llm_says_flag():
    pols = [_policy('p1', 'intervene')]
    raw = EvaluateResponse(
        action='flag',
        policy_id='p1',
        severity='warn',
        rationale='vague answer',
    )
    out = _coerce_action_to_kind(raw, pols)
    assert out.action == 'followup'
    assert out.policy_id == 'p1'
    # followup_text fallback to rationale when LLM didn't supply one.
    assert out.followup_text


def test_coerce_no_op_when_action_already_matches_kind():
    pols = [_policy('p1', 'flag')]
    raw = EvaluateResponse(
        action='flag', policy_id='p1', severity='warn', rationale='ok'
    )
    out = _coerce_action_to_kind(raw, pols)
    assert out is raw


def test_coerce_no_op_when_no_policy_cited():
    """An action with no policy_id cannot be coerced — pass through."""
    pols = [_policy('p1', 'flag')]
    raw = EvaluateResponse(action='flag', severity='warn', rationale='generic')
    out = _coerce_action_to_kind(raw, pols)
    assert out is raw


def test_coerce_no_op_on_action_none():
    pols = [_policy('p1', 'flag')]
    raw = EvaluateResponse(action='none')
    out = _coerce_action_to_kind(raw, pols)
    assert out is raw


def test_demo_seed_library_has_one_of_each_kind(fresh_db):
    """The shared library after seeding contains canonical + 3 demo
    policies covering every kind exactly once."""
    from open_webui.coach.storage import CoachConfigs, CoachPolicies

    # Triggers seeding via _ensure_default_shared_policies.
    CoachConfigs.get_or_default('u1')
    shared = [p for p in CoachPolicies.list_visible('u1') if p.is_shared]

    by_kind = {}
    for p in shared:
        by_kind.setdefault(p.kind, []).append(p)
    # 1 block (canonical hiring) + 1 demo of each kind = block:2, flag:1, intervene:1.
    assert sorted(by_kind.keys()) == ['block', 'flag', 'intervene']
    assert len(by_kind['flag']) == 1
    assert len(by_kind['intervene']) == 1
    # block has the canonical hiring + the demo block.
    titles = sorted(p.title for p in by_kind['block'])
    assert any('hiring' in t.lower() for t in titles)
    assert any('demo' in t.lower() for t in titles)


def test_post_flight_with_only_block_policies_returns_none(fresh_db):
    """If a user has only block-kind policies active, post-flight is a
    silent no-op (no LLM call, action=none) — block doesn't apply post."""
    import asyncio

    from open_webui.coach.schemas import (
        CoachConfigForm,
        CoachPolicyCreateForm,
        ConversationTurn,
    )
    from open_webui.coach.service import evaluate
    from open_webui.coach.storage import CoachConfigs, CoachPolicies

    p = CoachPolicies.create_personal(
        'u1',
        CoachPolicyCreateForm(title='block-only', body='b', kind='block'),
    )
    CoachConfigs.upsert(
        'u1',
        CoachConfigForm(enabled=True, coach_model_id='m', active_policy_ids=[p.id]),
    )

    async def caller(_m, _msgs):
        raise AssertionError('LLM must not be called when no kind matches phase')

    r = asyncio.get_event_loop().run_until_complete(
        evaluate(
            user_id='u1',
            user_role='user',
            conversation=[
                ConversationTurn(role='user', content='hi'),
                ConversationTurn(role='assistant', content='hello'),
            ],
            llm_caller=caller,
        )
    )
    assert r.action == 'none'
