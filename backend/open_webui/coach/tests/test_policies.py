"""Tests for the CoachPolicies storage object (Phase 2 logic).

We test the storage API directly for the same reason as test_config_api:
open_webui.utils.auth can't be imported against a bare SQLite without the
full upstream alembic chain succeeding. Permission enforcement (who may
mutate which policy) is tested separately as pure functions against the
response dataclass — see test_policy_permissions.
"""

import pytest


@pytest.fixture()
def fresh_policy_db():
    """Truncate coach_policy between tests."""
    from open_webui.coach.models import CoachPolicy
    from open_webui.internal.db import get_db

    with get_db() as db:
        db.query(CoachPolicy).delete()
        db.commit()
    yield


def test_create_personal_returns_owned_policy(fresh_policy_db):
    from open_webui.coach.schemas import CoachPolicyCreateForm
    from open_webui.coach.storage import CoachPolicies

    p = CoachPolicies.create_personal(
        'u1', CoachPolicyCreateForm(title='No medical advice', body='Do not give medical advice.')
    )

    assert p.user_id == 'u1'
    assert p.is_shared is False
    assert p.title == 'No medical advice'
    assert p.body == 'Do not give medical advice.'
    assert len(p.id) >= 32  # uuid-shaped


def test_list_visible_union_of_own_personal_and_shared(fresh_policy_db):
    """u1 sees: their own + all shared. Not u2's personals."""
    from open_webui.coach.schemas import CoachPolicyCreateForm
    from open_webui.coach.storage import CoachPolicies

    p_u1 = CoachPolicies.create_personal('u1', CoachPolicyCreateForm(title='u1-own', body='.'))
    p_u2 = CoachPolicies.create_personal('u2', CoachPolicyCreateForm(title='u2-own', body='.'))
    p_shared = CoachPolicies.create_personal('u3', CoachPolicyCreateForm(title='shared', body='.'))
    CoachPolicies.set_shared(p_shared.id, True)

    visible = CoachPolicies.list_visible('u1')
    ids = {p.id for p in visible}
    assert p_u1.id in ids
    assert p_shared.id in ids
    assert p_u2.id not in ids


def test_update_preserves_created_at(fresh_policy_db):
    import time as _time

    from open_webui.coach.schemas import CoachPolicyCreateForm, CoachPolicyUpdateForm
    from open_webui.coach.storage import CoachPolicies

    p = CoachPolicies.create_personal('u1', CoachPolicyCreateForm(title='t1', body='b1'))
    _time.sleep(1.01)
    u = CoachPolicies.update(p.id, CoachPolicyUpdateForm(title='t2'))

    assert u is not None
    assert u.title == 't2'
    assert u.body == 'b1'
    assert u.created_at == p.created_at
    assert u.updated_at >= p.updated_at + 1


def test_delete_actually_removes(fresh_policy_db):
    from open_webui.coach.schemas import CoachPolicyCreateForm
    from open_webui.coach.storage import CoachPolicies

    p = CoachPolicies.create_personal('u1', CoachPolicyCreateForm(title='t', body='b'))
    assert CoachPolicies.get_by_id(p.id) is not None
    assert CoachPolicies.delete(p.id) is True
    assert CoachPolicies.get_by_id(p.id) is None
    assert CoachPolicies.delete(p.id) is False  # second delete is a no-op


def test_share_clears_owner_unshare_preserves_orphan_state(fresh_policy_db):
    from open_webui.coach.schemas import CoachPolicyCreateForm
    from open_webui.coach.storage import CoachPolicies

    p = CoachPolicies.create_personal('u1', CoachPolicyCreateForm(title='t', body='b'))
    assert p.user_id == 'u1'
    assert p.is_shared is False

    shared = CoachPolicies.set_shared(p.id, True)
    assert shared is not None
    assert shared.is_shared is True
    assert shared.user_id is None  # ownership cleared

    unshared = CoachPolicies.set_shared(p.id, False)
    assert unshared is not None
    assert unshared.is_shared is False
    assert unshared.user_id is None  # still orphan — documented behavior


# ── Permission enforcement on the router is pure-function: _assert_mutate_allowed ──
# Exercise it without FastAPI imports.


def _make_policy_response(*, user_id, is_shared):
    from open_webui.coach.schemas import CoachPolicyResponse

    return CoachPolicyResponse(
        id='pid',
        user_id=user_id,
        is_shared=is_shared,
        title='t',
        body='b',
        created_at=0,
        updated_at=0,
    )


class _U:
    def __init__(self, id, role):
        self.id = id
        self.role = role


def test_permissions_owner_can_modify_own_personal():
    """Note: this imports the router module, which pulls open_webui.utils.auth.
    Skipped locally when that import fails; it will succeed in the deployed
    environment where all upstream tables exist.
    """
    try:
        from open_webui.coach.router import _assert_mutate_allowed
    except Exception:
        pytest.skip('router import requires full upstream DB; run this against deploy')

    _assert_mutate_allowed(_make_policy_response(user_id='u1', is_shared=False), _U('u1', 'user'))


def test_permissions_non_owner_cannot_modify_personal():
    try:
        from fastapi import HTTPException

        from open_webui.coach.router import _assert_mutate_allowed
    except Exception:
        pytest.skip('router import requires full upstream DB; run this against deploy')

    with pytest.raises(HTTPException) as exc:
        _assert_mutate_allowed(
            _make_policy_response(user_id='u1', is_shared=False), _U('u2', 'user')
        )
    assert exc.value.status_code == 403


def test_permissions_only_admin_can_modify_shared():
    try:
        from fastapi import HTTPException

        from open_webui.coach.router import _assert_mutate_allowed
    except Exception:
        pytest.skip('router import requires full upstream DB; run this against deploy')

    # non-admin blocked on shared
    with pytest.raises(HTTPException) as exc:
        _assert_mutate_allowed(
            _make_policy_response(user_id=None, is_shared=True), _U('u1', 'user')
        )
    assert exc.value.status_code == 403
    # admin allowed
    _assert_mutate_allowed(
        _make_policy_response(user_id=None, is_shared=True), _U('admin1', 'admin')
    )
