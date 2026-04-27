"""Seed sensible defaults for Open WebUI config on startup.

Today this seeds OPENAI_API_CONFIGS (the per-connection model allowlist) so
fresh installs of this fork start with a curated model picker instead of
every model each connected provider exposes. Defaults are keyed by upstream
base URL, then resolved against the current OPENAI_API_BASE_URLS at boot —
any install with a subset (or different ordering) of providers still works.

Idempotent. Runs every boot but only writes when OPENAI_API_CONFIGS is
currently empty, so once an admin has customized the allowlist (UI or
POST /openai/config/update) their value wins and the seed stays out of the
way. With ENABLE_PERSISTENT_CONFIG=False the in-memory value resets to {}
on every boot, so the seed re-applies each time — also by design.

Lives in the coach/ subtree (fork-isolated) so it travels with upstream
rebases. See COACH_INJECTIONS.md (Site 7) for the main.py injection.
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)

DEFAULT_OPENAI_API_CONFIGS_BY_URL: dict[str, dict[str, Any]] = {
    'https://api.openai.com/v1': {
        'enable': True,
        'model_ids': ['gpt-5.5', 'gpt-5.4-mini'],
    },
    'https://generativelanguage.googleapis.com/v1beta/openai': {
        'enable': True,
        'model_ids': ['gemini-3.1-pro-preview'],
    },
    'https://openrouter.ai/api/v1': {
        'enable': True,
        'model_ids': [
            'anthropic/claude-opus-4.7',
            'anthropic/claude-sonnet-4.6',
            'deepseek/deepseek-v3.2',
            'deepseek/deepseek-r1-0528',
            'qwen/qwen3.6-plus',
            'qwen/qwen3-max-thinking',
            'z-ai/glm-5.1',
            'z-ai/glm-4.7',
        ],
    },
    # Connected by some installs (keys in .env), but intentionally hidden
    # from the picker — currently-shipped models aren't in our curated set.
    'https://api.mistral.ai/v1': {'enable': False},
    'https://api.x.ai/v1': {'enable': False},
}


def _build_seed(base_urls: list[str]) -> dict[str, dict[str, Any]]:
    seeded: dict[str, dict[str, Any]] = {}
    for idx, url in enumerate(base_urls or []):
        entry = DEFAULT_OPENAI_API_CONFIGS_BY_URL.get(url.rstrip('/'))
        if entry is not None:
            seeded[str(idx)] = {k: (list(v) if isinstance(v, list) else v) for k, v in entry.items()}
    return seeded


def seed_openai_api_configs(app) -> None:
    current = app.state.config.OPENAI_API_CONFIGS
    if current:
        return
    seeded = _build_seed(list(app.state.config.OPENAI_API_BASE_URLS or []))
    if not seeded:
        return
    app.state.config.OPENAI_API_CONFIGS = seeded
    log.info(
        'coach: seeded OPENAI_API_CONFIGS for %d of %d connection(s)',
        len(seeded),
        len(app.state.config.OPENAI_API_BASE_URLS or []),
    )
