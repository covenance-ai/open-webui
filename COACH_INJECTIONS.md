# Coach upstream injection points

This file is the **source of truth** for every line we edit in upstream code.
After any rebase, run `bash scripts/check_injections.sh` — it greps each
anchor below and fails loudly if an injection dropped off.

Conventions:

- "Anchor" is a grep-able string that is stable in upstream. If it changes,
  fix the anchor first, then our edit.
- Upstream version captured against: **v0.8.12** (commit 9bd84258d, main at clone time).
- Edits are always **additive** — we never delete or modify upstream lines,
  only add ours next to them.

---

## Site 1 — `backend/open_webui/main.py` (router mount)

**What**: mount the coach router.

**Anchor**: any existing `app.include_router(...)` call for an /api/v1 router.

**Change**: add a 1-line import near the other router imports (~line 71) and
a 1-line `include_router` call near the other mounts (~line 1491).

Before (surrounding context):
```python
# (imports)
from open_webui.routers import (
    ...
    openai,
    pipelines,
    ...
)

# (router mounts)
app.include_router(openai.router, prefix="/openai", tags=["openai"])
app.include_router(pipelines.router, prefix="/api/v1/pipelines", tags=["pipelines"])
```

After:
```python
# (imports)
from open_webui.routers import (
    ...
    openai,
    pipelines,
    ...
)
from open_webui.coach.router import router as coach_router  # [coach]

# (router mounts)
app.include_router(openai.router, prefix="/openai", tags=["openai"])
app.include_router(pipelines.router, prefix="/api/v1/pipelines", tags=["pipelines"])
app.include_router(coach_router, prefix="/api/v1/coach", tags=["coach"])  # [coach]
```

Grep anchor: `grep -nF "coach_router" backend/open_webui/main.py` should
return exactly 2 lines.

---

## Site 2 — `src/routes/+layout.svelte` (frontend init)

**What**: side-effect import of our init module so stores, overlays, and
event listeners are wired up once at layout time.

**Anchor**: the top-of-file `<script>` block or module-level imports.

Change:
```svelte
<script>
  // existing imports ...
  import '$lib/coach/init';  // [coach]
</script>
```

Grep anchor: `grep -nF "$lib/coach/init" src/routes/+layout.svelte` returns 1 line.

---

## Site 3 — `src/lib/components/layout/Sidebar.svelte` (sidebar UI)

**What**: render the `<CoachPanel />` section in the sidebar.

**Anchor**: the sticky-bottom region of the sidebar (above `UserMenu`) where
other user-level controls already live.

Change:
```svelte
<script>
  // existing imports ...
  import CoachPanel from '$lib/coach/components/CoachPanel.svelte';  // [coach]
</script>

<!-- ... existing sidebar body ... -->
<div class="sticky bottom-0 ...">
  <CoachPanel />  <!-- [coach] -->
  <UserMenu ... />
</div>
```

Grep anchor: `grep -nF "CoachPanel" src/lib/components/layout/Sidebar.svelte` returns 2 lines.

---

## Site 4 — `src/lib/components/chat/Chat.svelte` (post-stream hook + follow-up listener)

**What**: two small additions at one site:
1. After the assistant stream finishes (where the upstream already fires its
   local `chat:finish` event), also dispatch a **window** custom event so
   `src/lib/coach/init.ts` can hear it from outside the component.
2. In `onMount`, listen for `coach:followup` and invoke the chat's
   `submitPrompt` with the coach-generated text plus `coach_authored=true`
   metadata.

**Anchor**: the existing `eventTarget.dispatchEvent(new CustomEvent('chat:finish'...` near line 1720.

Change (pseudocode):
```svelte
<script>
  // after stream completes — existing:
  eventTarget.dispatchEvent(new CustomEvent('chat:finish', { detail: { ... } }));
  // [coach] forward to window so our standalone init.ts can react
  window.dispatchEvent(new CustomEvent('coach:chat:finish', {
    detail: { chatId: $chatId, messageId: <assistant msg id>, conversation: <trimmed history> }
  }));

  // in onMount — existing mount logic...
  // [coach] listen for coach follow-up injection
  const coachFollowup = (e) => submitPrompt(e.detail.text, { coachAuthored: true, coachPolicyId: e.detail.policy_id });
  window.addEventListener('coach:followup', coachFollowup);
  onDestroy(() => window.removeEventListener('coach:followup', coachFollowup));
</script>
```

Grep anchors:
- `grep -nF "coach:chat:finish" src/lib/components/chat/Chat.svelte` returns 1 line.
- `grep -nF "coach:followup" src/lib/components/chat/Chat.svelte` returns 1+ lines.

---

## Site 4b — `src/lib/components/chat/Chat.svelte` (pre-flight policy screen + in-chat block)

**What**: at the top of `submitPrompt`, call `window.coachPreflight`. On
`action=block`, render a coach-authored "assistant" message containing the
rule + rationale via `window.coachAppendBlockMessage`, persist the chat,
and return without sending the query to the LLM. On `action=none` *and*
`evaluated=true`, mark the freshly-added user message as coach-approved
via `window.markCoachApprovedPre` so the UI can render the approved state.
Also call `window.markCoachReviewingPre` as soon as the user message id
is known, so the UI can show a reviewing chip while `coachPreflight`
awaits the verdict.

Also: on chat load (history hydrated from the server), call
`window.coachHydrateFromHistory(history)` so persisted flags/approvals
re-populate the stores without waiting for the next message.

**Anchor**: the first line of `submitPrompt` — the `console.log('submitPrompt', ...)`,
and the `history.messages[userMessageId] = userMessage` line further down
where the user message gets added. The hydration hook sits where history
is loaded from the server (around the `initChatHandler` call site).

Change (block path):
```svelte
const submitPrompt = async (userPrompt, { _raw = false } = {}) => {
  console.log('submitPrompt', userPrompt, $chatId);

  // [coach] Pre-flight policy screen.
  const coachPreflight = (window)?.coachPreflight;
  if (typeof coachPreflight === 'function' && userPrompt) {
    (window)?.markCoachReviewingPre?.(userMessageId);
    await tick();
    const coachPreflightVerdict = await coachPreflight(userPrompt, history, $chatId);
    if (coachPreflightVerdict?.action === 'block') {
      (window)?.clearCoachBadge?.(userMessageId);
      const appendBlock = (window)?.coachAppendBlockMessage;
      if (typeof appendBlock === 'function') {
        const { coachMessageId } = appendBlock(history, userMessageId, coachPreflightVerdict);
        // ...persist via updateChatById, clear input...
      } else {
        toast.error(`Coach blocked: ${coachPreflightVerdict.rationale ?? 'policy violation'}`);
      }
      return;
    }
    if (coachPreflightVerdict?.action === 'none' && coachPreflightVerdict.evaluated) {
      (window)?.markCoachApprovedPre?.(userMessageId, history);
    } else {
      (window)?.clearCoachBadge?.(userMessageId);
    }
  }
  // ... existing body ...
```

Change (history hydration, on chat load):
```svelte
// ...existing history load...
(window)?.coachHydrateFromHistory?.(history);
```

All hooks (`coachPreflight`, `coachAppendBlockMessage`,
`markCoachReviewingPre`, `markCoachApprovedPre`, `clearCoachBadge`,
`coachHydrateFromHistory`) are installed on `window` by
`src/lib/coach/init.ts`. They stay dumb and fail open if coach internals
aren't loaded yet.

Grep anchors:
- `grep -nF "coachPreflight" src/lib/components/chat/Chat.svelte` returns 2+ lines.
- `grep -nF "coachAppendBlockMessage" src/lib/components/chat/Chat.svelte` returns 1 line.
- `grep -nF "markCoachReviewingPre" src/lib/components/chat/Chat.svelte` returns 1 line.
- `grep -nF "markCoachApprovedPre" src/lib/components/chat/Chat.svelte` returns 1 line.
- `grep -nF "coachHydrateFromHistory" src/lib/components/chat/Chat.svelte` returns 1 line.

---

## Site 5 — `src/lib/components/chat/Messages.svelte` (overlay anchor)

**What**: add `data-message-id={message.id}` to the wrapper `<div>` of each
`{#each messages as message (message.id)}` iteration so `FlagOverlay` and
`BadgeOverlay` can find the DOM node for a message by id.

**Anchor**: the `{#each}` that iterates messages.

Change:
```svelte
{#each messages as message (message.id)}
  <div data-message-id={message.id}>  <!-- [coach] anchor for FlagOverlay/BadgeOverlay -->
    {#if message.role === 'user'}
      <UserMessage ... />
    {:else}
      <ResponseMessage ... />
    {/if}
  </div>
{/each}
```

If the upstream wrapper `<div>` already exists with other attributes, we just
add the `data-message-id` attribute. If there is no wrapper, we add one.

Grep anchor: `grep -nF "data-message-id" src/lib/components/chat/Messages/Messages.svelte` returns 1 line.

---

## Site 7 — `backend/open_webui/main.py` (OPENAI_API_CONFIGS seed)

**What**: seed a curated per-connection model allowlist on startup so fresh
installs don't show every upstream model. Logic lives in
`backend/open_webui/coach/config_seed.py` and is keyed by provider base URL.
Idempotent: only writes when the current config is empty.

**Anchor**: the existing `app.state.config.OPENAI_API_CONFIGS = OPENAI_API_CONFIGS`
line (~line 778) in the OpenAI state-init block.

Change:
```python
# (imports near the other coach import around line 101)
from open_webui.coach.router import router as coach_router  # [coach]
from open_webui.coach.config_seed import seed_openai_api_configs  # [coach]

# (state init around line 778)
app.state.config.OPENAI_API_CONFIGS = OPENAI_API_CONFIGS
seed_openai_api_configs(app)  # [coach]
```

Grep anchor: `grep -nF "seed_openai_api_configs" backend/open_webui/main.py` returns 2 lines.

---

## Site 6 — `our_webui/deploy.sh` (build our fork)

**What**: replace the ghcr.io proxy with an Artifact Registry repo we own,
build our fork via Cloud Build, tag by git SHA, point Cloud Run at it.

This is an edit to the deploy script in the outer `our_webui/` directory,
not to upstream — listed here for completeness since rebasing the fork does
not affect it. See `README.md` in `our_webui/` for the updated flow.

---

## Cheatsheet: check all anchors at once

```bash
bash scripts/check_injections.sh
```

A non-zero exit means at least one anchor is missing; read the script's
output for which.
