"""Tests for the CoachConfigs storage object.

The HTTP router is a thin passthrough to these methods; we test the
contract at the storage layer to avoid pulling open_webui.config /
open_webui.utils.auth into the import chain (they query tables that
upstream's SQLite migrations can't create cleanly).

HTTP-level smoke: see COACH.md §Verification, curl against deployed URL.
"""


def test_get_autocreates_default(fresh_db):
    from open_webui.coach.storage import CoachConfigs

    cfg = CoachConfigs.get_or_default('u1')

    assert cfg.user_id == 'u1'
    assert cfg.enabled is False
    assert cfg.coach_model_id is None
    assert cfg.active_policy_ids == []
    assert isinstance(cfg.created_at, int)
    assert cfg.created_at > 0


def test_get_is_idempotent(fresh_db):
    """A second get_or_default for the same user must not duplicate rows."""
    from open_webui.coach.models import CoachConfig
    from open_webui.coach.storage import CoachConfigs
    from open_webui.internal.db import get_db

    CoachConfigs.get_or_default('u1')
    CoachConfigs.get_or_default('u1')
    CoachConfigs.get_or_default('u1')

    with get_db() as db:
        assert db.query(CoachConfig).filter_by(user_id='u1').count() == 1


def test_upsert_persists_fields(fresh_db):
    from open_webui.coach.schemas import CoachConfigForm
    from open_webui.coach.storage import CoachConfigs

    CoachConfigs.upsert(
        'u1',
        CoachConfigForm(enabled=True, coach_model_id='gpt-5.4-mini'),
    )

    cfg = CoachConfigs.get_or_default('u1')
    assert cfg.enabled is True
    assert cfg.coach_model_id == 'gpt-5.4-mini'
    assert cfg.active_policy_ids == []


def test_upsert_partial_leaves_unset_fields_unchanged(fresh_db):
    """Sending only a subset of fields must not clobber the others."""
    from open_webui.coach.schemas import CoachConfigForm
    from open_webui.coach.storage import CoachConfigs

    CoachConfigs.upsert(
        'u1',
        CoachConfigForm(enabled=True, coach_model_id='gpt-5.4-mini'),
    )
    # Partial update: only policy ids.
    CoachConfigs.upsert(
        'u1',
        CoachConfigForm(active_policy_ids=['p1', 'p2']),
    )

    cfg = CoachConfigs.get_or_default('u1')
    assert cfg.enabled is True
    assert cfg.coach_model_id == 'gpt-5.4-mini'
    assert cfg.active_policy_ids == ['p1', 'p2']


def test_demo_mode_persists_and_defaults_false(fresh_db):
    """demo_mode round-trips through storage; default is False."""
    from open_webui.coach.schemas import CoachConfigForm
    from open_webui.coach.storage import CoachConfigs

    cfg = CoachConfigs.get_or_default('u1')
    assert cfg.demo_mode is False

    CoachConfigs.upsert('u1', CoachConfigForm(demo_mode=True))
    cfg = CoachConfigs.get_or_default('u1')
    assert cfg.demo_mode is True

    # Partial update leaves demo_mode alone.
    CoachConfigs.upsert('u1', CoachConfigForm(enabled=True))
    cfg = CoachConfigs.get_or_default('u1')
    assert cfg.demo_mode is True
    assert cfg.enabled is True


def test_configs_are_per_user(fresh_db):
    """u1 and u2 should have independent configs with no crosstalk."""
    from open_webui.coach.schemas import CoachConfigForm
    from open_webui.coach.storage import CoachConfigs

    CoachConfigs.upsert(
        'u1',
        CoachConfigForm(enabled=True, coach_model_id='m-for-u1'),
    )
    cfg2 = CoachConfigs.get_or_default('u2')

    assert cfg2.user_id == 'u2'
    assert cfg2.enabled is False
    assert cfg2.coach_model_id is None


def test_updated_at_advances_on_write(fresh_db):
    import time as _time

    from open_webui.coach.schemas import CoachConfigForm
    from open_webui.coach.storage import CoachConfigs

    CoachConfigs.upsert('u1', CoachConfigForm(enabled=True))
    first = CoachConfigs.get_or_default('u1')

    # make sure the second timestamp is >= first; one second is plenty on most
    # systems, but we assert >= (monotonic) rather than strict > to tolerate
    # sub-second re-runs.
    _time.sleep(1.01)
    CoachConfigs.upsert('u1', CoachConfigForm(enabled=False))
    second = CoachConfigs.get_or_default('u1')

    assert second.updated_at >= first.updated_at + 1
    assert second.created_at == first.created_at  # creation time is immutable
