<script lang="ts">
	// Floating anthropomorphic coach, bottom-left of viewport. The face
	// reacts to the current chat's coach status so users learn the state
	// map from seeing it: processing wobbles, flagged shakes, blocked
	// turns dark-red and glares, ok blinks a check.
	//
	// Hidden entirely when coach is disabled. When demo mode is on the
	// avatar wears a gold ring so demos are unmistakably scripted.

	import { chatId } from '$lib/stores';

	import { coachConfig } from '../../stores/config';
	import { coachStatusByChat, type CoachStatus } from '../../stores/status';

	$: status = ($chatId && $coachStatusByChat[$chatId]) || null;
	$: cfg = $coachConfig;
	$: mood = moodFor(status);

	interface Mood {
		glyph: string;
		face: 'neutral' | 'watchful' | 'alarm' | 'angry' | 'bright' | 'thinking';
		halo: string; // tailwind classes for ring
		skin: string; // tailwind classes for face bg
		anim: string; // class name for animation
		label: string;
	}

	function moodFor(s: CoachStatus | null): Mood {
		if (s === 'processing-pre' || s === 'processing-post')
			return {
				glyph: '◐',
				face: 'thinking',
				halo: 'ring-amber-300 dark:ring-amber-500',
				skin: 'bg-amber-100 dark:bg-amber-900',
				anim: 'coach-theater-wobble',
				label: s === 'processing-pre' ? 'Screening your query…' : 'Reviewing the reply…'
			};
		if (s === 'ok')
			return {
				glyph: '✓',
				face: 'bright',
				halo: 'ring-emerald-300 dark:ring-emerald-500',
				skin: 'bg-emerald-100 dark:bg-emerald-900',
				anim: 'coach-theater-bounce',
				label: 'All clear'
			};
		if (s === 'flagged')
			return {
				glyph: '⚑',
				face: 'alarm',
				halo: 'ring-amber-400 dark:ring-amber-600',
				skin: 'bg-amber-100 dark:bg-amber-900',
				anim: 'coach-theater-shake',
				label: 'I flagged the reply'
			};
		if (s === 'followed-up')
			return {
				glyph: '↺',
				face: 'watchful',
				halo: 'ring-sky-400 dark:ring-sky-600',
				skin: 'bg-sky-100 dark:bg-sky-900',
				anim: 'coach-theater-bounce',
				label: 'I asked a follow-up'
			};
		if (s === 'blocked')
			return {
				glyph: '⛔',
				face: 'angry',
				halo: 'ring-red-500 dark:ring-red-700',
				skin: 'bg-red-100 dark:bg-red-950',
				anim: 'coach-theater-shake-hard',
				label: 'I blocked that query'
			};
		if (s === 'error')
			return {
				glyph: '✕',
				face: 'neutral',
				halo: 'ring-red-300 dark:ring-red-600',
				skin: 'bg-gray-100 dark:bg-gray-800',
				anim: '',
				label: 'Evaluation error'
			};
		return {
			glyph: '●',
			face: 'neutral',
			halo: 'ring-gray-300 dark:ring-gray-600',
			skin: 'bg-gray-100 dark:bg-gray-800',
			anim: 'coach-theater-breath',
			label: 'Watching'
		};
	}
</script>

{#if cfg?.enabled}
	<div class="coach-theater-avatar-anchor">
		<div
			class="coach-theater-avatar ring-4 {mood.halo} {mood.skin} {mood.anim} {cfg?.demo_mode
				? 'demo'
				: ''}"
			title={mood.label + (cfg?.demo_mode ? ' (demo)' : '')}
			aria-label="Coach status: {mood.label}"
		>
			<svg viewBox="0 0 64 64" width="58" height="58" aria-hidden="true">
				<!-- eyes -->
				{#if mood.face === 'alarm' || mood.face === 'angry'}
					<!-- angry slanted brows -->
					<line
						x1="16"
						y1="22"
						x2="26"
						y2="26"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
					/>
					<line
						x1="48"
						y1="22"
						x2="38"
						y2="26"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
					/>
				{/if}
				{#if mood.face === 'thinking'}
					<!-- dotted thinking eyes -->
					<circle cx="22" cy="28" r="2" fill="currentColor" />
					<circle cx="42" cy="28" r="2" fill="currentColor" />
				{:else if mood.face === 'bright'}
					<!-- happy crescent eyes -->
					<path
						d="M 17 30 Q 22 24 27 30"
						stroke="currentColor"
						stroke-width="2.5"
						fill="none"
						stroke-linecap="round"
					/>
					<path
						d="M 37 30 Q 42 24 47 30"
						stroke="currentColor"
						stroke-width="2.5"
						fill="none"
						stroke-linecap="round"
					/>
				{:else}
					<circle cx="22" cy="28" r="3" fill="currentColor" />
					<circle cx="42" cy="28" r="3" fill="currentColor" />
				{/if}
				<!-- mouth -->
				{#if mood.face === 'bright'}
					<path
						d="M 22 42 Q 32 50 42 42"
						stroke="currentColor"
						stroke-width="2.5"
						fill="none"
						stroke-linecap="round"
					/>
				{:else if mood.face === 'angry'}
					<path
						d="M 22 46 Q 32 38 42 46"
						stroke="currentColor"
						stroke-width="2.5"
						fill="none"
						stroke-linecap="round"
					/>
				{:else if mood.face === 'alarm'}
					<ellipse cx="32" cy="44" rx="4" ry="3" stroke="currentColor" stroke-width="2" fill="none" />
				{:else}
					<line
						x1="25"
						y1="44"
						x2="39"
						y2="44"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/>
				{/if}
			</svg>
			<span class="corner-glyph" aria-hidden="true">{mood.glyph}</span>
		</div>
		<div class="coach-theater-caption">{mood.label}</div>
	</div>
{/if}

<style>
	.coach-theater-avatar-anchor {
		position: fixed;
		left: 18px;
		bottom: 18px;
		z-index: 40;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		pointer-events: none;
	}
	.coach-theater-avatar {
		width: 72px;
		height: 72px;
		border-radius: 9999px;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		color: rgb(31 41 55);
		box-shadow:
			0 6px 18px rgb(0 0 0 / 0.15),
			inset 0 -3px 8px rgb(0 0 0 / 0.08);
		pointer-events: auto;
		cursor: default;
		transition: box-shadow 200ms ease;
	}
	:global(.dark) .coach-theater-avatar {
		color: rgb(243 244 246);
	}
	.coach-theater-avatar.demo {
		outline: 2px solid rgb(245 158 11);
		outline-offset: 3px;
	}
	.corner-glyph {
		position: absolute;
		right: -4px;
		bottom: -4px;
		width: 22px;
		height: 22px;
		border-radius: 9999px;
		background: rgb(255 255 255);
		color: rgb(31 41 55);
		font-size: 12px;
		line-height: 22px;
		text-align: center;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
	}
	:global(.dark) .corner-glyph {
		background: rgb(17 24 39);
		color: rgb(243 244 246);
	}
	.coach-theater-caption {
		font-size: 10px;
		color: rgb(55 65 81);
		background: rgb(255 255 255 / 0.85);
		padding: 2px 8px;
		border-radius: 9999px;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
		white-space: nowrap;
		pointer-events: none;
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	:global(.dark) .coach-theater-caption {
		color: rgb(229 231 235);
		background: rgb(31 41 55 / 0.85);
	}

	@keyframes coach-theater-breath {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.03);
		}
	}
	.coach-theater-breath {
		animation: coach-theater-breath 3.2s ease-in-out infinite;
	}

	@keyframes coach-theater-wobble {
		0%,
		100% {
			transform: rotate(-3deg);
		}
		50% {
			transform: rotate(3deg);
		}
	}
	.coach-theater-wobble {
		animation: coach-theater-wobble 0.9s ease-in-out infinite;
	}

	@keyframes coach-theater-bounce {
		0%,
		100% {
			transform: translateY(0);
		}
		30% {
			transform: translateY(-6px);
		}
		60% {
			transform: translateY(-2px);
		}
	}
	.coach-theater-bounce {
		animation: coach-theater-bounce 0.9s ease-out 1;
	}

	@keyframes coach-theater-shake {
		0%,
		100% {
			transform: translateX(0);
		}
		20% {
			transform: translateX(-2px) rotate(-2deg);
		}
		40% {
			transform: translateX(2px) rotate(2deg);
		}
		60% {
			transform: translateX(-2px) rotate(-2deg);
		}
		80% {
			transform: translateX(2px) rotate(2deg);
		}
	}
	.coach-theater-shake {
		animation: coach-theater-shake 0.6s ease-in-out infinite;
	}

	@keyframes coach-theater-shake-hard {
		0%,
		100% {
			transform: translateX(0);
		}
		20% {
			transform: translateX(-4px) rotate(-4deg);
		}
		40% {
			transform: translateX(4px) rotate(4deg);
		}
		60% {
			transform: translateX(-4px) rotate(-4deg);
		}
		80% {
			transform: translateX(4px) rotate(4deg);
		}
	}
	.coach-theater-shake-hard {
		animation: coach-theater-shake-hard 0.4s ease-in-out infinite;
	}
</style>
