#!/usr/bin/env bash
# One-shot: bring up backend + frontend, seed coach state, take a screenshot.
#
# Idempotent — reuses servers if already running on the default ports,
# and the seed script reuses the same user/policy on reruns.
#
# Usage:
#   scripts/coach-demo-up.sh            # seed + screenshot
#   scripts/coach-demo-up.sh --no-shot  # seed only, leave browser-free
#   scripts/coach-demo-up.sh --teardown # stop servers started by this script
#
# Environment:
#   BACKEND_PORT  (default 8080)
#   FRONTEND_PORT (default 5173)  — first free 5173+ is auto-picked by vite
#   DATA_DIR      (default ./data_coach_demo) — keep seed data out of prod

set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

# Activate the local venv if present — backend dev defaults to one at
# ./.venv and starting uvicorn from the system Python would miss all
# the open_webui deps.
if [[ -f "$REPO_ROOT/.venv/bin/activate" ]]; then
	# shellcheck disable=SC1091
	source "$REPO_ROOT/.venv/bin/activate"
fi

export DATA_DIR="${DATA_DIR:-$REPO_ROOT/data_coach_demo}"
BACKEND_PORT="${BACKEND_PORT:-8080}"
# 5180 instead of vite's default 5173 — 5173 is commonly held by other
# local dev servers, and a wrong-page screenshot silently gives a bogus
# verification, which is worse than the port being less discoverable.
FRONTEND_PORT="${FRONTEND_PORT:-5180}"
LOG_DIR="$REPO_ROOT/.coach-demo-logs"
mkdir -p "$LOG_DIR" "$DATA_DIR"

PID_FILE="$LOG_DIR/pids"

log() { echo "[coach-demo] $*" >&2; }

teardown() {
	if [[ -f "$PID_FILE" ]]; then
		log "stopping previously started servers"
		while read -r pid; do
			[[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
		done < "$PID_FILE"
		rm -f "$PID_FILE"
	fi
}

if [[ "${1:-}" == "--teardown" ]]; then
	teardown
	exit 0
fi

is_up() {
	local url="$1"
	curl -sf -o /dev/null -w "%{http_code}" --max-time 1 "$url" 2>/dev/null | grep -qE '^(2|3|4)'
}

wait_for() {
	local name="$1" url="$2" tries="${3:-60}"
	for ((i=0; i<tries; i++)); do
		if is_up "$url"; then
			log "$name ready at $url"
			return 0
		fi
		sleep 1
	done
	log "$name did not come up at $url within $tries s"
	return 1
}

# ── Backend ──────────────────────────────────────────────────────────
if is_up "http://localhost:$BACKEND_PORT/"; then
	log "backend already running on :$BACKEND_PORT (not starting)"
else
	log "starting backend on :$BACKEND_PORT (data dir: $DATA_DIR)"
	pushd backend >/dev/null
	CORS_ALLOW_ORIGIN="http://localhost:$FRONTEND_PORT;http://127.0.0.1:$FRONTEND_PORT;http://localhost:$BACKEND_PORT;http://127.0.0.1:$BACKEND_PORT" \
	PORT="$BACKEND_PORT" \
	DATA_DIR="$DATA_DIR" \
	WEBUI_AUTH=True \
	ENABLE_SIGNUP=True \
	DEFAULT_USER_ROLE=admin \
		nohup uvicorn open_webui.main:app --port "$BACKEND_PORT" --host 127.0.0.1 \
		>"$LOG_DIR/backend.log" 2>&1 &
	echo $! >> "$PID_FILE"
	popd >/dev/null
	wait_for "backend" "http://localhost:$BACKEND_PORT/api/config"
fi

# ── Frontend ─────────────────────────────────────────────────────────
# Vite picks the next free port when $FRONTEND_PORT is taken, so we
# parse the chosen URL from its startup log.
#
# The "is it already up?" probe also checks the served HTML for an
# Open WebUI marker, so a stray dev server from another project
# happening to hold the port doesn't fool us into screenshotting it.
is_our_frontend() {
	local html
	html=$(curl -sf --max-time 2 "$1" 2>/dev/null || true)
	[[ -n "$html" ]] && echo "$html" | grep -qiE 'open.?webui|coach'
}

FRONTEND_URL=""
if is_our_frontend "http://localhost:$FRONTEND_PORT/"; then
	FRONTEND_URL="http://localhost:$FRONTEND_PORT"
	log "frontend already running on :$FRONTEND_PORT (not starting)"
else
	log "starting frontend (vite dev)"
	PUBLIC_API_BASE_URL="http://localhost:$BACKEND_PORT" \
		nohup npx vite dev --port "$FRONTEND_PORT" --strictPort false --host 127.0.0.1 \
		>"$LOG_DIR/frontend.log" 2>&1 &
	echo $! >> "$PID_FILE"
	# Poll the log for the chosen URL; vite prints "Local: http://..."
	for ((i=0; i<60; i++)); do
		url=$(grep -oE 'http://127\.0\.0\.1:[0-9]+/?' "$LOG_DIR/frontend.log" | head -n1 || true)
		if [[ -n "$url" ]] && is_up "$url"; then
			FRONTEND_URL="${url%/}"
			log "frontend ready at $FRONTEND_URL"
			break
		fi
		sleep 1
	done
	if [[ -z "$FRONTEND_URL" ]]; then
		log "frontend never reported a ready URL; see $LOG_DIR/frontend.log"
		exit 1
	fi
fi

# ── Seed ─────────────────────────────────────────────────────────────
log "seeding coach state via API"
SEED_JSON=$(node scripts/coach-seed.mjs --api="http://localhost:$BACKEND_PORT" | tail -n1)
echo "$SEED_JSON" > "$LOG_DIR/seed.json"
log "seed: $(echo "$SEED_JSON" | tr -d '\n')"

# ── Screenshot ───────────────────────────────────────────────────────
if [[ "${1:-}" == "--no-shot" ]]; then
	log "skipping screenshot (--no-shot)"
	echo "$SEED_JSON"
	exit 0
fi

OUT="${OUT:-/tmp/coach-block-$(date +%s).png}"
log "driving block flow and capturing $OUT"
node scripts/coach-block-screenshot.mjs \
	--seed="$LOG_DIR/seed.json" \
	--frontend="$FRONTEND_URL" \
	--out="$OUT"

echo "$OUT"
