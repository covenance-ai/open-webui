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
import { clearApproval, setApproval } from './stores/approvals';
import { coachConfig } from './stores/config';
import { coachPerChatEnabled, isCoachEnabledForChat } from './stores/perChat';
import { setBlockBanner } from './stores/blockBanner';
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
	// Gate: coach must be enabled both globally AND for this chat (per-chat
	// override wins), and either demo_mode on (scripted verdicts, no
	// model/policy needed) or the real path fully configured.
	const effectivelyEnabled = isCoachEnabledForChat(
		chatId,
		cfg?.enabled ?? false,
		get(coachPerChatEnabled)
	);
	const realPathReady = Boolean(
		cfg?.coach_model_id && (cfg?.active_policy_ids?.length ?? 0) > 0
	);
	if (!effectivelyEnabled || (!cfg?.demo_mode && !realPathReady)) {
		return;
	}

	const conv = linearize(detail?.history);
	if (conv.length === 0) return;

	setCoachProcessing('post', chatId);
	// Tag the assistant message with a 'reviewing' chip so the user sees
	// coach is doing something right now — not just a spinner in the
	// corner. Cleared after the verdict resolves (or replaced by the
	// final approval chip on action=none).
	if (detail?.messageId) {
		setApproval(detail.messageId, {
			kind: 'reviewing-post',
			phase: 'post',
			policyCount: cfg?.active_policy_ids?.length ?? 0,
			createdAt: Date.now()
		});
	}
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
		// Clear the pending reviewing-post chip so the UI doesn't get stuck
		// spinning forever on a network/LLM error. The error is still
		// surfaced via the status flash + the coach events log.
		if (detail?.messageId) clearApproval(detail.messageId);
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
				kind: 'approved',
				phase: 'post',
				policyCount: cfg?.active_policy_ids?.length ?? 0,
				createdAt: Date.now()
			});
		}
		return;
	}

	// For flag / followup verdicts, the pending 'reviewing-post' badge on
	// the assistant message becomes misleading. Clear it; the flag
	// overlay takes over.
	if (detail?.messageId) clearApproval(detail.messageId);
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

// Overlay mounting is variant-aware. Each variant lives under src/lib/coach/ui/
// and exports a single "Mount" component that renders everything the variant
// owns. On variant change we tear down the active set and mount the next.
// Tear-down is important because variants overlap on screen real estate —
// e.g. Rail's right panel would otherwise coexist with Chips' per-message
// overlays.

import { coachUIVariant, type CoachUIVariant } from './stores/ui';

type UnmountFn = () => void;
let activeVariant: CoachUIVariant | null = null;
let activeMounts: UnmountFn[] = [];
// Generation counter: each variant switch bumps it. Async import chains
// that land after a newer switch compare their captured generation and
// bail out — without this, rapid toggling could leave stale mounts on
// screen alongside the newer variant.
let variantGen = 0;

async function mountForVariant(variant: CoachUIVariant) {
	if (typeof window === 'undefined') return;
	if (variant === activeVariant) return;
	const gen = ++variantGen;
	for (const fn of activeMounts) {
		try {
			fn();
		} catch (err) {
			console.warn('[coach] unmount failed:', err);
		}
	}
	activeMounts = [];
	activeVariant = variant;
	try {
		const { mount, unmount } = await import('svelte');
		const mods: Array<{ default: unknown }> = [];
		if (variant === 'chips') {
			mods.push(await import('./overlay/FlagOverlay.svelte'));
			mods.push(await import('./overlay/BadgeOverlay.svelte'));
		} else if (variant === 'rail') {
			mods.push(await import('./ui/rail/RailMount.svelte'));
		} else if (variant === 'theater') {
			mods.push(await import('./ui/theater/TheaterMount.svelte'));
		}
		if (gen !== variantGen) return; // a newer switch won the race
		for (const m of mods) {
			const Component = m.default as Parameters<typeof mount>[0];
			const instance = mount(Component, { target: document.body });
			activeMounts.push(() => unmount(instance));
		}
	} catch (err) {
		console.warn('[coach] mount failed for variant', variant, err);
		if (gen === variantGen) activeVariant = null;
	}
}

let variantSubscribed = false;
function subscribeVariant() {
	if (variantSubscribed || typeof window === 'undefined') return;
	variantSubscribed = true;
	coachUIVariant.subscribe((v) => {
		void mountForVariant(v);
	});
}

// Always-on coach surfaces — mounted once regardless of UI variant:
//   CoachLight         bottom-right status indicator ("is coach working?")
//   CoachBlockBanner   top-center persistent banner when coach blocked
//                      the latest message, with "read full explanation"
//                      link (policy.explanation_url).
// Variant mounts (chips/rail/theater) add richer per-message surfaces
// on top of these; the two globals exist so the core "coach state is
// visible" and "user always understands why a block happened" guarantees
// hold whatever variant is active.
async function mountGlobalCoachSurfaces() {
	if (typeof window === 'undefined') return;
	try {
		const { mount } = await import('svelte');
		const CoachLight = (await import('./components/CoachLight.svelte')).default;
		const CoachBlockBanner = (await import('./components/CoachBlockBanner.svelte')).default;
		mount(CoachLight as Parameters<typeof mount>[0], { target: document.body });
		mount(CoachBlockBanner as Parameters<typeof mount>[0], { target: document.body });
	} catch (err) {
		console.warn('[coach] global surface mount failed:', err);
	}
}

// Wire up immediately (side-effect import time). bootstrap() kicks in as
// soon as `user` becomes available.
wireEvaluator();
subscribeVariant();
void mountGlobalCoachSurfaces();

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
	const effectivelyEnabled = isCoachEnabledForChat(
		chatId ?? null,
		cfg?.enabled ?? false,
		get(coachPerChatEnabled)
	);
	const realPathReady = Boolean(
		cfg?.coach_model_id && (cfg?.active_policy_ids?.length ?? 0) > 0
	);
	if (!effectivelyEnabled || (!cfg?.demo_mode && !realPathReady)) {
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
		// Populate the persistent banner so the user can read the full
		// explanation at their own pace (the inline assistant-style block
		// message works too, but scrolls away).
		if (scope) {
			const policies = get(coachPolicies);
			const policy = verdict.policy_id
				? policies.find((p) => p.id === verdict.policy_id) ?? null
				: null;
			setBlockBanner(scope, {
				policyId: verdict.policy_id ?? null,
				policyTitle: policy?.title ?? null,
				rationale: verdict.rationale ?? 'Policy violation',
				explanationUrl: policy?.explanation_url ?? null,
				at: Date.now()
			});
		}
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
	// Renders as the assistant-reply markdown in-chat. Open WebUI's
	// markdown pipeline supports GFM + inline HTML, so we use a styled
	// <div> card for strong visual hierarchy (policy title huge,
	// rationale as a clearly-marked quote, explanation link as a
	// prominent button-like link). Markdown alone reads like plain
	// text; the HTML card makes the block impossible to miss.
	const policy = (get(coachPolicies) ?? []).find((p) => p.id === verdict.policy_id) ?? null;
	const title = policy?.title ?? 'Policy violation';
	const body = policy?.body ?? '';
	const url = policy?.explanation_url ?? null;
	const rationale = (verdict.rationale ?? '').trim();

	// Minimal inline styles — the markdown renderer usually strips
	// <style>, but style=".." attributes survive. Uses colors that
	// read well on both light and dark themes (red/amber tones,
	// currentColor for text blends in).
	const esc = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

	const cardStyle = [
		'border-left: 4px solid #dc2626',
		'background: linear-gradient(180deg, rgba(254,226,226,0.55), rgba(254,226,226,0.15))',
		'padding: 14px 18px',
		'border-radius: 10px',
		'margin: 4px 0 8px'
	].join(';');

	const parts: string[] = [];
	parts.push(`<div style="${cardStyle}">`);
	parts.push(
		'<div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#991b1b;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px">'
	);
	parts.push('<span aria-hidden="true">⛔</span>');
	parts.push('<span>Coach blocked this request</span>');
	parts.push('</div>');
	parts.push(
		`<div style="font-size:17px;font-weight:700;color:#7f1d1d;margin-bottom:10px;line-height:1.25">${esc(title)}</div>`
	);
	if (rationale) {
		parts.push(
			`<blockquote style="margin:0 0 10px;padding:8px 12px;border-left:3px solid rgba(185,28,28,0.4);background:rgba(255,255,255,0.5);font-style:italic;color:#7f1d1d;border-radius:0 6px 6px 0">${esc(rationale)}</blockquote>`
		);
	}
	if (body) {
		parts.push(
			`<details style="margin-bottom:10px"><summary style="cursor:pointer;font-size:12px;opacity:0.75">Show full policy text</summary><div style="margin-top:6px;font-size:13px;line-height:1.5;white-space:pre-wrap">${esc(body)}</div></details>`
		);
	}
	if (url) {
		parts.push(
			`<div><a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:6px 12px;border-radius:9999px;background:#dc2626;color:#fff;font-size:13px;font-weight:600;text-decoration:none">Read full explanation ↗</a></div>`
		);
	}
	parts.push(
		'<div style="margin-top:10px;font-size:11px;opacity:0.65">This response was written by the policy coach, not the LLM. Rephrase your request or take this task outside the assistant.</div>'
	);
	parts.push('</div>');
	return parts.join('\n');
}

// Appends a single coach-authored assistant turn as a child of an
// existing user message. Used when pre-flight blocks: Chat.svelte has
// already added the user message (so the user sees what they sent),
// and coach drops an in-thread explanation in place of the LLM reply.
export function coachAppendBlockMessage(
	history: UpstreamHistory,
	parentUserMessageId: string,
	verdict: PreflightBlockDetail
): { coachMessageId: string } {
	const ts = Math.floor(Date.now() / 1000);
	const coachMessageId = uuidv4();

	const coachMsg = {
		id: coachMessageId,
		parentId: parentUserMessageId,
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

	(history.messages as Record<string, unknown>)[coachMessageId] = coachMsg;
	const parent = history.messages[parentUserMessageId] as { childrenIds?: string[] } | undefined;
	if (parent) parent.childrenIds = [...(parent.childrenIds ?? []), coachMessageId];
	history.currentId = coachMessageId;
	return { coachMessageId };
}

// Chat.svelte calls these to drive the per-message chip overlay for
// the pre-flight phase: mark 'reviewing-pre' as soon as the user msg
// is added, then either approve (action=none) or clear (blocked).
export function markCoachReviewingPre(messageId: string): void {
	const cfg = get(coachConfig);
	setApproval(messageId, {
		kind: 'reviewing-pre',
		phase: 'pre',
		policyCount: cfg?.active_policy_ids?.length ?? 0,
		createdAt: Date.now()
	});
}

export function markCoachApprovedPre(
	messageId: string,
	history?: UpstreamHistory
): void {
	const cfg = get(coachConfig);
	const policyCount = cfg?.active_policy_ids?.length ?? 0;
	setApproval(messageId, {
		kind: 'approved',
		phase: 'pre',
		policyCount,
		createdAt: Date.now()
	});
	// Write the approval onto the message so the upstream chat-save flow
	// persists it; on reload coachHydrateFromHistory re-populates the
	// store. Without this, pre-flight shields would vanish on refresh.
	if (history?.messages?.[messageId]) {
		(history.messages[messageId] as unknown as { coach?: unknown }).coach = {
			type: 'approved',
			phase: 'pre',
			policy_count: policyCount,
			created_at: Math.floor(Date.now() / 1000)
		};
	}
}

export function clearCoachBadge(messageId: string): void {
	clearApproval(messageId);
}

// Re-populates coachFlags and coachApprovals from a chat's history that
// was just loaded from the server. Called once per chat navigation via
// window.coachHydrateFromHistory (Chat.svelte site).
export function coachHydrateFromHistory(history: UpstreamHistory | undefined): void {
	if (!history?.messages) return;
	for (const [id, raw] of Object.entries(history.messages)) {
		const msg = raw as { coach?: Record<string, unknown> } | undefined;
		const c = msg?.coach;
		if (!c) continue;
		const type = (c.type as string | undefined) ?? 'flag'; // legacy rows are flags
		if (type === 'flag') {
			setFlag(id, {
				severity: ((c.severity as 'info' | 'warn' | 'critical') ?? 'warn'),
				rationale: (c.rationale as string) ?? '',
				policyId: (c.policy_id as string | null) ?? null,
				createdAt:
					typeof c.created_at === 'number' ? (c.created_at as number) * 1000 : Date.now()
			});
		} else if (type === 'approved') {
			setApproval(id, {
				kind: 'approved',
				phase: (c.phase as 'pre' | 'post') ?? 'post',
				policyCount: (c.policy_count as number | undefined) ?? 0,
				createdAt:
					typeof c.created_at === 'number' ? (c.created_at as number) * 1000 : Date.now()
			});
		}
		// type === 'block' → no overlay; the block message's content
		// already carries the full explanation.
	}
}

// Expose on window for the Chat.svelte injection — keeps the site's
// change tiny (single anchor) and avoids having Chat.svelte import from
// coach internals.
if (typeof window !== 'undefined') {
	const w = window as unknown as {
		coachPreflight: typeof coachPreflight;
		coachAppendBlockMessage: typeof coachAppendBlockMessage;
		markCoachReviewingPre: typeof markCoachReviewingPre;
		markCoachApprovedPre: typeof markCoachApprovedPre;
		clearCoachBadge: typeof clearCoachBadge;
		coachHydrateFromHistory: typeof coachHydrateFromHistory;
	};
	w.coachPreflight = coachPreflight;
	w.coachAppendBlockMessage = coachAppendBlockMessage;
	w.markCoachReviewingPre = markCoachReviewingPre;
	w.markCoachApprovedPre = markCoachApprovedPre;
	w.clearCoachBadge = clearCoachBadge;
	w.coachHydrateFromHistory = coachHydrateFromHistory;
}
