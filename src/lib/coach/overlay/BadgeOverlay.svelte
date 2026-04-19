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

	let positions: Record<string, DOMRect | null> = {};
	let observer: MutationObserver | null = null;
	let rafPending = false;

	function rectsEqual(
		a: Record<string, DOMRect | null>,
		b: Record<string, DOMRect | null>
	) {
		const ak = Object.keys(a);
		const bk = Object.keys(b);
		if (ak.length !== bk.length) return false;
		for (const k of ak) {
			const ra = a[k];
			const rb = b[k];
			if (ra === rb) continue;
			if (!ra || !rb) return false;
			if (
				ra.top !== rb.top ||
				ra.left !== rb.left ||
				ra.width !== rb.width ||
				ra.height !== rb.height
			) {
				return false;
			}
		}
		return true;
	}

	function remeasure() {
		const approvals = get(coachApprovals);
		const ids = Object.keys(approvals);
		if (ids.length === 0) {
			if (Object.keys(positions).length !== 0) positions = {};
			return;
		}
		const next: Record<string, DOMRect | null> = {};
		for (const id of ids) {
			const el = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
			next[id] = el ? (el as HTMLElement).getBoundingClientRect() : null;
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
		const phase = a.phase === 'pre' ? 'screened your query' : 'reviewed the reply';
		const pols = a.policyCount === 1 ? '1 policy' : `${a.policyCount} policies`;
		return `Coach ${phase} against ${pols}; nothing flagged.`;
	}
</script>

{#each Object.entries($coachApprovals) as [msgId, approval] (msgId)}
	{@const rect = positions[msgId]}
	{#if rect}
		<div
			style="position: fixed; top: {rect.top + 4}px; left: {rect.right - 4}px; transform: translateX(-100%); z-index: 39;"
			class="pointer-events-auto"
		>
			<span
				title={tooltipFor(approval)}
				class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 text-[11px] shadow-sm cursor-default select-none"
				aria-label={tooltipFor(approval)}
			>
				🛡
			</span>
		</div>
	{/if}
{/each}
