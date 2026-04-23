<script lang="ts">
	// Side "whisper" bubbles attached to the LEFT edge of any flagged or
	// reviewing assistant message. Visually distinct from flag pills —
	// small, italic, with a soft arrow pointing at the message; reads as
	// the coach leaning in and commenting, not as UI chrome.
	//
	// Positioning follows FlagOverlay's pattern (firstLaidOutRect + rAF +
	// MutationObserver), but anchors to the message's LEFT side.

	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';

	import { coachApprovals, type CoachApproval } from '../../stores/approvals';
	import { coachFlags, type CoachFlag } from '../../stores/flags';
	import { firstLaidOutRect, rectsEqual, type RectLike } from '../../overlay/rects';

	interface Whisper {
		id: string;
		kind: 'flag' | 'reviewing' | 'approved';
		severity?: CoachFlag['severity'];
		text: string;
	}

	let whispers: Whisper[] = [];
	let positions: Record<string, RectLike | null> = {};
	let observer: MutationObserver | null = null;
	let rafPending = false;

	function buildWhispers(
		flags: Record<string, CoachFlag>,
		apps: Record<string, CoachApproval>
	): Whisper[] {
		const out: Whisper[] = [];
		// Flags — full coach comment as the whisper text.
		for (const [id, f] of Object.entries(flags)) {
			out.push({ id, kind: 'flag', severity: f.severity, text: f.rationale });
		}
		// Reviewing / approved — terser whispers. Approvals are the quiet
		// background rhythm; skip them unless reviewing (in-flight) so the
		// screen isn't peppered with "all good" notes.
		for (const [id, a] of Object.entries(apps)) {
			if (a.kind === 'reviewing-pre' || a.kind === 'reviewing-post') {
				const subj = a.phase === 'pre' ? 'your query' : 'the reply';
				out.push({ id, kind: 'reviewing', text: `Reviewing ${subj}…` });
			}
		}
		return out;
	}

	function remeasure() {
		whispers = buildWhispers(get(coachFlags), get(coachApprovals));
		if (whispers.length === 0) {
			if (Object.keys(positions).length !== 0) positions = {};
			return;
		}
		const next: Record<string, RectLike | null> = {};
		for (const w of whispers) {
			const el = document.querySelector(`[data-message-id="${CSS.escape(w.id)}"]`);
			next[w.id] = firstLaidOutRect(el);
		}
		if (!rectsEqual(positions, next)) positions = next;
	}

	function scheduleRemeasure() {
		if (rafPending) return;
		rafPending = true;
		requestAnimationFrame(() => {
			rafPending = false;
			remeasure();
		});
	}

	$: $coachFlags, scheduleRemeasure();
	$: $coachApprovals, scheduleRemeasure();

	onMount(() => {
		window.addEventListener('resize', scheduleRemeasure);
		window.addEventListener('scroll', scheduleRemeasure, true);
		observer = new MutationObserver(scheduleRemeasure);
		observer.observe(document.body, { childList: true, subtree: true });
		scheduleRemeasure();
	});
	onDestroy(() => {
		window.removeEventListener('resize', scheduleRemeasure);
		window.removeEventListener('scroll', scheduleRemeasure, true);
		observer?.disconnect();
	});

	function toneClass(w: Whisper): string {
		if (w.kind === 'reviewing')
			return 'bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-100 border-amber-200 dark:border-amber-700';
		if (w.severity === 'critical')
			return 'bg-red-50 dark:bg-red-950/60 text-red-900 dark:text-red-100 border-red-300 dark:border-red-700';
		if (w.severity === 'info')
			return 'bg-sky-50 dark:bg-sky-950/60 text-sky-900 dark:text-sky-100 border-sky-300 dark:border-sky-700';
		return 'bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700';
	}

	function prefixFor(w: Whisper): string {
		if (w.kind === 'reviewing') return '◐';
		if (w.severity === 'critical') return '⛔';
		if (w.severity === 'info') return 'ⓘ';
		return '⚑';
	}
</script>

{#each whispers as w (w.id + w.kind)}
	{@const rect = positions[w.id]}
	{#if rect}
		<div
			style="position: fixed; top: {rect.top + 8}px; left: {rect.left - 8}px; transform: translateX(-100%); z-index: 38; max-width: 240px;"
			class="pointer-events-auto"
		>
			<div
				class="whisper border shadow-sm {toneClass(w)}"
				title={w.text}
			>
				<span class="prefix" aria-hidden="true">{prefixFor(w)}</span>
				<span class="body">{w.text}</span>
			</div>
		</div>
	{/if}
{/each}

<style>
	.whisper {
		display: inline-flex;
		align-items: flex-start;
		gap: 6px;
		font-size: 11px;
		font-style: italic;
		padding: 6px 10px;
		border-radius: 10px;
		border-width: 1px;
		line-height: 1.4;
		position: relative;
	}
	.whisper::after {
		content: '';
		position: absolute;
		right: -7px;
		top: 10px;
		width: 0;
		height: 0;
		border-top: 6px solid transparent;
		border-bottom: 6px solid transparent;
		border-left: 7px solid currentColor;
		opacity: 0.25;
	}
	.prefix {
		font-style: normal;
		font-size: 12px;
		line-height: 1.2;
	}
	.body {
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		-webkit-box-orient: vertical;
	}
</style>
