"""Properties of the local-dev user autoseed.

Two parts to verify:
  - The safety gate (env flag + sqlite-only) — pure-function, no DB.
  - The seeder itself — runs against an isolated in-memory SQLite DB so
    the test never touches the dev or prod DB.
"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from open_webui.coach.dev_seed import (
    DEV_USERS,
    ENV_FLAG,
    DevUser,
    ensure_user,
    should_run,
)
from open_webui.internal.db import get_db
from open_webui.models.auths import Auth
from open_webui.models.users import User


# ─── Safety gate ────────────────────────────────────────────────────────


def test_should_run_off_by_default():
    assert should_run({}) is False


def test_should_run_requires_truthy_env():
    for falsy in ('', '0', 'false', 'no', 'off'):
        assert should_run({ENV_FLAG: falsy, 'DATABASE_URL': 'sqlite:///x.db'}) is False


def test_should_run_truthy_values():
    for truthy in ('1', 'true', 'yes', 'on', 'TRUE', ' Yes '):
        assert should_run({ENV_FLAG: truthy, 'DATABASE_URL': 'sqlite:///x.db'}) is True


def test_should_run_refuses_postgres_even_when_flag_set():
    """The crucial production safeguard: env-flag mistake must NOT mutate Cloud SQL."""
    assert should_run({ENV_FLAG: '1', 'DATABASE_URL': 'postgresql://u:p@h/db'}) is False
    assert should_run({ENV_FLAG: '1', 'DATABASE_URL': 'postgresql+asyncpg://u:p@h/db'}) is False


def test_should_run_unset_database_url_treated_as_sqlite_default():
    # Open WebUI's default backing store is sqlite — flag-only suffices.
    assert should_run({ENV_FLAG: '1'}) is True


# ─── Seeder ────────────────────────────────────────────────────────────


@pytest.fixture
def db() -> Session:
    """File-backed SQLite session set up by conftest.bootstrap_schema.

    Cleans User+Auth rows between tests so each one starts empty.
    """
    with get_db() as session:
        session.query(Auth).delete()
        session.query(User).delete()
        session.commit()
        yield session


def _spec() -> DevUser:
    return DevUser(email='probe@local.dev', password='pw', role='user', name='probe')


def test_ensure_user_creates_user_and_auth_pair(db: Session):
    assert ensure_user(db, _spec()) is True
    db.commit()
    user = db.query(User).filter_by(email='probe@local.dev').one()
    auth = db.query(Auth).filter_by(email='probe@local.dev').one()
    assert user.id == auth.id  # paired by UUID
    assert user.role == 'user'
    assert auth.active is True
    assert auth.password != 'pw'  # bcrypt-hashed, not plaintext


def test_ensure_user_idempotent(db: Session):
    assert ensure_user(db, _spec()) is True
    db.commit()
    assert ensure_user(db, _spec()) is False
    assert db.query(User).filter_by(email='probe@local.dev').count() == 1


def test_ensure_user_does_not_overwrite_password(db: Session):
    ensure_user(db, _spec())
    db.commit()
    original_hash = db.query(Auth).filter_by(email='probe@local.dev').one().password
    # Caller passes a different password later — existing row stays put.
    later = DevUser(email='probe@local.dev', password='different', role='admin', name='still-probe')
    assert ensure_user(db, later) is False
    db.commit()
    assert db.query(Auth).filter_by(email='probe@local.dev').one().password == original_hash
    # Role must also not flip — that's a destructive change for an admin who
    # may have promoted/demoted the dev user manually.
    assert db.query(User).filter_by(email='probe@local.dev').one().role == 'user'


def test_dev_users_have_admin_and_user_roles():
    """Without both, half of the per-role UI branches are unreachable in dev."""
    roles = {u.role for u in DEV_USERS}
    assert 'admin' in roles
    assert 'user' in roles


def test_dev_users_emails_are_unique():
    emails = [u.email for u in DEV_USERS]
    assert len(emails) == len(set(emails))
