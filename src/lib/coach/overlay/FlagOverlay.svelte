<script lang="ts">
	// Renders coach flags as small pills anchored to `[data-message-id=<id>]`
	// nodes. Mounted once at document.body from init.ts. Positioned via
	// getBoundingClientRect + fixed positioning — we re-measure on every
	// reactive store change, on window resize, and on document scroll.

	import { onDestroy, onMount } from 'svelte';
	import { coachFlags, type CoachFlag } from '../stores/flags';

	// rects keyed by messageId. undefined means "node not mounted yet".
	let positions: Record<string, DOMRect | null> = {};

	let observer: MutationObserver | null = null;
	let tick = 0;

	// Re-measure every anchor. Cheap — handful of DOM calls per turn.
	function remeasure() {
		const next: Record<string, DOMRect | null> = {};
		for (const id of Object.keys($coachFlags)) {
			const el = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
			next[id] = el ? (el as HTMLElement).getBoundingClientRect() : null;
		}
		positions = next;
		tick++; // trigger reactive re-render
	}

	$: $coachFlags, remeasure(); // reactive on store change

	onMount(() => {
		window.addEventListener('resize', remeasure);
		window.addEventListener('scroll', remeasure, true);
		observer = new MutationObserver(remeasure);
		observer.observe(document.body, { childList: true, subtree: true });
		// Initial measure (some messages may already be in DOM).
		remeasure();
	});

	onDestroy(() => {
		window.removeEventListener('resize', remeasure);
		window.removeEventListener('scroll', remeasure, true);
		observer?.disconnect();
	});

	const severityClass = (s: CoachFlag['severity']) =>
		s === 'critical'
			? 'bg-red-100 dark:bg-red-900 text-red-900 dark:text-red-100 border-red-300 dark:border-red-700'
			: s === 'warn'
				? 'bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700'
				: 'bg-sky-100 dark:bg-sky-900 text-sky-900 dark:text-sky-100 border-sky-300 dark:border-sky-700';
</script>

{#key tick}
	{#each Object.entries($coachFlags) as [msgId, flag] (msgId)}
		{@const rect = positions[msgId]}
		{#if rect}
			<div
				style="position: fixed; top: {rect.top + 4}px; left: {rect.right - 16}px; transform: translateX(-100%); z-index: 40; max-width: 320px;"
				class="pointer-events-auto"
			>
				<div
					title={flag.rationale}
					class="text-xs px-2 py-1 rounded-full border shadow-sm {severityClass(flag.severity)} truncate"
				>
					⚑ {flag.rationale}
				</div>
			</div>
		{/if}
	{/each}
{/key}
