"""Shared pytest fixtures for coach storage tests.

Strategy: use a file-backed SQLite DB (an in-memory DB would be lost across
Engine instances). We bypass the upstream alembic/peewee chains — several
upstream SQLite migrations are broken on ``DROP INDEX IF EXISTS
sqlite_autoindex_*`` — and instead create only the coach-owned tables via
``Base.metadata.create_all`` after importing the coach ORM models.

HTTP-level tests of the router happen against the deployed service via
curl (see COACH.md §Verification). Here we test the storage object
directly, which matches "test properties of building blocks".
"""

import os

_DB_PATH = '/tmp/coach_tests.db'
if os.path.exists(_DB_PATH):
    os.remove(_DB_PATH)

os.environ.setdefault('DATABASE_URL', f'sqlite:///{_DB_PATH}')
os.environ.setdefault('ENABLE_DB_MIGRATIONS', 'False')
os.environ.setdefault('WEBUI_SECRET_KEY', 'test-secret')

import pytest


@pytest.fixture(scope='session', autouse=True)
def _bootstrap_schema():
    """Create just the coach-owned tables on the test DB.

    Importing ``open_webui.coach.models`` registers ``CoachConfig`` with
    ``Base.metadata`` so the subsequent ``create_all`` picks it up.
    """
    # Import to register with Base.metadata.
    from open_webui.coach import models as _models  # noqa: F401
    from open_webui.internal.db import Base, engine

    Base.metadata.create_all(bind=engine)
    yield
    # file is removed at next session start


@pytest.fixture()
def fresh_db():
    """Truncate coach_config + coach_policy between tests so each starts empty."""
    from open_webui.coach.models import CoachConfig, CoachPolicy
    from open_webui.internal.db import get_db

    with get_db() as db:
        db.query(CoachConfig).delete()
        db.query(CoachPolicy).delete()
        db.commit()
    yield
