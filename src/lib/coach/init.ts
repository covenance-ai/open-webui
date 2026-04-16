// Coach side-effect bootstrap.
//
// Imported once from src/routes/+layout.svelte (injection site #2). Here we:
// 1. Subscribe to the user store; on login bootstrap config + policies.
// 2. Listen for window `coach:chat:finish` (dispatched by Chat.svelte, site #4).
// 3. Call /api/v1/coach/evaluate; apply the verdict:
//      - flag    → set a transient flag in the flags store.
//      - followup→ dispatch window `coach:followup` — Chat.svelte listens and
//                  re-submits the message through the normal chat pipeline.
//
// We intentionally do NOT boot coach stores on the auth screen; waiting for
// $user to be non-null avoids unauthenticated 401s during first paint.

import { get } from 'svelte/store';
import { user } from '$lib/stores';
import * as api from './api';
import { coachConfig } from './stores/config';
import { coachFlags, setFlag } from './stores/flags';
import { coachPolicies } from './stores/policies';

let bootstrapped = false;
let evalWired = false;

function getToken(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.token ?? null;
}

async function bootstrap() {
	if (bootstrapped) return;
	const token = getToken();
	if (!token) return;
	bootstrapped = true;
	try {
		const [cfg, pols] = await Promise.all([api.getCoachConfig(token), api.listCoachPolicies(token)]);
		coachConfig.set(cfg);
		coachPolicies.set(pols);
	} catch (err) {
		console.warn('[coach] bootstrap failed:', err);
		bootstrapped = false;
	}
}

// ── Linearize the upstream message DAG ──────────────────────────────
// Open WebUI stores history as { messages: {id: msg}, currentId }, with
// msg.parentId. We walk from currentId backwards to build the linear tail.

interface UpstreamMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content?: string;
	parentId?: string | null;
	// Our own additions (Phase 6): coach-authored user messages.
	coachAuthored?: boolean;
	coach_authored?: boolean;
}

interface UpstreamHistory {
	messages: Record<string, UpstreamMessage>;
	currentId?: string | null;
}

function linearize(history: UpstreamHistory | undefined, maxTurns = 12) {
	if (!history || !history.messages || !history.currentId) return [];
	const out: Array<{ role: string; content: string; coach_authored: boolean }> = [];
	let id: string | null | undefined = history.currentId;
	while (id && out.length < maxTurns * 2) {
		const m = history.messages[id];
		if (!m) break;
		const content = typeof m.content === 'string' ? m.content : '';
		out.push({
			role: m.role,
			content,
			coach_authored: Boolean(m.coachAuthored ?? m.coach_authored ?? false)
		});
		id = m.parentId ?? null;
	}
	return out.reverse();
}

// ── Evaluate handler ────────────────────────────────────────────────

async function onChatFinish(e: Event) {
	const token = getToken();
	if (!token) return;
	const cfg = get(coachConfig);
	if (!cfg?.enabled || !cfg?.coach_model_id || (cfg.active_policy_ids?.length ?? 0) === 0) {
		return;
	}

	const detail = (e as CustomEvent).detail as {
		chatId?: string | null;
		messageId?: string;
		history?: UpstreamHistory;
	};
	const conv = linearize(detail?.history);
	if (conv.length === 0) return;

	let verdict;
	try {
		verdict = await (await fetch(`${location.origin}/api/v1/coach/evaluate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`
			},
			body: JSON.stringify({
				chat_id: detail?.chatId ?? null,
				message_id: detail?.messageId ?? null,
				conversation: conv
			})
		})).json();
	} catch (err) {
		console.warn('[coach] evaluate failed:', err);
		return;
	}

	if (!verdict || verdict.action === 'none') return;

	if (verdict.action === 'flag' && detail?.messageId && verdict.rationale) {
		setFlag(detail.messageId, {
			severity: verdict.severity ?? 'warn',
			rationale: verdict.rationale,
			policyId: verdict.policy_id ?? null,
			createdAt: Date.now()
		});
		return;
	}

	if (verdict.action === 'followup' && typeof verdict.followup_text === 'string') {
		window.dispatchEvent(
			new CustomEvent('coach:followup', {
				detail: {
					text: verdict.followup_text,
					policy_id: verdict.policy_id ?? null
				}
			})
		);
	}
}

function wireEvaluator() {
	if (evalWired || typeof window === 'undefined') return;
	evalWired = true;
	window.addEventListener('coach:chat:finish', onChatFinish);
}

// Wire up immediately (side-effect import time). bootstrap() kicks in as
// soon as `user` becomes available.
wireEvaluator();

user.subscribe((u) => {
	if (u) {
		void bootstrap();
	}
});
