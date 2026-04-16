# Coach module

A fork-owned feature that pairs every chat with a second LLM — the **coach** —
which watches the conversation, evaluates it against user-configured
**policies**, and either auto-sends a user-style follow-up to nudge the main
assistant, or attaches a non-blocking flag to the assistant message.

This document is the orientation map. See `COACH_INJECTIONS.md` for the exact
list of upstream files we touch.

## Why this fork

All coach logic lives in two isolated subtrees:

- `backend/open_webui/coach/` — FastAPI router, SQLAlchemy models, evaluation
  service, prompts.
- `src/lib/coach/` — Svelte UI, stores, fetch wrappers, overlay renderers.

Plus one peewee migration at `backend/open_webui/internal/migrations/019_add_coach_tables.py`
(auto-discovered by the upstream migration runner — no registration needed).

Everything else is **upstream code**. We touch it only at a small number of
injection points, each listed in `COACH_INJECTIONS.md` with before/after
snippets and grep anchors.

## Data model

Two new tables (alembic migrations `c0ac40c0f1c0` and `c0ac40c0f1c1`):

- `coach_policy` — a natural-language rule. `user_id=NULL, is_shared=true`
  means admin-published (visible to everyone); otherwise it's personal to one
  user.
- `coach_config` — one row per user: `enabled`, `coach_model_id`,
  `active_policy_ids` (a JSON list of policy ids the user has switched on).

Note: migration `c0ac40c0f1c0` doubles as a **merge** of upstream's two
alembic heads (`018012973d35` + `b2c3d4e5f6a7`). After this point the
chain is linear from our fork; a future rebase onto new upstream may
introduce another set of heads, in which case we'll need a fresh merge
revision.

Flags and coach-authored user messages are **embedded** in the existing
`chat.chat` JSON — no third table. Router writes
`chat.history.messages[<id>].coach = {severity, rationale, policy_id,
created_at}` on `action=flag`. Coach-authored user messages (Phase 6+)
live at `chat.history.messages[<id>].coach_authored = true`.

## Evaluation flow

```
assistant stream finishes in Chat.svelte
   → window dispatch `coach:chat:finish` with chat_id + message_id
   → src/lib/coach/init.ts handler
     → POST /api/v1/coach/evaluate { chat_id, message_id, conversation }
   → backend/open_webui/coach/service.py
     - loads user's CoachConfig + active policies
     - builds one coach-LLM call, all policies concatenated
     - parses JSON verdict: { action: none|flag|followup, ... }
     - action=flag     → persists the flag in chat.chat JSON
     - action=followup → returns verdict; frontend injects the follow-up
   → init.ts
     - flag     → re-renders via FlagOverlay (MutationObserver on [data-message-id])
     - followup → dispatches `coach:followup`; Chat.svelte submits it
```

Infinite-loop protection: if the preceding user message is already
`coach_authored=true`, service.py downgrades any `followup` verdict to `flag`.
Max chain length 1 (configurable later).

## Local dev

See `README.md` for upstream dev instructions. Coach-specific notes:

- Run `scripts/check_injections.sh` after every rebase — see below.
- Backend tests live in `backend/open_webui/coach/tests/`. They test the
  storage layer and the evaluation service directly, bypassing
  open_webui.utils.auth (which requires the full upstream DB):
  ```
  cd backend
  uv venv .venv && source .venv/bin/activate
  uv pip install -r requirements-min.txt pytest hypothesis markdown pytz python-mimeparse
  PYTHONPATH=. python -m pytest open_webui/coach/tests -q
  ```
  A few tests skip gracefully when they'd require the full upstream DB
  (router-import permission tests); they run against the deployed service
  via curl.
- Smoke-test the deployed endpoints with curl (see `§Verification` below).
- Frontend: no vitest yet — manual verification against the deployed
  service. The upstream cypress harness is broken; fixing is Phase 7.

## Rebase procedure

```
cd our_webui/open-webui
git fetch upstream
git checkout coach
git rebase upstream/main                   # conflicts surface at injection sites

# After conflicts resolved:
bash scripts/check_injections.sh           # every anchor must pass
cd backend && uv run pytest open_webui/coach/tests -q
cd .. && npm install && npm run test:frontend -- --run src/lib/coach

# Sanity: migration on fresh SQLite
rm -f /tmp/coach-rebase.db
DATABASE_URL=sqlite:////tmp/coach-rebase.db \
  uv run python -c "from open_webui.internal import db; print('migrations ok')"

git push --force-with-lease origin coach
```

If `check_injections.sh` fails, the named site needs re-applying. Consult
`COACH_INJECTIONS.md` for the before/after snippet.

Common rebase scenarios:

- **Upstream renames `chat:finish` → `chat:complete`** — our Chat.svelte hunk
  conflicts. Rename in the injection; update `COACH_INJECTIONS.md`.
- **Upstream removes the sticky UserMenu region in Sidebar.svelte** — our
  sidebar anchor is gone. Pick a new anchor, update the injection manifest.
- **Upstream changes `chat.history.messages[id]` shape** — we use our own key
  (`.coach`) so additive changes don't break us; structural changes do.
  Integration tests catch this.

## FAQ

**What coach model should I pick?** Anything in the configured allowlist. For
cost-sensitive deployments, pick a small fast model (e.g. a sonnet- or mini-
class model). For high-stakes compliance, pick the strongest one available.

**Why can't I see my policies for other users?** Personal policies are owned
by a user and invisible to others. If you want a policy to apply team-wide,
promote it to shared via the admin menu (requires admin role).

**Will coach send an infinite chain of follow-ups?** No. Loop protection in
`service.py` forces `flag` (or `none`) if the immediately-preceding user
message is already coach-authored.

## Verification

Quick smoke once deployed:

```bash
URL="https://our-webui-430011644943.europe-west1.run.app"
ADMIN_PW=$(gcloud secrets versions access latest --secret=webui-admin-password --project=covenance-469421)
TOKEN=$(curl -s -X POST "${URL}/api/v1/auths/signin" -H 'Content-Type: application/json' \
  -d "{\"email\":\"ilya@covenance.ai\",\"password\":\"${ADMIN_PW}\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

# Config autocreate
curl -s "${URL}/api/v1/coach/config" -H "Authorization: Bearer ${TOKEN}" | jq

# Create a personal policy
POLICY=$(curl -s -X POST "${URL}/api/v1/coach/policies" \
  -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d '{"title":"Test","body":"Always mention sources."}')
echo "$POLICY" | jq
PID=$(echo "$POLICY" | jq -r .id)

# Enable and activate
curl -s -X POST "${URL}/api/v1/coach/config" \
  -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d "{\"enabled\":true,\"coach_model_id\":\"gpt-5.4-mini\",\"active_policy_ids\":[\"${PID}\"]}" | jq

# Trigger evaluate
curl -s -X POST "${URL}/api/v1/coach/evaluate" \
  -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d '{"conversation":[{"role":"user","content":"What is 2+2?"},{"role":"assistant","content":"4"}]}' | jq
```

Expected: config returns autocreated default, policy CRUD works, evaluate
returns `{action: ...}` with whatever verdict the coach LLM produced.

## Known limitations (Phase 7 backlog)

- Persisted flags (in `chat.chat.history`) do not re-surface in the UI on
  a page reload until another message is sent in that chat. Need a
  `coach:chat:loaded` event dispatched when Chat.svelte hydrates history.
- Cypress e2e tests not yet written (Phase 7 — upstream harness is
  broken and needs fixing first).
- Coach-authored user messages are not visually distinguished from
  human-written ones yet (CoachBadge.svelte is a Phase 6 polish).
