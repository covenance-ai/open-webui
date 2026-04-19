<script lang="ts">
	// A compact status pill bound to the `coachStatus` store.
	//
	// Each state has a distinct colour + glyph so the eye picks them up in
	// peripheral vision:
	//   off            — empty circle, muted
	//   idle           — green dot (steady)
	//   processing-pre — amber spinner with "pre"
	//   processing-post— amber spinner with "post"
	//   ok             — green thumbs-up (flashes ~4s)
	//   flagged        — amber warning (flashes)
	//   followed-up    — blue arrow-return (flashes)
	//   blocked        — red shield (flashes)
	//   error          — red X (flashes)

	import { coachStatus, type CoachStatus } from '../stores/status';

	$: status = $coachStatus as CoachStatus;

	// One source of truth for styling so the legend in COACH.md lines up.
	const spec: Record<
		CoachStatus,
		{ glyph: string; label: string; cls: string; spin?: boolean }
	> = {
		off: {
			glyph: '○',
			label: 'off',
			cls: 'text-gray-400 dark:text-gray-600'
		},
		idle: {
			glyph: '●',
			label: 'idle',
			cls: 'text-emerald-500 dark:text-emerald-400'
		},
		'processing-pre': {
			glyph: '◐',
			label: 'screening',
			cls: 'text-amber-500 dark:text-amber-400',
			spin: true
		},
		'processing-post': {
			glyph: '◐',
			label: 'reviewing',
			cls: 'text-amber-500 dark:text-amber-400',
			spin: true
		},
		ok: {
			glyph: '✓',
			label: 'ok',
			cls: 'text-emerald-600 dark:text-emerald-400'
		},
		flagged: {
			glyph: '⚑',
			label: 'flagged',
			cls: 'text-amber-600 dark:text-amber-400'
		},
		'followed-up': {
			glyph: '↺',
			label: 'nudged',
			cls: 'text-sky-600 dark:text-sky-400'
		},
		blocked: {
			glyph: '⛔',
			label: 'blocked',
			cls: 'text-red-600 dark:text-red-400'
		},
		error: {
			glyph: '✕',
			label: 'error',
			cls: 'text-red-600 dark:text-red-400'
		}
	};

	$: s = spec[status];
</script>

<span
	class="inline-flex items-center gap-1 text-[11px] font-mono {s.cls}"
	aria-live="polite"
	title="Coach status: {s.label}"
>
	<span class={s.spin ? 'coach-spin' : ''}>{s.glyph}</span>
	<span class="tabular-nums">{s.label}</span>
</span>

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
		display: inline-block;
		animation: coach-spin 1s linear infinite;
	}
</style>
