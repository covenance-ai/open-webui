<script lang="ts">
	// Compact status pill for one chat. Renders nothing when that chat has
	// no active coach event. Caller passes the chatId explicitly (no
	// fallback to "current chat" — that ambiguity is what the per-chat
	// refactor was trying to remove).

	import { coachStatusByChat, type CoachStatus } from '../stores/status';

	export let chatId: string | null;

	$: status = (chatId && $coachStatusByChat[chatId]) || null;

	const spec: Record<
		CoachStatus,
		{ glyph: string; label: string; cls: string; spin?: boolean }
	> = {
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
</script>

{#if status}
	{@const s = spec[status]}
	<span
		class="inline-flex items-center gap-1 text-[11px] font-mono {s.cls}"
		aria-live="polite"
		title="Coach: {s.label} (chat {chatId?.slice(0, 8) ?? ''})"
	>
		<span class={s.spin ? 'coach-spin' : ''}>{s.glyph}</span>
		<span class="tabular-nums">{s.label}</span>
	</span>
{/if}

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
