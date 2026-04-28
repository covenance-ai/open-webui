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
import { coachEvents, refreshCoachEvents } from './stores/events';
import { coachFlags, setFlag } from './stores/flags';
import { coachPolicies } from './stores/policies';
import { flashCoachResult, setCoachProcessing } from './stores/status';
import type { CoachEvent } from './types';

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
	// Persisted activity log for this chat — mirror of the in-memory
	// /coach/events feed, scoped to this conversation. Written from the
	// evaluate handlers, read by coachHydrateFromHistory on chat load
	// so the rail survives reloads and container restarts (the backend
	// buffer does not survive either).
	coach_events?: CoachEvent[];
}

// Append one coach event to a chat's persisted history.coach_events
// array AND mirror it into the live coachEvents store so the rail
// updates immediately without waiting for the next refresh. Safe to
// call with a null/undefined history (no-op).
function recordCoachEventForChat(
	history: UpstreamHistory | null | undefined,
	event: CoachEvent
): void {
	if (history) {
		history.coach_events = [...(history.coach_events ?? []), event];
	}
	coachEvents.update((existing) => {
		if (existing.some((e) => e.id === event.id)) return existing;
		// Newest first — matches the backend list ordering.
		return [event, ...existing];
	});
}

function buildCoachEvent(partial: {
	phase: 'pre' | 'post';
	status: 'ok' | 'error' | 'skipped' | 'demo';
	action?: string | null;
	reason?: string | null;
	policy_count?: number;
	chat_id?: string | null;
	message_id?: string | null;
	error?: string | null;
	model_id?: string | null;
}): CoachEvent {
	return {
		id: uuidv4(),
		user_id: '', // client-synthesized; real user_id lives on backend copy.
		ts_ms: Date.now(),
		status: partial.status,
		action: partial.action ?? null,
		reason: partial.reason ?? null,
		model_id: partial.model_id ?? null,
		policy_count: partial.policy_count ?? 0,
		duration_ms: 0,
		tokens_in: null,
		tokens_out: null,
		error: partial.error ?? null,
		chat_id: partial.chat_id ?? null,
		message_id: partial.message_id ?? null,
		phase: partial.phase
	};
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
		recordCoachEventForChat(
			detail?.history ?? null,
			buildCoachEvent({
				phase: 'post',
				status: 'error',
				chat_id: chatId,
				message_id: detail?.messageId ?? null,
				error: err instanceof Error ? err.message : String(err),
				policy_count: cfg?.active_policy_ids?.length ?? 0
			})
		);
		return;
	} finally {
		// Refresh the activity log regardless of verdict — error rows are the
		// whole point of the strip.
		void refreshCoachEvents(token);
	}

	const policyCount = cfg?.active_policy_ids?.length ?? 0;

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
				policyCount,
				createdAt: Date.now()
			});
			// Persist on the assistant message so coachHydrateFromHistory
			// re-populates the approval chip after a reload.
			persistMessageCoach(detail.history, detail.messageId, {
				type: 'approved',
				phase: 'post',
				policy_count: policyCount,
				created_at: Math.floor(Date.now() / 1000)
			});
		}
		recordCoachEventForChat(
			detail?.history ?? null,
			buildCoachEvent({
				phase: 'post',
				status: 'ok',
				action: 'none',
				policy_count: policyCount,
				chat_id: chatId,
				message_id: detail?.messageId ?? null
			})
		);
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
		persistMessageCoach(detail.history, detail.messageId, {
			type: 'flag',
			severity: verdict.severity ?? 'warn',
			rationale: verdict.rationale,
			policy_id: verdict.policy_id ?? null,
			created_at: Math.floor(Date.now() / 1000)
		});
		recordCoachEventForChat(
			detail.history ?? null,
			buildCoachEvent({
				phase: 'post',
				status: 'ok',
				action: 'flag',
				policy_count: policyCount,
				chat_id: chatId,
				message_id: detail.messageId
			})
		);
		return;
	}

	if (verdict.action === 'followup' && typeof verdict.followup_text === 'string') {
		recordCoachEventForChat(
			detail?.history ?? null,
			buildCoachEvent({
				phase: 'post',
				status: 'ok',
				action: 'followup',
				policy_count: policyCount,
				chat_id: chatId,
				message_id: detail?.messageId ?? null
			})
		);
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

// Set a structured coach annotation on a single message so it gets
// re-hydrated on reload. Used for approved/flag/block message shields.
function persistMessageCoach(
	history: UpstreamHistory | undefined | null,
	messageId: string,
	coach: Record<string, unknown>
): void {
	const msg = history?.messages?.[messageId];
	if (msg) (msg as unknown as { coach?: unknown }).coach = coach;
}

// After a fresh chat is created, Chat.svelte calls this to replace the
// placeholder chat_id=null on already-recorded coach events with the
// real id — otherwise the "THIS CHAT" rail filter hides them. We have
// to update both history (persisted) and the live store (what the rail
// reads right now).
export function coachBackfillChatId(
	history: UpstreamHistory | undefined,
	newChatId: string
): void {
	if (!history || !newChatId) return;
	const events = history.coach_events ?? [];
	const touchedIds = new Set<string>();
	for (const ev of events) {
		if (ev && !ev.chat_id) {
			ev.chat_id = newChatId;
			touchedIds.add(ev.id);
		}
	}
	if (touchedIds.size === 0) return;
	coachEvents.update((live) =>
		live.map((e) => (touchedIds.has(e.id) ? { ...e, chat_id: newChatId } : e))
	);
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

// wireEvaluator only registers a window event listener (no DOM); safe to
// run before sign-in. Anything that mounts UI on document.body — variant
// mounts (RailMount/etc.) and the always-on globals (CoachLight,
// CoachBlockBanner) — must wait for `user` to be non-null, otherwise the
// coach panel renders on the /auth screen. Sign-out triggers a full
// page reload (location.href = '/auth' in +layout.svelte), so we don't
// have to unmount on transition to null — the next page load starts
// fresh with uiInitialized = false.
wireEvaluator();

let uiInitialized = false;
user.subscribe((u) => {
	if (!u) return;
	if (!uiInitialized) {
		uiInitialized = true;
		subscribeVariant();
		void mountGlobalCoachSurfaces();
	}
	void bootstrap();
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
		recordCoachEventForChat(
			history ?? null,
			buildCoachEvent({
				phase: 'pre',
				status: 'error',
				chat_id: scope,
				error: err instanceof Error ? err.message : String(err),
				policy_count: cfg?.active_policy_ids?.length ?? 0
			})
		);
		return { action: 'error', evaluated: true };
	} finally {
		void refreshCoachEvents(token);
	}

	const prePolicyCount = cfg?.active_policy_ids?.length ?? 0;

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
		recordCoachEventForChat(
			history ?? null,
			buildCoachEvent({
				phase: 'pre',
				status: 'ok',
				action: 'block',
				policy_count: prePolicyCount,
				chat_id: scope
			})
		);
		return {
			action: 'block',
			evaluated: true,
			rationale: verdict.rationale ?? null,
			policy_id: verdict.policy_id ?? null
		};
	}
	flashCoachResult('ok', scope);
	recordCoachEventForChat(
		history ?? null,
		buildCoachEvent({
			phase: 'pre',
			status: 'ok',
			action: 'none',
			policy_count: prePolicyCount,
			chat_id: scope
		})
	);
	return { action: 'none', evaluated: true };
}

// ── Block-message rendering (in-chat, persistent) ───────────────────
// When pre-flight blocks, a toast disappears in seconds. The user
// needs unlimited time to read the rule and the rationale, so we
// instead place a coach-authored "assistant" message into the chat
// itself, in the same slot the AI reply would have occupied. The
// actual visuals live in CoachBlockMessage.svelte — here we only
// prepare a plain-text fallback for `message.content` (exports,
// copy/paste, non-custom viewers) and stash a structured snapshot on
// `message.coach` for the component to read.

export interface PreflightBlockDetail {
	rationale?: string | null;
	policy_id?: string | null;
}

export function composeCoachBlockFallback(verdict: PreflightBlockDetail): string {
	// Plain markdown fallback so the message still reads sensibly outside
	// the custom Svelte renderer (e.g. when a chat is exported to JSON
	// and replayed elsewhere).
	const policy = (get(coachPolicies) ?? []).find((p) => p.id === verdict.policy_id) ?? null;
	const title = policy?.title ?? 'Policy violation';
	const rationale = (verdict.rationale ?? '').trim();
	const lines = [`**⛔ Coach blocked this request — ${title}**`];
	if (rationale) lines.push('', `> ${rationale}`);
	if (policy?.explanation_url) lines.push('', `[Read full explanation](${policy.explanation_url})`);
	return lines.join('\n');
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

	// Snapshot the policy so the block message renders identically on
	// reload even if the policy is later edited or deleted. This is the
	// same reason we persist assistant replies verbatim rather than
	// re-querying the model.
	const policy = (get(coachPolicies) ?? []).find((p) => p.id === verdict.policy_id) ?? null;

	const coachMsg = {
		id: coachMessageId,
		parentId: parentUserMessageId,
		childrenIds: [],
		role: 'assistant' as const,
		content: composeCoachBlockFallback(verdict),
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
			policy_title: policy?.title ?? null,
			policy_body: policy?.body ?? null,
			policy_explanation_url: policy?.explanation_url ?? null,
			rationale: verdict.rationale ?? null,
			created_at: ts
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
	if (!history) return;

	// Restore the per-chat activity log. The backend keeps events in
	// memory only (see backend/coach/events.py) — after a container
	// restart or a chat navigation the rail would otherwise forget what
	// coach did in this conversation. Merge by id so a later
	// refreshCoachEvents call (which may return the same events) stays
	// idempotent.
	if (Array.isArray(history.coach_events) && history.coach_events.length > 0) {
		const persisted = history.coach_events;
		coachEvents.update((live) => {
			const seen = new Set(live.map((e) => e.id));
			const merged = [...live];
			for (const e of persisted) if (!seen.has(e.id)) merged.push(e);
			merged.sort((a, b) => (b.ts_ms ?? 0) - (a.ts_ms ?? 0));
			return merged;
		});
	}

	if (!history.messages) return;
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
		coachBackfillChatId: typeof coachBackfillChatId;
	};
	w.coachPreflight = coachPreflight;
	w.coachAppendBlockMessage = coachAppendBlockMessage;
	w.markCoachReviewingPre = markCoachReviewingPre;
	w.markCoachApprovedPre = markCoachApprovedPre;
	w.clearCoachBadge = clearCoachBadge;
	w.coachHydrateFromHistory = coachHydrateFromHistory;
	w.coachBackfillChatId = coachBackfillChatId;
}
