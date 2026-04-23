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

Coach runs at three distinct points in a chat's lifecycle. Only the first
two trigger an LLM call; the third is a pure UI replay.

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │                                                                      │
  │  EVENT 1 — User hits send       ◀── Chat.svelte:submitPrompt ──▶     │
  │                                                                      │
  │   Input collected by frontend (src/lib/coach/init.ts:coachPreflight) │
  │   • active policies for this user                                    │
  │   • conversation tail, linearized from history DAG via parentId,     │
  │     up to 12 turns (maxTurns*2); the candidate user message is       │
  │     appended at the end.                                             │
  │                                                                      │
  │   POST /api/v1/coach/evaluate  { phase:"pre",                        │
  │                                   chat_id, conversation:[…] }       │
  │                                                                      │
  │   Coach LLM sees  (build_preflight_prompt):                          │
  │     system: PREFLIGHT_SYSTEM_PROMPT  (prompts.py:79)                 │
  │     user:                                                            │
  │       Active policies:                                               │
  │         [<id>] <title> — <body>                                      │
  │         …                                                            │
  │       Prior conversation (last ≤10 turns, may be empty):             │
  │         user: …                                                      │
  │         assistant: …                                                 │
  │       Pending user query under review:                               │
  │         "<candidate>"                                                │
  │                                                                      │
  │   Coach returns  { action: "none" | "block",                         │
  │                    policy_id?, severity?, rationale? }               │
  │                                                                      │
  │   Frontend reacts:                                                   │
  │     action=block  → window.coachAppendBlockMessage injects an        │
  │                     assistant-shaped message (rule + rationale),     │
  │                     LLM call is NOT made, input is cleared.          │
  │     action=none   → markCoachApprovedPre stamps a 🛡 on the user     │
  │                     message; flow continues to normal submit.        │
  │     error / off   → fail open, chat proceeds.                        │
  │                                                                      │
  │  ───────────────────────────────────────────────────────────────     │
  │                                                                      │
  │  EVENT 2 — Assistant stream finishes  ◀── Chat.svelte:chat:finish ▶  │
  │                                                                      │
  │   Chat.svelte re-dispatches as window `coach:chat:finish`;           │
  │   init.ts:onChatFinish picks it up and:                              │
  │   • re-linearizes history (now includes the just-completed reply)    │
  │   • last turn is the assistant message under review.                 │
  │                                                                      │
  │   POST /api/v1/coach/evaluate  { phase:"post",                       │
  │                                   chat_id, message_id,               │
  │                                   conversation:[…] }                 │
  │                                                                      │
  │   Coach LLM sees  (build_evaluation_prompt):                         │
  │     system: SYSTEM_PROMPT  (prompts.py:12)                           │
  │     user:                                                            │
  │       Active policies:                                               │
  │         [<id>] <title> — <body>                                      │
  │         …                                                            │
  │       Recent conversation (most recent last, ≤10 turns):             │
  │         user: …                                                      │
  │         assistant: …                                                 │
  │         user (coach): …   ← marker for coach-authored follow-ups     │
  │         …                                                            │
  │         assistant: <reply under review>                              │
  │                                                                      │
  │   Coach returns  { action: "none" | "flag" | "followup",             │
  │                    policy_id?, severity?, rationale?,                │
  │                    followup_text? }                                  │
  │                                                                      │
  │   Service-side loop guard (service.py):                              │
  │     if prior user turn was coach_authored → downgrade followup→flag  │
  │                                                                      │
  │   Persistence (router._persist_coach_annotation):                    │
  │     action=none     → chat.history.messages[message_id].coach =      │
  │                       {type:"approved", phase:"post", policy_count}  │
  │     action=flag     → chat.history.messages[message_id].coach =      │
  │                       {type:"flag", severity, rationale, policy_id}  │
  │     action=followup → no persistence; frontend will replay           │
  │                                                                      │
  │   Frontend reacts:                                                   │
  │     none     → setApproval (🛡 chip / shield on assistant msg)       │
  │     flag     → setFlag (⚑ pill, styled by severity)                  │
  │     followup → dispatches window `coach:followup` →                  │
  │                Chat.svelte re-submits followup_text with             │
  │                coachAuthored=true on the new user turn.              │
  │                                                                      │
  │  ───────────────────────────────────────────────────────────────     │
  │                                                                      │
  │  EVENT 3 — Chat loaded  ◀── Chat.svelte:initChatHandler / switch ▶   │
  │                                                                      │
  │   No LLM call. Pure UI replay of what was persisted.                 │
  │                                                                      │
  │   Chat.svelte calls window.coachHydrateFromHistory(history).         │
  │   init.ts walks history.messages and for each one with a .coach      │
  │   field:                                                             │
  │     type="flag"     → setFlag (repopulates the flag store)           │
  │     type="approved" → setApproval (repopulates the chip store)       │
  │     type="block"    → no overlay — the block message's body already  │
  │                       carries the full explanation.                  │
  │                                                                      │
  │   Overlays (FlagOverlay / BadgeOverlay, or the active variant)       │
  │   re-anchor to [data-message-id] nodes and paint.                    │
  │                                                                      │
  └──────────────────────────────────────────────────────────────────────┘
```

Additional guardrails that fire across these events:

- **Demo mode** (service.py): when `cfg.demo_mode=True`, the LLM call is
  skipped entirely. Pre-flight uses `demo:block` / hiring keyword to
  produce `block`, else `none`. Post-flight rotates flag → followup →
  none per user, or triggers on `demo:flag` / `demo:followup` /
  `demo:critical` / `demo:none` keywords in the last user turn.
- **Conversation window**: backend truncates to the last 10 turns before
  rendering (`prompts.format_conversation`). Frontend linearizes up to
  12 turns; the extra is harmless — the server trim wins.
- **Fail open**: any error (evaluator exception, LLM timeout, malformed
  JSON) collapses to `action=none`. The chat is never blocked by coach
  failing; worst case the coach just produces no signal that turn.
- **Concurrency**: Event 2 writes into `chat.chat` with no transaction
  boundary; two evaluates racing on the same message can lose one
  annotation. Frontend does not parallelize evaluate calls on the same
  message, so this is tolerated.

## Local dev

Two terminals, no Docker, SQLite DB so nothing is shared with prod:

```bash
# terminal 1 — backend (FastAPI on :8080)
cd open-webui/backend
source .venv/bin/activate
DATABASE_URL=sqlite:///./coach-dev.db \
  WEBUI_SECRET_KEY=dev-local-secret \
  uvicorn open_webui.main:app --reload --port 8080

# terminal 2 — frontend (Vite on :5173)
cd open-webui
npm run dev
```

Open http://localhost:5173. Sign up (first user becomes admin). Then run
the canonical-scenarios suite in a third terminal:

```bash
cd open-webui/backend
PYTHONPATH=. python -m pytest open_webui/coach/tests/test_canonical_scenarios.py -v
```

Flip demo mode on from the Coach panel; the scripted triggers (`demo:flag`,
`demo:followup`, `demo:block`, hiring keywords) all work without a
configured coach model.

### One-command demo harness

Three scripts bring the whole pre-flight-block flow up headlessly and grab
a screenshot, so you can verify UI changes (Rule 9) without clicking
through signin + onboarding + policy creation:

```bash
scripts/coach-demo-up.sh              # start backend + vite, seed, screenshot
scripts/coach-demo-up.sh --no-shot    # seed only; useful for interactive runs
scripts/coach-demo-up.sh --teardown   # stop only the servers this script started
```

What each piece does:

- `scripts/coach-seed.mjs` — REST-only. Idempotently signs up (or signs in)
  `coach-demo@local.dev`, creates a "no HR use" policy with
  explanation_url, enables coach in demo mode with that policy active.
  Emits `{ api, token, user_id, policy_id }` JSON on stdout.
- `scripts/coach-block-screenshot.mjs` — playwright. Reads seed JSON
  from stdin or `--seed=path`, injects the token into `localStorage`
  before SvelteKit hydrates (bypassing the signin form), dismisses
  the "What's new" changelog dialog, submits a hiring prompt, waits
  for `article.coach-block`, full-page PNG to `--out=`.
- `scripts/coach-demo-up.sh` — orchestrator. Activates `.venv`, starts
  uvicorn on 8080 + vite on **5180** (not 5173 — that's commonly held
  by other local dev servers, and a wrong-page screenshot silently
  gives a bogus verification). Writes pids to `.coach-demo-logs/pids`
  for `--teardown`.

Gotchas worth remembering:

- `CORS_ALLOW_ORIGIN` must include both `localhost:$PORT` and
  `127.0.0.1:$PORT` — vite binds 127.0.0.1 but browsers treat the two
  hostnames as different origins.
- The `is_up` probe for the frontend checks the HTML for an Open WebUI
  marker; a raw HTTP 200 from some other project on the port isn't
  enough.
- `.venv` at the repo root is what uvicorn needs on its PATH. Missing
  deps? `uv pip install --python .venv/bin/python -r backend/requirements.txt`.

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

## Status indicator

The CoachPanel header shows a compact status pill driven by a small state
machine (`src/lib/coach/stores/status.ts`):

| State               | Glyph | Meaning                                             |
|---------------------|-------|-----------------------------------------------------|
| off                 | ○     | coach disabled                                      |
| idle                | ●     | enabled, nothing in flight                          |
| processing-pre      | ◐     | screening a pending user query (pre-flight)        |
| processing-post     | ◐     | reviewing an assistant reply (post-flight)         |
| ok                  | ✓     | last evaluation returned none; flashes ~4s          |
| flagged             | ⚑     | post-flight flag                                    |
| followed-up         | ↺     | post-flight followup                                |
| blocked             | ⛔    | pre-flight block (query halted before LLM call)    |
| error               | ✕     | LLM call failed                                     |

Transient states revert to `idle` (or `off` if coach was disabled mid-flash).

## Pre-flight blocking (Chat.svelte injection site 4b)

Before `submitPrompt` sends a user query to the LLM, it calls
`window.coachPreflight(userMessage, history)` (installed by
`src/lib/coach/init.ts`). On `action=block`, the submission is aborted
and the rationale is surfaced via a toast. `fail open` is deliberate —
if coach is off or the endpoint errors, the chat still goes through.

Canonical demo: with a "No LLM for hiring decisions" policy active (and
demo mode on for determinism), typing *"Help me decide whom to hire"*
produces a red **blocked** pill and halts the query with the policy's
rationale. See `test_canonical_scenarios.py` for all 12 scripted paths.

## Demo mode

Toggle in the sidebar Coach panel. When on, `/api/v1/coach/evaluate` skips
the LLM and emits a scripted verdict:

- Keyword triggers in the latest user message:
  - `demo:flag` → warn-level flag
  - `demo:critical` → critical-level flag
  - `demo:followup` → coach-authored follow-up text
  - `demo:none` → silent no-op
- No trigger → rotates through flag → followup → none per user so an
  impromptu three-turn demo still surfaces every UI path.

Demo mode needs no `coach_model_id` or active policies — useful to rehearse
UX without provider setup. Loop protection (service.py) still applies: a
preceding coach-authored user turn downgrades any demo followup to a flag.

## Activity log + event inspector

Every call into `evaluate` records two entries in-memory:
- **headline row** (per-user ring, cap 100) — status, action, model,
  tokens in/out from the OpenAI-compatible `usage` field, duration,
  policy count, any exception.
- **detail blob** (per-user ring, cap 30 — heavier) — rendered prompt,
  raw LLM reply, parsed verdict, active policies snapshot, conversation
  the coach saw.

The CoachPanel renders the headline strip under **Activity**; each row
has an **inspect** button that fetches the detail blob and opens a
modal. That's the "why did the coach do X" view — prompt and reply
side-by-side with the parsed verdict.

On every evaluate we also emit a structured JSON `log.info` line with
event_id, status, action, tokens, duration, demo flag, skip reason,
error. Cloud Logging auto-parses JSON payloads, so in the GCP log
explorer filter by `jsonPayload.event="coach.evaluate"` and slice by
any field.

API:
- `GET  /api/v1/coach/events?limit=50` — headline list, newest first.
- `GET  /api/v1/coach/events/{id}`     — detail blob for one event.
- `DELETE /api/v1/coach/events`        — wipe both rings (useful before a demo).

Both rings reset on container restart. Scaling past one Cloud Run
instance would split the buffer across replicas — fine for diagnostics,
not for audit (persist to a DB at that point).

## Playground (dry-run)

`POST /api/v1/coach/dry-run` evaluates a hypothetical transcript without
touching a chat, without recording an event, without writing a log. Body:

```json
{
  "conversation": [{"role":"user","content":"..."}, ...],
  "policy_ids":   ["abc", "def"],    // null → caller's active set
  "coach_model_id": "gpt-5.4-mini",  // null → caller's saved model
  "demo_mode":   false,              // null → caller's demo flag
  "enabled":     true                // null → caller's enabled flag
}
```

Response is the same shape as `GET /events/{id}` so the frontend renders
it with one component. Use it to iterate on policy wording, compare
candidate coach models, or rehearse a demo — the CoachPanel opens it
under **▶ Playground (dry-run)** with a two-field transcript composer.

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

- Cypress e2e tests not yet written (Phase 7 — upstream harness is
  broken and needs fixing first).
- Coach-authored user messages are not visually distinguished from
  human-written ones yet (CoachBadge.svelte is a Phase 6 polish).
