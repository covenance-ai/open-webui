<script lang="ts">
	// Renders coach flags as small pills anchored to `[data-message-id=<id>]`
	// nodes. Mounted once at document.body from init.ts. Positioned via
	// getBoundingClientRect + fixed positioning — re-measured on store change,
	// window resize, document scroll, and DOM mutations inside <body>.
	//
	// Two guards prevent a self-feeding loop (the overlay's own DOM lives inside
	// body, so every re-render is itself a mutation observed by the watcher):
	//   1) rAF-throttle scheduleRemeasure, so at most one pass per frame.
	//   2) Only assign `positions` when the rect map actually changed; a no-op
	//      assignment would still re-render the #each, mutate the DOM, and
	//      re-fire the observer ad infinitum.
	// When the flag map is empty we early-return without touching state, so
	// first paint (no flags yet) does not thrash on Open WebUI's initial render.

	import { get } from 'svelte/store';
	import { onDestroy, onMount } from 'svelte';
	import { coachFlags, type CoachFlag } from '../stores/flags';
	import { firstLaidOutRect, rectsEqual, type RectLike } from './rects';

	let positions: Record<string, RectLike | null> = {};
	let observer: MutationObserver | null = null;
	let rafPending = false;

	function remeasure() {
		const flags = get(coachFlags);
		const ids = Object.keys(flags);
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

	$: $coachFlags, scheduleRemeasure();

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

	const severityClass = (s: CoachFlag['severity']) =>
		s === 'critical'
			? 'bg-red-100 dark:bg-red-900 text-red-900 dark:text-red-100 border-red-300 dark:border-red-700'
			: s === 'warn'
				? 'bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700'
				: 'bg-sky-100 dark:bg-sky-900 text-sky-900 dark:text-sky-100 border-sky-300 dark:border-sky-700';
</script>

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
