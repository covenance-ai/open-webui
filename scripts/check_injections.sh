#!/usr/bin/env bash
# Verify every Coach upstream-injection anchor is present.
# Exit 0 if all present; nonzero if any are missing.
# Run after every rebase. See COACH_INJECTIONS.md for rationale of each anchor.

set -u

cd "$(dirname "$0")/.."

fail=0

check() {
  local label="$1" file="$2" pattern="$3" want="$4"
  if [[ ! -f "$file" ]]; then
    printf '  MISSING FILE %-55s (%s)\n' "$file" "$label"
    fail=1
    return
  fi
  local n
  n=$(grep -cF -- "$pattern" "$file" 2>/dev/null || true)
  if [[ "$n" -ge "$want" ]]; then
    printf '  ok   %-55s %s\n' "$label" "($n occurrences of '$pattern')"
  else
    printf '  FAIL %-55s expected >=%d occurrence(s) of %q; found %d\n' \
      "$label" "$want" "$pattern" "$n"
    fail=1
  fi
}

echo "Checking Coach injection anchors..."

# Site 1 — backend router mount (import + include_router)
check "main.py router mount" \
  "backend/open_webui/main.py" \
  "coach_router" 2

# Site 2 — frontend init import
check "+layout.svelte init import" \
  "src/routes/+layout.svelte" \
  '$lib/coach/init' 1

# Site 3 — sidebar (marker only: panel moved to RailPanel).
# Two [coach] comments mark the old import/mount spots so a future
# upstream reshuffle doesn't silently bury them.
check "Sidebar.svelte [coach] markers" \
  "src/lib/components/layout/Sidebar.svelte" \
  "[coach]" 2

# Site 4 — Chat.svelte post-stream hook + follow-up listener
check "Chat.svelte coach:chat:finish" \
  "src/lib/components/chat/Chat.svelte" \
  "coach:chat:finish" 1
check "Chat.svelte coach:followup" \
  "src/lib/components/chat/Chat.svelte" \
  "coach:followup" 1

# Site 4b — Chat.svelte pre-flight policy screen (coachPreflight hook)
check "Chat.svelte coachPreflight" \
  "src/lib/components/chat/Chat.svelte" \
  "coachPreflight" 2
check "Chat.svelte coachAppendBlockMessage" \
  "src/lib/components/chat/Chat.svelte" \
  "coachAppendBlockMessage" 1
check "Chat.svelte markCoachReviewingPre" \
  "src/lib/components/chat/Chat.svelte" \
  "markCoachReviewingPre" 1
check "Chat.svelte markCoachApprovedPre" \
  "src/lib/components/chat/Chat.svelte" \
  "markCoachApprovedPre" 1
check "Chat.svelte coachHydrateFromHistory" \
  "src/lib/components/chat/Chat.svelte" \
  "coachHydrateFromHistory" 1

# Site 5 — Messages.svelte data-message-id anchor
check "Messages.svelte data-message-id" \
  "src/lib/components/chat/Messages.svelte" \
  "data-message-id" 1

# Site 7 — main.py OPENAI_API_CONFIGS seed (import + call)
check "main.py seed_openai_api_configs" \
  "backend/open_webui/main.py" \
  "seed_openai_api_configs" 2

# Site 8 — models.py auto-logo fallback (import + call site)
check "models.py default_logo_url" \
  "backend/open_webui/routers/models.py" \
  "default_logo_url" 2

echo
if [[ "$fail" -eq 0 ]]; then
  echo "All Coach anchors present."
else
  echo "One or more Coach anchors missing. See COACH_INJECTIONS.md for before/after snippets."
fi
exit "$fail"
