"""Seed standard local-dev users on startup so `npm run dev` is one step.

Without this, every fresh dev DB needs a manual signup → admin promotion
shuffle before you can sign in. With ``OUR_WEBUI_DEV_AUTOSEED=1`` set, the
backend boots with two known accounts already in place:

    admin@local.dev / admin   (role=admin)
    user@local.dev  / user    (role=user)

Idempotent: if a user with that email already exists, the row is left
alone — we never overwrite a password an admin (or `coach-seed.mjs`) has
already set. Lives in coach/ to keep the fork-isolated layout, but the
feature is generic local-dev ergonomics, not coach-specific.

Two safety gates — both must pass before any rows are written:

  1. Env var ``OUR_WEBUI_DEV_AUTOSEED`` is truthy.
  2. ``DATABASE_URL`` is a SQLite connection string.

The SQLite check is belt-and-suspenders: production runs Postgres on
Cloud SQL, so even if the env var slipped into a deploy by accident the
seed refuses to mutate the real DB.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

import bcrypt

from open_webui.internal.db import get_db
from open_webui.models.auths import Auth
from open_webui.models.users import User

# We hash directly with bcrypt rather than reusing
# ``open_webui.utils.auth.get_password_hash`` — that module pulls in
# open_webui.config, which runs a get_config() query at import time and
# therefore can't be imported before the DB schema exists. Hashing is
# the only thing we'd need from utils.auth and it's a one-liner.


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

log = logging.getLogger(__name__)

ENV_FLAG = 'OUR_WEBUI_DEV_AUTOSEED'


@dataclass(frozen=True)
class DevUser:
    email: str
    password: str
    role: str
    name: str


# Two roles cover the meaningful auth branches in the UI without bloat.
# Pending/approval flows are exercised by signing up through the UI.
DEV_USERS: tuple[DevUser, ...] = (
    DevUser(email='admin@local.dev', password='admin', role='admin', name='admin'),
    DevUser(email='user@local.dev', password='user', role='user', name='user'),
)


def _truthy(value: str | None) -> bool:
    return (value or '').strip().lower() in ('1', 'true', 'yes', 'on')


def _is_sqlite_url(database_url: str | None) -> bool:
    """Sole prod safeguard. Cloud SQL → postgresql://; dev → sqlite:///."""
    if not database_url:
        # Open WebUI defaults to sqlite when DATABASE_URL is unset.
        return True
    return database_url.startswith('sqlite:')


def should_run(env: dict[str, str] | None = None) -> bool:
    e = env if env is not None else os.environ
    return _truthy(e.get(ENV_FLAG)) and _is_sqlite_url(e.get('DATABASE_URL'))


def ensure_user(db: Session, spec: DevUser) -> bool:
    """Create the row pair (user + auth) if absent. Return True if a row was added.

    Existing users are left untouched — including their password — because
    the local DB may have been customized between dev sessions and we
    don't want to silently reset state.
    """
    existing = db.query(User).filter_by(email=spec.email).first()
    if existing is not None:
        return False
    now = int(time.time())
    user_id = str(uuid.uuid4())
    db.add(User(
        id=user_id,
        email=spec.email,
        name=spec.name,
        role=spec.role,
        profile_image_url='/user.png',
        last_active_at=now,
        created_at=now,
        updated_at=now,
    ))
    db.add(Auth(
        id=user_id,
        email=spec.email,
        password=_hash_password(spec.password),
        active=True,
    ))
    return True


def seed_dev_users() -> None:
    """Idempotent startup hook. Safe to call every boot."""
    if not should_run():
        return
    added: list[str] = []
    with get_db() as db:
        for spec in DEV_USERS:
            if ensure_user(db, spec):
                added.append(f'{spec.email} ({spec.role})')
        db.commit()
    if added:
        log.info('coach dev_seed: created %d user(s): %s', len(added), ', '.join(added))
    else:
        log.info('coach dev_seed: all dev users already present')
