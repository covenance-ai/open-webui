<script lang="ts">
	// Per-chat status pill. Shows nothing when coach is globally off
	// (cfg.enabled=false); otherwise always shows at least 'idle' so the
	// user sees coach is monitoring this conversation.
	//
	// 'idle' is computed here, not stored — there's no persistent "idle"
	// event to broadcast; it's just the absence of any active per-chat
	// state combined with coach being on.

	import { coachConfig } from '../stores/config';
	import { coachStatusByChat, type CoachStatus } from '../stores/status';

	export let chatId: string | null;

	type DisplayStatus = CoachStatus | 'idle';

	$: enabled = $coachConfig?.enabled ?? false;
	$: chatState = (chatId && $coachStatusByChat[chatId]) || null;
	$: status = (!enabled ? null : (chatState ?? 'idle')) as DisplayStatus | null;

	const spec: Record<
		DisplayStatus,
		{ glyph: string; label: string; cls: string; spin?: boolean }
	> = {
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
</script>

{#if status}
	{@const s = spec[status]}
	<span
		data-coach-status={status}
		class="inline-flex items-center gap-1 text-[11px] font-mono {s.cls} px-2 py-0.5 rounded-full bg-white/80 dark:bg-gray-900/80 backdrop-blur shadow-sm border border-gray-200/60 dark:border-gray-700/60"
		aria-live="polite"
		title="Coach: {s.label}{chatId ? ` (chat ${chatId.slice(0, 8)})` : ''}"
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
