<script lang="ts">
	// Tiny numbered breadcrumbs anchored to each message that has coach
	// activity. Numbers align with the rail rows (newest = 1, older = 2, …)
	// so you can glance from message to rail and back without reading text.
	//
	// Positioning re-uses the same firstLaidOutRect / rAF / MutationObserver
	// pattern as FlagOverlay. Only renders when there are entries; rAF guard
	// prevents self-feeding the DOM mutation watcher.

	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';

	import { coachApprovals } from '../../stores/approvals';
	import { coachFlags } from '../../stores/flags';
	import { firstLaidOutRect, rectsEqual, type RectLike } from '../../overlay/rects';

	interface Marker {
		id: string;
		index: number;
		tone: 'flag-critical' | 'flag-warn' | 'flag-info' | 'approved' | 'reviewing';
	}

	let markers: Marker[] = [];
	let positions: Record<string, RectLike | null> = {};
	let observer: MutationObserver | null = null;
	let rafPending = false;

	function buildMarkers(): Marker[] {
		interface Entry {
			id: string;
			ts: number;
			tone: Marker['tone'];
		}
		const flags = get(coachFlags);
		const apps = get(coachApprovals);
		const entries: Entry[] = [];
		for (const [id, f] of Object.entries(flags)) {
			const tone: Marker['tone'] =
				f.severity === 'critical'
					? 'flag-critical'
					: f.severity === 'info'
						? 'flag-info'
						: 'flag-warn';
			entries.push({ id, ts: f.createdAt, tone });
		}
		for (const [id, a] of Object.entries(apps)) {
			const reviewing = a.kind === 'reviewing-pre' || a.kind === 'reviewing-post';
			entries.push({ id, ts: a.createdAt, tone: reviewing ? 'reviewing' : 'approved' });
		}
		entries.sort((a, b) => b.ts - a.ts);
		return entries.map((e, i) => ({ id: e.id, index: i + 1, tone: e.tone }));
	}

	function remeasure() {
		markers = buildMarkers();
		if (markers.length === 0) {
			if (Object.keys(positions).length !== 0) positions = {};
			return;
		}
		const next: Record<string, RectLike | null> = {};
		for (const m of markers) {
			const el = document.querySelector(`[data-message-id="${CSS.escape(m.id)}"]`);
			next[m.id] = firstLaidOutRect(el);
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

	function toneClass(t: Marker['tone']): string {
		if (t === 'flag-critical') return 'bg-red-500 text-white';
		if (t === 'flag-warn') return 'bg-amber-500 text-white';
		if (t === 'flag-info') return 'bg-sky-500 text-white';
		if (t === 'reviewing') return 'bg-amber-400 text-amber-950';
		return 'bg-emerald-500 text-white';
	}
</script>

{#each markers as m (m.id)}
	{@const rect = positions[m.id]}
	{#if rect}
		<div
			style="position: fixed; top: {rect.top + 6}px; left: {rect.right + 4}px; z-index: 34;"
			class="pointer-events-none"
		>
			<span
				class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold shadow-sm ring-1 ring-black/10 {toneClass(
					m.tone
				)}"
			>
				{m.index}
			</span>
		</div>
	{/if}
{/each}
