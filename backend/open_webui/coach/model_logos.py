"""Auto-assign provider logos to models via regex on the model id.

Why: previously, every model in the curated whitelist got its logo from a
DB overlay registered by `deploy.sh` (`meta.profile_image_url`). That meant
adding a model to the OpenAI/OpenRouter allowlist required a second step —
a redeploy that re-ran the overlay loop — before its logo would appear.
Anything outside the loop (a one-off model an admin enables in
Connections, a new entry in `config_seed.py`) showed the grey `OI`
placeholder until someone remembered to add it to `OVERLAYS`.

This module collapses that two-step into a regex pass on the model id.
The match runs at image-request time inside `routers/models.py`'s
`get_model_profile_image`, after the DB lookup misses and before the
favicon fallback. So:

    DB has profile_image_url    -> serve it (admin/overlay wins)
    DB has model row, no URL    -> regex match -> CDN logo (this module)
    DB has no row at all        -> regex match -> CDN logo (this module)
    Regex doesn't match         -> favicon.png (unchanged behaviour)

Patterns cover the current whitelist (see `config_seed.py`) plus the
common providers users are likely to enable next: Mistral, xAI/Grok,
Meta/Llama, Cohere, Perplexity, Moonshot/Kimi. Add more as needed —
patterns are checked in order, first match wins.

Logos are served from the lobe-icons mirror on npmmirror's CDN, same
source `deploy.sh` was using. Color (`-color`) variants are preferred
where they exist; OpenAI is mono only (brand is black-on-white).
"""

from __future__ import annotations

import re
from typing import Optional

CDN = 'https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons'

# (compiled pattern, slug, has_color_variant)
# Order matters: more specific patterns first. `claude` before `anthropic`
# isn't strictly required (both map to the same slug) but keeps intent
# clear if the slugs ever diverge.
_RULES: list[tuple[re.Pattern[str], str, bool]] = [
    (re.compile(r'(?:^|/)(?:claude|anthropic)', re.IGNORECASE), 'claude', True),
    (re.compile(r'(?:^|/)(?:gpt[-_]?\d|chatgpt|o\d(?:[-_]|$)|openai)', re.IGNORECASE), 'openai', False),
    (re.compile(r'(?:^|/)(?:gemini|google|palm|bard)', re.IGNORECASE), 'gemini', True),
    (re.compile(r'(?:^|/)deepseek', re.IGNORECASE), 'deepseek', True),
    (re.compile(r'(?:^|/)(?:qwen|qwq)', re.IGNORECASE), 'qwen', True),
    # GLM family is published by Zhipu / Z-AI under the `zhipu` slug.
    (re.compile(r'(?:^|/)(?:z-ai|zhipu|glm|chatglm)', re.IGNORECASE), 'zhipu', True),
    (re.compile(r'(?:^|/)(?:mistral|mixtral|codestral|magistral|ministral)', re.IGNORECASE), 'mistral', True),
    (re.compile(r'(?:^|/)(?:xai|x-ai|grok)', re.IGNORECASE), 'xai', True),
    (re.compile(r'(?:^|/)(?:meta-llama|meta|llama)', re.IGNORECASE), 'meta', True),
    (re.compile(r'(?:^|/)(?:cohere|command[-_]?[arnpl]?)', re.IGNORECASE), 'cohere', True),
    (re.compile(r'(?:^|/)(?:perplexity|pplx|sonar)', re.IGNORECASE), 'perplexity', True),
    (re.compile(r'(?:^|/)(?:moonshot|kimi)', re.IGNORECASE), 'moonshot', True),
    (re.compile(r'(?:^|/)groq', re.IGNORECASE), 'groq', True),
    (re.compile(r'(?:^|/)ollama', re.IGNORECASE), 'ollama', False),
]


def match_provider(model_id: Optional[str]) -> Optional[str]:
    """Return the lobe-icons slug for a model id, or None if no rule matches.

    The slug is the bare provider name (e.g. ``'claude'``, ``'openai'``).
    Use :func:`default_logo_url` to get the full CDN URL.
    """
    if not model_id or not isinstance(model_id, str):
        return None
    for pattern, slug, _has_color in _RULES:
        if pattern.search(model_id):
            return slug
    return None


def default_logo_url(model_id: Optional[str]) -> Optional[str]:
    """Return the CDN URL for a model's default provider logo, or None.

    >>> default_logo_url('gpt-5.4').endswith('/openai.svg')
    True
    >>> default_logo_url('anthropic/claude-opus-4.6').endswith('/claude-color.svg')
    True
    >>> default_logo_url('something-totally-unknown') is None
    True
    """
    if not model_id:
        return None
    for pattern, slug, has_color in _RULES:
        if pattern.search(model_id):
            variant = f'{slug}-color' if has_color else slug
            return f'{CDN}/{variant}.svg'
    return None
