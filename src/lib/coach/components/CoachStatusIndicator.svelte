<script lang="ts">
	// Compact status pill. Bound to either an explicit `chatId` prop or, when
	// omitted, to the upstream `chatId` store. With no chat in scope falls
	// back to the global base state ('off' or 'idle').
	//
	// Keep one component used in two slots: the sidebar (global) and inline
	// inside a chat view (per-conversation).

	import { chatId as currentChatId } from '$lib/stores';

	import {
		coachBaseState,
		coachStatusByChat,
		lastActiveChatId,
		type CoachStatus
	} from '../stores/status';

	// When undefined: prefer the route's chatId; if that's empty, surface the
	// most-recently-touched chat so the pill doesn't go dim during navigation.
	export let chatId: string | null | undefined = undefined;
	// `inline` slightly tightens spacing for use inside the composer.
	export let inline = false;

	$: resolvedChatId =
		chatId !== undefined ? chatId : ($currentChatId || $lastActiveChatId || null);
	$: status = ((resolvedChatId && $coachStatusByChat[resolvedChatId]) ||
		$coachBaseState) as CoachStatus;

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
	class="inline-flex items-center gap-1 font-mono {inline
		? 'text-[10px]'
		: 'text-[11px]'} {s.cls}"
	aria-live="polite"
	title="Coach status: {s.label}{resolvedChatId ? ` (chat ${resolvedChatId.slice(0, 8)})` : ''}"
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
