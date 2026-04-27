"""Properties of the regex-based provider-logo matcher.

Covers:
- Every model id in the curated allowlist (config_seed.py) maps to a
  recognisable provider logo. This is the regression net: the moment we
  add a new entry to the seed without thinking about its logo, this test
  flags it.
- Common alternate spellings (capitalisation, vendor prefixes) all match
  the same slug — the matcher should not depend on incidental formatting.
- Unknown / nonsense ids return None so the upstream caller can fall back
  to favicon (current behaviour preserved for the unknown case).
- default_logo_url returns a fully-qualified CDN URL that ends in `.svg`,
  and uses `-color` for everything except `openai` (which has no color
  variant on the CDN).
- Empty / None input is tolerated.
"""

from __future__ import annotations

import pytest

from open_webui.coach.config_seed import DEFAULT_OPENAI_API_CONFIGS_BY_URL
from open_webui.coach.model_logos import (
    CDN,
    default_logo_url,
    match_provider,
)


# (model_id, expected_slug). One row per id in the seeded allowlist.
EXPECTED_PROVIDER = {
    'gpt-5.4': 'openai',
    'gpt-5.4-mini': 'openai',
    'gemini-3.1-pro-preview': 'gemini',
    'anthropic/claude-opus-4.6': 'claude',
    'anthropic/claude-sonnet-4.6': 'claude',
    'deepseek/deepseek-v3.2': 'deepseek',
    'deepseek/deepseek-r1-0528': 'deepseek',
    'qwen/qwen3.6-plus': 'qwen',
    'qwen/qwen3-max-thinking': 'qwen',
    'z-ai/glm-5': 'zhipu',
    'z-ai/glm-4.7': 'zhipu',
}


@pytest.mark.parametrize('model_id, expected', sorted(EXPECTED_PROVIDER.items()))
def test_whitelist_models_match_expected_provider(model_id: str, expected: str):
    assert match_provider(model_id) == expected


def test_every_seeded_model_has_a_logo():
    """If we add a new model to config_seed.py, it must already have a
    matching regex rule — otherwise users see the favicon placeholder.

    This binds the two files together: the seed is the spec, the matcher
    must keep up.
    """
    seeded_ids: list[str] = []
    for entry in DEFAULT_OPENAI_API_CONFIGS_BY_URL.values():
        seeded_ids.extend(entry.get('model_ids', []) or [])
    unmatched = [mid for mid in seeded_ids if match_provider(mid) is None]
    assert not unmatched, f'seeded models without a logo rule: {unmatched}'


@pytest.mark.parametrize(
    'variant',
    [
        'gpt-4o',
        'GPT-5.4',
        'openai/gpt-5',
        'o3-mini',
        'chatgpt-4o-latest',
    ],
)
def test_openai_aliases(variant: str):
    assert match_provider(variant) == 'openai'


@pytest.mark.parametrize(
    'variant',
    [
        'claude-3-opus',
        'Anthropic/claude-haiku',
        'CLAUDE-OPUS-4',
    ],
)
def test_claude_aliases(variant: str):
    assert match_provider(variant) == 'claude'


@pytest.mark.parametrize(
    'variant, slug',
    [
        ('gemini-2.0-flash', 'gemini'),
        ('google/gemma-2-9b', 'gemini'),
        ('mistralai/mistral-large', 'mistral'),
        ('mixtral-8x7b', 'mistral'),
        ('xai/grok-2', 'xai'),
        ('grok-3', 'xai'),
        ('meta-llama/llama-3-70b', 'meta'),
        ('llama-3.1-8b-instruct', 'meta'),
        ('cohere/command-r-plus', 'cohere'),
        ('perplexity/sonar-large', 'perplexity'),
        ('moonshotai/kimi-k2', 'moonshot'),
        # `host/model` form: model wins over host. groq is an inference
        # provider, the underlying brand is Llama → meta.
        ('groq/llama3-70b', 'meta'),
        ('groq/mixtral-8x7b', 'mistral'),
    ],
)
def test_other_provider_aliases(variant: str, slug: str):
    assert match_provider(variant) == slug


def test_groq_only_shows_groq_when_alone():
    """When the id is just `groq`-ish with no model brand to fall back
    to, we want the groq logo. Once a real model brand appears (Llama,
    Mistral), it should win."""
    assert match_provider('groq') == 'groq'


@pytest.mark.parametrize('bad', ['', None, 'totally-made-up-model-name', '???'])
def test_unknown_returns_none(bad):
    assert match_provider(bad) is None
    assert default_logo_url(bad) is None


def test_default_logo_url_format():
    url = default_logo_url('anthropic/claude-opus-4.6')
    assert url is not None
    assert url.startswith(CDN + '/')
    assert url.endswith('.svg')
    # Color brands get the -color variant.
    assert url.endswith('/claude-color.svg')


def test_favicon_default_is_treated_as_unset():
    """ModelMeta has a pydantic default of ``/static/favicon.png`` for
    profile_image_url, so almost every row we register via deploy.sh
    arrives with that exact string in the DB. The regex fallback must
    still fire in that case — otherwise the auto-logo never wins on the
    curated allowlist.

    This is a property of the *route*, but the regex must be ready to
    serve a real URL for the same id; encode that side here.
    """
    # If the regex matches gpt-5.4, the route — once it normalises the
    # favicon default to None — will reach this URL.
    assert default_logo_url('gpt-5.4') is not None
    assert default_logo_url('anthropic/claude-opus-4.6') is not None


def test_openai_has_no_color_variant():
    """OpenAI's brand mark on lobe-icons is mono only — using `-color`
    would 404. Encode that invariant so a future refactor can't silently
    flip it.
    """
    url = default_logo_url('gpt-5.4')
    assert url is not None
    assert url.endswith('/openai.svg')
    assert '-color' not in url
