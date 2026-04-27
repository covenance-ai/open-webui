"""Properties of the startup OPENAI_API_CONFIGS seed.

Covers:
- URL-keyed defaults resolve to string index keys matching OPENAI_API_BASE_URLS position.
- Subsetting / reordering / unknown URLs all produce correct output without crashing.
- Trailing slashes on base URLs don't defeat the match.
- The seed returns fresh list refs so a caller mutating the result cannot poison the defaults.
- seed_openai_api_configs is a no-op when OPENAI_API_CONFIGS is already non-empty (admin win).
"""

from __future__ import annotations

from types import SimpleNamespace

from open_webui.coach.config_seed import (
    DEFAULT_OPENAI_API_CONFIGS_BY_URL,
    _build_seed,
    seed_openai_api_configs,
)


def _make_app(base_urls: list[str], openai_api_configs: dict | None = None) -> SimpleNamespace:
    """Mimic app.state.config enough for the seed to run against it."""
    store: dict[str, object] = {
        'OPENAI_API_BASE_URLS': list(base_urls),
        'OPENAI_API_CONFIGS': dict(openai_api_configs) if openai_api_configs else {},
    }

    class _Config:
        def __getattr__(self, key):
            return store[key]

        def __setattr__(self, key, value):
            store[key] = value

    return SimpleNamespace(state=SimpleNamespace(config=_Config()))


def test_build_seed_maps_positions_by_url():
    urls = [
        'https://api.openai.com/v1',
        'https://api.mistral.ai/v1',
        'https://generativelanguage.googleapis.com/v1beta/openai',
        'https://openrouter.ai/api/v1',
        'https://api.x.ai/v1',
    ]
    out = _build_seed(urls)
    assert set(out) == {'0', '1', '2', '3', '4'}
    assert out['0']['enable'] is True
    # Pin-agnostic: just assert the OpenAI slot has gpt-style models, so this
    # test survives version bumps applied by scripts/update_models.py.
    assert any(mid.startswith('gpt-') for mid in out['0']['model_ids'])
    assert out['1'] == {'enable': False}
    assert out['4'] == {'enable': False}


def test_build_seed_subset_and_reorder():
    # Only OpenAI configured → only index 0 seeded.
    out_openai_only = _build_seed(['https://api.openai.com/v1'])
    assert set(out_openai_only) == {'0'}
    assert out_openai_only['0']['model_ids'] == \
        DEFAULT_OPENAI_API_CONFIGS_BY_URL['https://api.openai.com/v1']['model_ids']

    # Reordered: OpenRouter at index 0 now. Assert provider identity by prefix
    # (pin-agnostic — survives version bumps by scripts/update_models.py).
    out = _build_seed(['https://openrouter.ai/api/v1', 'https://api.openai.com/v1'])
    assert any(mid.startswith('anthropic/') for mid in out['0']['model_ids'])
    assert any(mid.startswith('gpt-') for mid in out['1']['model_ids'])


def test_build_seed_unknown_url_skipped():
    assert _build_seed(['https://example.com/v1']) == {}
    # Known URL alongside unknown: only the known position gets seeded.
    out = _build_seed(['https://example.com/v1', 'https://api.openai.com/v1'])
    assert '0' not in out and '1' in out


def test_build_seed_tolerates_trailing_slash():
    out = _build_seed(['https://api.openai.com/v1/'])
    assert out['0']['enable'] is True


def test_build_seed_returns_fresh_lists():
    # Mutating the built result must not poison DEFAULT_OPENAI_API_CONFIGS_BY_URL.
    a = _build_seed(['https://api.openai.com/v1'])
    a['0']['model_ids'].append('BOGUS')
    b = _build_seed(['https://api.openai.com/v1'])
    assert 'BOGUS' not in b['0']['model_ids']


def test_seed_no_op_when_already_populated():
    existing = {'0': {'enable': True, 'model_ids': ['admin-chose-this']}}
    app = _make_app(['https://api.openai.com/v1'], openai_api_configs=existing)
    seed_openai_api_configs(app)
    assert app.state.config.OPENAI_API_CONFIGS == existing


def test_seed_writes_when_empty():
    app = _make_app(['https://api.openai.com/v1'])
    assert app.state.config.OPENAI_API_CONFIGS == {}
    seed_openai_api_configs(app)
    assert app.state.config.OPENAI_API_CONFIGS['0']['model_ids']


def test_seed_no_op_when_no_matching_urls():
    app = _make_app(['https://example.com/v1'])
    seed_openai_api_configs(app)
    # Empty stays empty — we only write something or nothing.
    assert app.state.config.OPENAI_API_CONFIGS == {}
