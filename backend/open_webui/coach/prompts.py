"""Coach LLM prompt templates.

The evaluation prompt concatenates all active policies and the last N turns
of the conversation, asks for a single JSON verdict. A single call per
assistant turn — we pick the most critical violation if multiple policies
match.
"""

from open_webui.coach.schemas import ConversationTurn, CoachPolicyResponse


SYSTEM_PROMPT = """You are a coach observing a conversation between a human user and an AI assistant.

You are given a list of active policies (natural-language rules). After each assistant response you decide whether the assistant's latest reply violates any policy.

Your verdict is one of:
- "none"     — no violation; respond with action=none.
- "followup" — the issue is fixable by a short user-style follow-up prompt that nudges the assistant to correct itself. Provide the message text in `followup_text`.
- "flag"     — the issue is problematic but a re-prompt won't fix it (e.g. already-leaked info, missing external context). Provide a one-sentence rationale in `rationale` and a severity.

Rules:
1. Output JSON only, no prose, no code fence. Must match this schema exactly:
   {"action": "none"|"flag"|"followup",
    "policy_id": "<id>" | null,
    "severity": "info"|"warn"|"critical" | null,
    "rationale": "<= 280 chars" | null,
    "followup_text": "<= 500 chars" | null}
2. At most one policy may be reported per message — pick the most critical violation.
3. If you choose `followup`, `followup_text` must be written as if the human user wrote it (direct, imperative).
4. If you cannot produce valid JSON, output exactly {"action":"none"}.
"""


def format_policies(policies: list[CoachPolicyResponse]) -> str:
    """Render the active policy list for inclusion in the system prompt."""
    if not policies:
        return '(no active policies)'
    lines = []
    for p in policies:
        # Keep each one compact; the coach model does better with short rules.
        lines.append(f'[{p.id}] {p.title} — {p.body}')
    return '\n'.join(lines)


def format_conversation(turns: list[ConversationTurn], max_turns: int = 10) -> str:
    """Render the tail of the conversation for the coach, marking coach-
    authored user messages so the coach can avoid recursing on its own
    follow-ups."""
    # Keep only the most recent `max_turns` turns; coach doesn't need deep
    # history and longer transcripts increase cost + reduce signal.
    tail = turns[-max_turns:]
    rendered = []
    for t in tail:
        prefix = f'{t.role}'
        if t.coach_authored:
            prefix += ' (coach)'
        rendered.append(f'{prefix}: {t.content}')
    return '\n'.join(rendered)


def build_evaluation_prompt(
    policies: list[CoachPolicyResponse], conversation: list[ConversationTurn]
) -> list[dict]:
    """Produce the messages array for the coach LLM call (post-flight)."""
    system = SYSTEM_PROMPT.strip()
    user_content = (
        'Active policies:\n'
        f'{format_policies(policies)}\n\n'
        'Recent conversation (most recent last):\n'
        f'{format_conversation(conversation)}\n\n'
        'Emit your verdict as JSON only.'
    )
    return [
        {'role': 'system', 'content': system},
        {'role': 'user', 'content': user_content},
    ]


PREFLIGHT_SYSTEM_PROMPT = """You are a coach screening user queries before they reach an AI assistant.

You are given a list of active policies (natural-language rules). Given the user's pending question (and any prior conversation for context), decide whether answering the question would violate any policy.

Your verdict is one of:
- "none"  — the query is fine; do not interrupt.
- "block" — the query would cause a policy violation if answered. Briefly explain which rule would be broken in `rationale` — the user will see this.

Rules:
1. Output JSON only, no prose, no code fence. Must match this schema exactly:
   {"action": "none"|"block",
    "policy_id": "<id>" | null,
    "severity": "info"|"warn"|"critical" | null,
    "rationale": "<= 280 chars" | null}
2. At most one policy per verdict — pick the most relevant.
3. Only block when the query clearly matches a policy; marginal cases should be "none".
4. If you cannot produce valid JSON, output exactly {"action":"none"}.
"""


def build_preflight_prompt(
    policies: list[CoachPolicyResponse], conversation: list[ConversationTurn]
) -> list[dict]:
    """Messages for a pre-flight coach call.

    The pending user query is the last turn; earlier turns are context.
    """
    system = PREFLIGHT_SYSTEM_PROMPT.strip()
    # Identify the pending query so the coach doesn't confuse itself.
    pending = next(
        (t.content for t in reversed(conversation) if t.role == 'user'),
        '',
    )
    user_content = (
        'Active policies:\n'
        f'{format_policies(policies)}\n\n'
        'Prior conversation (most recent last, may be empty):\n'
        f'{format_conversation(conversation[:-1] if conversation else [])}\n\n'
        "Pending user query under review:\n"
        f'"{pending}"\n\n'
        'Emit your verdict as JSON only.'
    )
    return [
        {'role': 'system', 'content': system},
        {'role': 'user', 'content': user_content},
    ]
