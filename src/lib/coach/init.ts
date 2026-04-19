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
import { WEBUI_API_BASE_URL } from '$lib/constants';
import * as api from './api';
import { setApproval } from './stores/approvals';
import { coachConfig } from './stores/config';
import { refreshCoachEvents } from './stores/events';
import { coachFlags, setFlag } from './stores/flags';
import { coachPolicies } from './stores/policies';
import { flashCoachResult, setCoachProcessing } from './stores/status';

function uuidv4(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

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
		void refreshCoachEvents(token);
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
	const detail = (e as CustomEvent).detail as {
		chatId?: string | null;
		messageId?: string;
		history?: UpstreamHistory;
	};
	const chatId = detail?.chatId ?? null;
	// Gate: coach must be enabled, and either demo_mode on (scripted verdicts,
	// no model/policy needed) or the real path fully configured.
	const realPathReady = Boolean(
		cfg?.coach_model_id && (cfg?.active_policy_ids?.length ?? 0) > 0
	);
	if (!cfg?.enabled || (!cfg.demo_mode && !realPathReady)) {
		return;
	}

	const conv = linearize(detail?.history);
	if (conv.length === 0) return;

	setCoachProcessing('post', chatId);
	let verdict;
	try {
		verdict = await (await fetch(`${WEBUI_API_BASE_URL}/coach/evaluate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`
			},
			body: JSON.stringify({
				chat_id: chatId,
				message_id: detail?.messageId ?? null,
				conversation: conv,
				phase: 'post'
			})
		})).json();
	} catch (err) {
		console.warn('[coach] evaluate failed:', err);
		flashCoachResult('error', chatId);
		return;
	} finally {
		// Refresh the activity log regardless of verdict — error rows are the
		// whole point of the strip.
		void refreshCoachEvents(token);
	}

	// Reflect the verdict in the status indicator.
	if (!verdict || verdict.action === 'none') {
		flashCoachResult('ok', chatId);
		// Coach reviewed and let the assistant reply through — annotate
		// the message with a green shield so the user sees the review
		// happened. policy_count is unknown post-hoc; the active set
		// at evaluation time is the upper bound.
		if (detail?.messageId) {
			setApproval(detail.messageId, {
				phase: 'post',
				policyCount: cfg?.active_policy_ids?.length ?? 0,
				createdAt: Date.now()
			});
		}
		return;
	}
	if (verdict.action === 'flag') {
		flashCoachResult('flagged', chatId);
	} else if (verdict.action === 'followup') {
		flashCoachResult('followed-up', chatId);
	}

	if (verdict.action === 'none') return;

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

let overlayMounted = false;
async function mountOverlay() {
	if (overlayMounted || typeof window === 'undefined') return;
	overlayMounted = true;
	try {
		const { mount } = await import('svelte');
		const FlagOverlay = (await import('./overlay/FlagOverlay.svelte')).default;
		const StatusOverlay = (await import('./overlay/StatusOverlay.svelte')).default;
		const BadgeOverlay = (await import('./overlay/BadgeOverlay.svelte')).default;
		mount(FlagOverlay, { target: document.body });
		mount(StatusOverlay, { target: document.body });
		mount(BadgeOverlay, { target: document.body });
	} catch (err) {
		console.warn('[coach] overlay mount failed:', err);
		overlayMounted = false;
	}
}

// Wire up immediately (side-effect import time). bootstrap() kicks in as
// soon as `user` becomes available.
wireEvaluator();
void mountOverlay();

user.subscribe((u) => {
	if (u) {
		void bootstrap();
	}
});

// ── Pre-flight hook (exposed globally for Chat.svelte injection) ──
// Resolve true when the pending user query is allowed to proceed; false
// when coach blocked it. Errors default to allow — fail open rather than
// fail shut, since a coach outage must not block the chat product.

export interface PreflightVerdict {
	action: 'none' | 'block' | 'error';
	// True only when coach actually ran an evaluation. Lets the caller
	// distinguish "we screened this and it passed" (badge it) from
	// "coach was off / not configured" (no badge).
	evaluated: boolean;
	rationale?: string | null;
	policy_id?: string | null;
}

export async function coachPreflight(
	userMessage: string,
	history?: UpstreamHistory,
	chatId?: string | null
): Promise<PreflightVerdict> {
	const token = getToken();
	if (!token) return { action: 'none', evaluated: false };
	const cfg = get(coachConfig);
	const realPathReady = Boolean(
		cfg?.coach_model_id && (cfg?.active_policy_ids?.length ?? 0) > 0
	);
	if (!cfg?.enabled || (!cfg.demo_mode && !realPathReady)) {
		return { action: 'none', evaluated: false };
	}

	const prior = linearize(history);
	const conversation = [
		...prior,
		{ role: 'user', content: userMessage, coach_authored: false }
	];

	const scope = chatId ?? null;
	setCoachProcessing('pre', scope);
	let verdict: {
		action?: string;
		rationale?: string | null;
		policy_id?: string | null;
	};
	try {
		const res = await fetch(`${WEBUI_API_BASE_URL}/coach/evaluate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`
			},
			body: JSON.stringify({ chat_id: scope, conversation, phase: 'pre' })
		});
		verdict = await res.json();
	} catch (err) {
		console.warn('[coach] preflight failed:', err);
		flashCoachResult('error', scope);
		return { action: 'error', evaluated: true };
	} finally {
		void refreshCoachEvents(token);
	}

	if (verdict?.action === 'block') {
		flashCoachResult('blocked', scope);
		return {
			action: 'block',
			evaluated: true,
			rationale: verdict.rationale ?? null,
			policy_id: verdict.policy_id ?? null
		};
	}
	flashCoachResult('ok', scope);
	return { action: 'none', evaluated: true };
}

// ── Block-message rendering (in-chat, persistent) ───────────────────
// When pre-flight blocks, a toast disappears in seconds. The user
// needs unlimited time to read the rule and the rationale, so we
// instead place a coach-authored "assistant" message into the chat
// itself, in the same slot the AI reply would have occupied.

export interface PreflightBlockDetail {
	rationale?: string | null;
	policy_id?: string | null;
}

export function composeCoachBlockMarkdown(verdict: PreflightBlockDetail): string {
	const policy = (get(coachPolicies) ?? []).find((p) => p.id === verdict.policy_id) ?? null;
	const lines: string[] = [];
	lines.push('## 🛑 Coach blocked this request');
	lines.push('');
	if (policy) {
		lines.push(`**Rule violated — ${policy.title}**`);
		lines.push('');
		lines.push(policy.body);
		lines.push('');
	}
	if (verdict.rationale) {
		lines.push("**Why this query specifically — coach's rationale:**");
		lines.push('');
		lines.push(`> ${verdict.rationale.replace(/\n/g, '\n> ')}`);
		lines.push('');
	}
	lines.push('---');
	lines.push(
		'_This message was placed here by the policy coach, not the LLM. ' +
			'You can rephrase your request, or take this task outside the assistant._'
	);
	return lines.join('\n');
}

// Mutates `history` in place: appends a user turn for `userPrompt` and a
// coach-authored assistant turn carrying the block explanation. Returns
// both ids so the caller can update history.currentId and persist the chat.
export function coachInsertBlockExchange(
	history: UpstreamHistory,
	userPrompt: string,
	verdict: PreflightBlockDetail,
	models: string[]
): { userMessageId: string; coachMessageId: string } {
	const ts = Math.floor(Date.now() / 1000);
	const parentId = history.currentId ?? null;

	const userMessageId = uuidv4();
	const coachMessageId = uuidv4();

	const userMsg = {
		id: userMessageId,
		parentId,
		childrenIds: [coachMessageId],
		role: 'user' as const,
		content: userPrompt,
		timestamp: ts,
		models
	};

	const coachMsg = {
		id: coachMessageId,
		parentId: userMessageId,
		childrenIds: [],
		role: 'assistant' as const,
		content: composeCoachBlockMarkdown(verdict),
		model: 'coach',
		modelName: 'Policy coach',
		modelIdx: 0,
		timestamp: ts,
		done: true,
		coachAuthored: true,
		coach_authored: true,
		coach: {
			type: 'block',
			policy_id: verdict.policy_id ?? null,
			rationale: verdict.rationale ?? null
		}
	};

	(history.messages as Record<string, unknown>)[userMessageId] = userMsg;
	(history.messages as Record<string, unknown>)[coachMessageId] = coachMsg;
	if (parentId && history.messages[parentId]) {
		const parent = history.messages[parentId] as { childrenIds?: string[] };
		parent.childrenIds = [...(parent.childrenIds ?? []), userMessageId];
	}
	history.currentId = coachMessageId;
	return { userMessageId, coachMessageId };
}

// Lets Chat.svelte mark a freshly-added user message as coach-approved
// (pre-flight let it through). Post-flight approvals are set by
// onChatFinish above — Chat.svelte handles the pre case because it
// owns the user-message id at that moment.
export function setCoachApproval(messageId: string, phase: 'pre' | 'post'): void {
	const cfg = get(coachConfig);
	setApproval(messageId, {
		phase,
		policyCount: cfg?.active_policy_ids?.length ?? 0,
		createdAt: Date.now()
	});
}

// Expose on window for the Chat.svelte injection — keeps the site's
// change tiny (single anchor) and avoids having Chat.svelte import from
// coach internals.
if (typeof window !== 'undefined') {
	const w = window as unknown as {
		coachPreflight: typeof coachPreflight;
		coachInsertBlockExchange: typeof coachInsertBlockExchange;
		setCoachApproval: typeof setCoachApproval;
	};
	w.coachPreflight = coachPreflight;
	w.coachInsertBlockExchange = coachInsertBlockExchange;
	w.setCoachApproval = setCoachApproval;
}
