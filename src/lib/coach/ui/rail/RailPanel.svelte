<script lang="ts">
	// Right-side rail showing every coach evaluation for the current chat.
	//
	// Data: $coachEvents is the backend-authoritative log — it captures
	// every /coach/evaluate call with phase, status, action, skip reason,
	// model, tokens, duration. That's strictly richer than the per-message
	// flags/approvals stores (which only track overlay state): events also
	// carry 'skipped' and 'error' states and pre-flight runs that never
	// touched any message.
	//
	// For per-message chips (numbered breadcrumbs), RailMarkers.svelte
	// reads flags + approvals directly. This panel and that component
	// intentionally draw from different sources: the panel is "what coach
	// has been doing lately" (chronological), the markers are "what coach
	// currently says about each message" (live state).
	//
	// Visibility: hidden when coach is disabled. Collapsible to a 36px
	// strip; body padding-right tweens so the chat column reflows cleanly.

	import { onDestroy, onMount } from 'svelte';

	import { chatId } from '$lib/stores';

	import CoachPanel from '../../components/CoachPanel.svelte';
	import { coachConfig } from '../../stores/config';
	import { coachEvents } from '../../stores/events';
	import { coachStatusByChat, type CoachStatus } from '../../stores/status';
	import type { CoachEvent } from '../../types';

	const STORAGE_KEY = 'coach_rail_collapsed';
	const RAIL_WIDTH_EXPANDED = 320;
	const RAIL_WIDTH_COLLAPSED = 36;
	let collapsed = false;
	let scopeAll = false; // false = this chat only; true = all chats

	// Push the app's layout by padding <body> so the rail doesn't float
	// on top of the chat. position:fixed doesn't affect flow, so we add
	// the width as padding-right and Open WebUI's flex-column shrinks
	// into it naturally. Tweens on padding-right so the collapse/expand
	// animates alongside the rail's own width.
	function applyBodyOffset() {
		if (typeof document === 'undefined') return;
		const width = collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH_EXPANDED;
		document.body.classList.add('coach-rail-active');
		document.body.style.setProperty('--coach-rail-offset', `${width}px`);
	}
	function clearBodyOffset() {
		if (typeof document === 'undefined') return;
		document.body.classList.remove('coach-rail-active');
		document.body.style.removeProperty('--coach-rail-offset');
	}

	onMount(() => {
		try {
			collapsed = localStorage.getItem(STORAGE_KEY) === 'true';
		} catch {
			/* ignore */
		}
		applyBodyOffset();
	});
	onDestroy(clearBodyOffset);
	$: if (typeof document !== 'undefined') {
		void collapsed;
		applyBodyOffset();
	}
	function toggleCollapsed() {
		collapsed = !collapsed;
		try {
			localStorage.setItem(STORAGE_KEY, String(collapsed));
		} catch {
			/* ignore */
		}
	}

	// ─── Event rendering ──────────────────────────────────────────────

	interface Row {
		id: string;
		event: CoachEvent;
		tone: 'ok' | 'warn' | 'bad' | 'info' | 'skip' | 'muted';
		glyph: string;
		title: string;
		sub: string;
	}

	function labelFor(e: CoachEvent): Pick<Row, 'tone' | 'glyph' | 'title' | 'sub'> {
		const phase = e.phase === 'pre' ? 'Query' : 'Reply';
		if (e.status === 'error') {
			return {
				tone: 'bad',
				glyph: '✕',
				title: `${phase} — error`,
				sub: e.error ?? 'evaluation failed'
			};
		}
		if (e.status === 'skipped') {
			return {
				tone: 'muted',
				glyph: '–',
				title: `${phase} — skipped`,
				sub: skipReasonCopy(e.reason)
			};
		}
		// ok / demo — differentiate only by the demo chip, shared labels below
		if (e.phase === 'pre') {
			if (e.action === 'block') {
				return {
					tone: 'bad',
					glyph: '⛔',
					title: 'Query blocked',
					sub: `screened against ${e.policy_count} polic${e.policy_count === 1 ? 'y' : 'ies'}`
				};
			}
			return {
				tone: 'ok',
				glyph: '🛡',
				title: 'Query reviewed — clear',
				sub: `screened against ${e.policy_count} polic${e.policy_count === 1 ? 'y' : 'ies'}`
			};
		}
		// post phase
		if (e.action === 'flag') {
			return {
				tone: 'warn',
				glyph: '⚑',
				title: 'Reply flagged',
				sub: `${e.policy_count} polic${e.policy_count === 1 ? 'y' : 'ies'} checked`
			};
		}
		if (e.action === 'followup') {
			return {
				tone: 'info',
				glyph: '↺',
				title: 'Coach followed up',
				sub: `re-prompted against ${e.policy_count} polic${e.policy_count === 1 ? 'y' : 'ies'}`
			};
		}
		return {
			tone: 'ok',
			glyph: '🛡',
			title: 'Reply reviewed — clear',
			sub: `${e.policy_count} polic${e.policy_count === 1 ? 'y' : 'ies'} checked`
		};
	}

	function skipReasonCopy(r: string | null): string {
		if (!r) return 'skipped';
		if (r === 'disabled') return 'coach is off';
		if (r === 'no_model') return 'no coach model configured';
		if (r === 'no_active_policies') return 'no policies active';
		if (r === 'empty_conversation') return 'empty conversation';
		return r;
	}

	function toneClass(t: Row['tone']): string {
		switch (t) {
			case 'ok':
				return 'border-emerald-500 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/30';
			case 'warn':
				return 'border-amber-500 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30';
			case 'bad':
				return 'border-red-500 dark:border-red-700 bg-red-50/50 dark:bg-red-950/40';
			case 'info':
				return 'border-sky-500 dark:border-sky-700 bg-sky-50/50 dark:bg-sky-950/30';
			case 'skip':
				return 'border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30';
			case 'muted':
			default:
				return 'border-gray-200 dark:border-gray-800 bg-transparent';
		}
	}

	// ─── Live status pulse ────────────────────────────────────────────

	$: status = ($chatId && $coachStatusByChat[$chatId]) || null;

	function statusLabel(s: CoachStatus | null): string {
		if (!s) return 'Idle';
		if (s === 'processing-pre') return 'Screening query…';
		if (s === 'processing-post') return 'Reviewing reply…';
		if (s === 'ok') return 'Reviewed — clear';
		if (s === 'flagged') return 'Flagged';
		if (s === 'followed-up') return 'Coach followed up';
		if (s === 'blocked') return 'Blocked';
		if (s === 'error') return 'Evaluation error';
		return s;
	}

	function statusDotClass(s: CoachStatus | null): string {
		if (!s) return 'bg-gray-300 dark:bg-gray-600';
		if (s === 'processing-pre' || s === 'processing-post')
			return 'bg-amber-400 dark:bg-amber-500 coach-rail-pulse-dot';
		if (s === 'ok') return 'bg-emerald-500';
		if (s === 'flagged') return 'bg-amber-500';
		if (s === 'followed-up') return 'bg-sky-500';
		if (s === 'blocked') return 'bg-red-500';
		if (s === 'error') return 'bg-red-400';
		return 'bg-gray-300';
	}

	// ─── Build the row list ──────────────────────────────────────────

	$: rows = buildRows($coachEvents, $chatId, scopeAll);

	function buildRows(
		events: CoachEvent[],
		currentChat: string | null | undefined,
		showAll: boolean
	): Row[] {
		const scope = events.filter((e) => showAll || !currentChat || e.chat_id === currentChat);
		return scope.map((e) => ({ id: e.id, event: e, ...labelFor(e) }));
	}

	function jumpTo(row: Row) {
		if (!row.event.message_id) return;
		const el = document.querySelector(
			`[data-message-id="${CSS.escape(row.event.message_id)}"]`
		) as HTMLElement | null;
		if (!el) return;
		el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		el.classList.add('coach-rail-flash');
		setTimeout(() => el.classList.remove('coach-rail-flash'), 1400);
	}

	// Keep relative timestamps fresh without re-deriving rows.
	let tick = 0;
	let tickTimer: ReturnType<typeof setInterval> | null = null;
	onMount(() => {
		tickTimer = setInterval(() => (tick += 1), 30_000);
	});
	onDestroy(() => {
		if (tickTimer) clearInterval(tickTimer);
	});
	function timeAgo(tsMs: number): string {
		void tick;
		const delta = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
		if (delta < 5) return 'now';
		if (delta < 60) return `${delta}s`;
		if (delta < 3600) return `${Math.floor(delta / 60)}m`;
		if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
		return `${Math.floor(delta / 86400)}d`;
	}

	function fmtDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}
</script>

{#if $coachConfig?.enabled}
	<aside class="coach-rail {collapsed ? 'is-collapsed' : ''}" aria-label="Coach activity">
		{#if collapsed}
			<button
				type="button"
				class="collapsed-strip"
				on:click={toggleCollapsed}
				title="Expand coach rail"
			>
				<span class="dot {statusDotClass(status)}"></span>
				<span class="count" aria-label="items">{rows.length}</span>
			</button>
		{:else}
			<header>
				<div class="title">
					<span class="dot {statusDotClass(status)}"></span>
					<span class="label">Coach</span>
					{#if $coachConfig?.demo_mode}
						<span class="demo-chip">demo</span>
					{/if}
				</div>
				<button
					type="button"
					class="collapse-btn"
					on:click={toggleCollapsed}
					title="Collapse"
					aria-label="Collapse coach rail"
				>
					›
				</button>
			</header>

			<section class="live">
				<div class="live-label">{statusLabel(status)}</div>
				<div class="live-sub">
					{$coachConfig?.coach_model_id ?? 'no model set'}
					· {$coachConfig?.active_policy_ids?.length ?? 0} polic{($coachConfig?.active_policy_ids
						?.length ?? 0) === 1
						? 'y'
						: 'ies'}
				</div>
			</section>

			<!-- Settings. Previously a tab in the upstream left sidebar, but
			     that fought chat history for vertical space. Embedded here
			     it sits alongside activity on the right, hidden behind a
			     disclosure so the rail stays scannable. -->
			<section class="settings">
				<CoachPanel embedded={true} />
			</section>

			<nav class="scope">
				<button
					type="button"
					class="scope-btn {!scopeAll ? 'active' : ''}"
					on:click={() => (scopeAll = false)}
				>this chat</button>
				<button
					type="button"
					class="scope-btn {scopeAll ? 'active' : ''}"
					on:click={() => (scopeAll = true)}
				>all</button>
			</nav>

			<section class="events">
				{#if rows.length === 0}
					<div class="empty">
						{scopeAll
							? 'No coach activity yet.'
							: 'No coach activity for this chat yet. Send a message to see what coach makes of it.'}
					</div>
				{:else}
					{#each rows as row, idx (row.id)}
						<button
							type="button"
							class="row {toneClass(row.tone)} {row.event.message_id ? 'clickable' : ''}"
							on:click={() => jumpTo(row)}
							title={row.event.message_id
								? 'Jump to message'
								: 'Pre-flight run — no message yet'}
							disabled={!row.event.message_id}
						>
							<span class="row-index">#{rows.length - idx}</span>
							<span class="row-glyph">{row.glyph}</span>
							<span class="row-body">
								<span class="row-title">
									{row.title}
									{#if row.event.status === 'demo'}<em class="badge">demo</em>{/if}
								</span>
								<span class="row-sub">{row.sub}</span>
								<span class="row-meta">
									{fmtDuration(row.event.duration_ms)}
									{#if row.event.tokens_in != null || row.event.tokens_out != null}
										· {row.event.tokens_in ?? 0}→{row.event.tokens_out ?? 0}t
									{/if}
								</span>
							</span>
							<span class="row-ts">{timeAgo(row.event.ts_ms)}</span>
						</button>
					{/each}
				{/if}
			</section>
		{/if}
	</aside>
{/if}

<style>
	.coach-rail {
		position: fixed;
		right: 0;
		top: 0;
		bottom: 0;
		width: 320px;
		z-index: 35;
		display: flex;
		flex-direction: column;
		background: rgb(255 255 255 / 0.96);
		border-left: 1px solid rgb(229 231 235);
		backdrop-filter: blur(6px);
		font-size: 12px;
		pointer-events: auto;
	}
	:global(.dark) .coach-rail {
		background: rgb(17 24 39 / 0.94);
		border-left: 1px solid rgb(55 65 81);
	}
	.coach-rail.is-collapsed {
		width: 36px;
	}
	.coach-rail,
	.coach-rail.is-collapsed {
		transition: width 160ms ease;
	}

	:global(body.coach-rail-active) {
		padding-right: var(--coach-rail-offset, 0px);
		transition: padding-right 160ms ease;
	}

	.collapsed-strip {
		height: 100%;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		padding: 10px 0;
		gap: 10px;
		background: transparent;
		border: none;
		cursor: pointer;
	}
	.collapsed-strip .count {
		font-size: 10px;
		color: rgb(107 114 128);
		writing-mode: vertical-rl;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		border-bottom: 1px solid rgb(229 231 235);
	}
	:global(.dark) header {
		border-bottom: 1px solid rgb(55 65 81);
	}
	.title {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.label {
		font-weight: 600;
		letter-spacing: 0.02em;
		color: rgb(31 41 55);
	}
	:global(.dark) .label {
		color: rgb(229 231 235);
	}
	.demo-chip {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 1px 6px;
		border-radius: 9999px;
		background: rgb(250 204 21);
		color: rgb(120 53 15);
	}
	.collapse-btn {
		width: 22px;
		height: 22px;
		border: none;
		background: transparent;
		border-radius: 4px;
		color: rgb(107 114 128);
		cursor: pointer;
		font-size: 16px;
		line-height: 1;
	}
	.collapse-btn:hover {
		background: rgb(243 244 246);
	}
	:global(.dark) .collapse-btn:hover {
		background: rgb(31 41 55);
	}

	.dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 9999px;
		box-shadow: 0 0 0 3px rgb(255 255 255 / 0.5);
	}
	:global(.dark) .dot {
		box-shadow: 0 0 0 3px rgb(17 24 39 / 0.5);
	}

	.live {
		padding: 10px 14px;
		border-bottom: 1px solid rgb(229 231 235);
	}
	:global(.dark) .live {
		border-bottom: 1px solid rgb(55 65 81);
	}
	.live-label {
		font-size: 11px;
		color: rgb(55 65 81);
	}
	:global(.dark) .live-label {
		color: rgb(209 213 219);
	}
	.live-sub {
		font-size: 10px;
		color: rgb(107 114 128);
		margin-top: 2px;
	}

	.scope {
		display: flex;
		gap: 2px;
		padding: 6px 10px 0;
	}
	.scope-btn {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 3px 8px;
		border-radius: 9999px;
		border: 1px solid transparent;
		background: transparent;
		color: rgb(107 114 128);
		cursor: pointer;
	}
	.scope-btn.active {
		background: rgb(243 244 246);
		color: rgb(31 41 55);
		border-color: rgb(229 231 235);
	}
	:global(.dark) .scope-btn.active {
		background: rgb(31 41 55);
		color: rgb(229 231 235);
		border-color: rgb(55 65 81);
	}

	.settings {
		padding: 4px 10px 8px;
		border-bottom: 1px solid rgb(229 231 235);
	}
	:global(.dark) .settings {
		border-bottom-color: rgb(31 41 55);
	}
	.events {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 10px 14px;
	}
	.empty {
		font-size: 11px;
		color: rgb(107 114 128);
		padding: 12px 4px;
		line-height: 1.4;
		text-align: center;
		font-style: italic;
	}

	.row {
		display: grid;
		grid-template-columns: 24px 18px 1fr auto;
		gap: 8px;
		align-items: flex-start;
		padding: 8px 10px;
		margin: 4px 0;
		width: 100%;
		text-align: left;
		background: transparent;
		border: 1px solid transparent;
		border-left-width: 3px;
		border-radius: 8px;
		font: inherit;
		color: inherit;
		cursor: default;
	}
	.row.clickable {
		cursor: pointer;
	}
	.row.clickable:hover {
		background: rgb(243 244 246);
	}
	:global(.dark) .row.clickable:hover {
		background: rgb(31 41 55);
	}
	.row-index {
		font-size: 10px;
		color: rgb(156 163 175);
		font-variant-numeric: tabular-nums;
		padding-top: 1px;
	}
	.row-glyph {
		font-size: 14px;
		line-height: 1;
	}
	.row-body {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 1px;
	}
	.row-title {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(55 65 81);
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	:global(.dark) .row-title {
		color: rgb(209 213 219);
	}
	.row-title .badge {
		font-style: normal;
		font-size: 8px;
		text-transform: uppercase;
		padding: 1px 5px;
		border-radius: 9999px;
		background: rgb(250 204 21);
		color: rgb(120 53 15);
	}
	.row-sub {
		font-size: 11px;
		color: rgb(75 85 99);
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	:global(.dark) .row-sub {
		color: rgb(209 213 219);
	}
	.row-meta {
		font-size: 9px;
		color: rgb(156 163 175);
		font-variant-numeric: tabular-nums;
	}
	.row-ts {
		font-size: 10px;
		color: rgb(156 163 175);
		padding-top: 1px;
		font-variant-numeric: tabular-nums;
	}

	@keyframes coach-rail-pulse-dot {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}
	:global(.coach-rail-pulse-dot) {
		animation: coach-rail-pulse-dot 1.1s ease-in-out infinite;
	}

	@keyframes coach-rail-flash {
		0% {
			box-shadow: 0 0 0 0 rgb(14 165 233 / 0.8);
		}
		100% {
			box-shadow: 0 0 0 12px rgb(14 165 233 / 0);
		}
	}
	:global(.coach-rail-flash) {
		animation: coach-rail-flash 1.4s ease-out 1;
		border-radius: 10px;
	}
</style>
