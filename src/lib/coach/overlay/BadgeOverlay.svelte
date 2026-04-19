<script lang="ts">
	// Renders coach approval badges (green shields) anchored to message
	// nodes via [data-message-id]. Mirrors FlagOverlay structurally so
	// either can be removed without touching the other.
	//
	// Same MutationObserver loop guards as FlagOverlay (rAF throttle +
	// rect equality + early return on empty map) — this overlay's own
	// chips live in the body subtree, so unguarded re-renders self-feed
	// the watcher.

	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';

	import { coachApprovals, type CoachApproval } from '../stores/approvals';
	import { firstLaidOutRect, rectsEqual, type RectLike } from './rects';

	let positions: Record<string, RectLike | null> = {};
	let observer: MutationObserver | null = null;
	let rafPending = false;

	function remeasure() {
		const approvals = get(coachApprovals);
		const ids = Object.keys(approvals);
		if (ids.length === 0) {
			if (Object.keys(positions).length !== 0) positions = {};
			return;
		}
		const next: Record<string, RectLike | null> = {};
		for (const id of ids) {
			const el = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
			next[id] = firstLaidOutRect(el);
		}
		if (!rectsEqual(positions, next)) {
			positions = next;
		}
	}

	function scheduleRemeasure() {
		if (rafPending) return;
		rafPending = true;
		requestAnimationFrame(() => {
			rafPending = false;
			remeasure();
		});
	}

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

	function tooltipFor(a: CoachApproval): string {
		const subject = a.phase === 'pre' ? 'your query' : 'the reply';
		const pols = a.policyCount === 1 ? '1 policy' : `${a.policyCount} policies`;
		if (a.kind === 'reviewing-pre' || a.kind === 'reviewing-post') {
			return `Coach is reviewing ${subject} against ${pols}…`;
		}
		return `Coach reviewed ${subject} against ${pols}; nothing flagged.`;
	}

	function chipClass(a: CoachApproval): string {
		if (a.kind === 'reviewing-pre' || a.kind === 'reviewing-post') {
			return 'bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700';
		}
		return 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700';
	}

	function glyphFor(a: CoachApproval): string {
		if (a.kind === 'reviewing-pre' || a.kind === 'reviewing-post') return '◐';
		return '🛡';
	}
</script>

{#each Object.entries($coachApprovals) as [msgId, approval] (msgId)}
	{@const rect = positions[msgId]}
	{#if rect}
		<div
			style="position: fixed; top: {rect.top + 4}px; left: {rect.right - 4}px; transform: translateX(-100%); z-index: 39;"
			class="pointer-events-auto"
			data-coach-badge={approval.kind}
		>
			<span
				title={tooltipFor(approval)}
				class="inline-flex items-center justify-center w-5 h-5 rounded-full {chipClass(
					approval
				)} text-[11px] shadow-sm cursor-default select-none"
				aria-label={tooltipFor(approval)}
			>
				<span
					class={approval.kind === 'reviewing-pre' || approval.kind === 'reviewing-post'
						? 'coach-spin inline-block'
						: ''}
				>{glyphFor(approval)}</span>
			</span>
		</div>
	{/if}
{/each}

<style>
	@keyframes coach-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	.coach-spin {
		animation: coach-spin 1s linear infinite;
	}
</style>
