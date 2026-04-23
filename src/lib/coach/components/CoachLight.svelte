<script lang="ts">
	// Always-on coach status light — bottom-right corner, visible regardless
	// of which UI variant is active (chips/rail/theater all keep their own
	// richer surfaces on top of this).
	//
	// Four coarse states, matching "is coach working?" as the user would
	// ask it:
	//   off        coach disabled, no model, or no active policies — nothing
	//              will happen when you send a message.
	//   waiting    coach is armed and idle.
	//   processing currently evaluating (pre-flight or post-flight).
	//   intervened just produced a non-none verdict (block/flag/followup)
	//              or errored — flashes for 6s then returns to waiting.
	//
	// Click the light to open the coach config panel.

	import { chatId } from '$lib/stores';
	import { coachConfig } from '../stores/config';
	import { coachStatusByChat, type CoachStatus } from '../stores/status';

	type Kind = 'off' | 'waiting' | 'processing' | 'intervened';
	interface Display {
		kind: Kind;
		label: string;
		title: string;
		cls: string;
		pulse: boolean;
	}

	$: cfg = $coachConfig;
	$: enabled = cfg?.enabled ?? false;
	$: model = cfg?.coach_model_id ?? null;
	$: policies = cfg?.active_policy_ids?.length ?? 0;
	$: chatState = ($chatId && $coachStatusByChat[$chatId]) || null;

	// Derive the 4-state model from (config, per-chat event).
	// Off reasons: distinguished in the tooltip so the user knows what to
	// fix — a single generic "off" is the frustration we're fixing.
	function offReason(): string | null {
		if (!enabled) return 'disabled';
		if (!model) return 'no coach model selected';
		if (policies === 0) return 'no active policies';
		return null;
	}

	function classifyChatState(s: CoachStatus | null): Kind | null {
		if (s === null) return null;
		if (s === 'processing-pre' || s === 'processing-post') return 'processing';
		// ok / flagged / followed-up / blocked / error all count as "intervened"
		// for the coarse indicator — the label below distinguishes them.
		return 'intervened';
	}

	function labelFor(s: CoachStatus | null): string {
		switch (s) {
			case 'processing-pre':
				return 'screening…';
			case 'processing-post':
				return 'reviewing…';
			case 'ok':
				return 'passed';
			case 'flagged':
				return 'flagged';
			case 'followed-up':
				return 'nudged';
			case 'blocked':
				return 'blocked';
			case 'error':
				return 'error';
			default:
				return '';
		}
	}

	$: display = ((): Display => {
		const off = offReason();
		if (off) {
			return {
				kind: 'off',
				label: 'off',
				title: `Coach is off — ${off}. Click to configure.`,
				cls: 'bg-gray-400 dark:bg-gray-500',
				pulse: false
			};
		}
		const kind = classifyChatState(chatState);
		if (kind === 'processing') {
			return {
				kind,
				label: labelFor(chatState),
				title: `Coach is ${labelFor(chatState)}`,
				cls: 'bg-amber-500',
				pulse: true
			};
		}
		if (kind === 'intervened') {
			const colorByState: Record<string, string> = {
				ok: 'bg-emerald-500',
				flagged: 'bg-amber-500',
				'followed-up': 'bg-sky-500',
				blocked: 'bg-red-500',
				error: 'bg-red-500'
			};
			const s = chatState ?? '';
			return {
				kind,
				label: labelFor(chatState),
				title: `Coach just ${labelFor(chatState)}`,
				cls: colorByState[s] ?? 'bg-emerald-500',
				pulse: false
			};
		}
		// waiting
		return {
			kind: 'waiting',
			label: 'ready',
			title: `Coach is armed (${policies} ${policies === 1 ? 'policy' : 'policies'}, model: ${model})`,
			cls: 'bg-emerald-500',
			pulse: false
		};
	})();

	function openPanel() {
		// The coach panel is a sidebar tab controlled by upstream; we emit a
		// generic event so whichever mount strategy wins gets a chance to
		// open itself. init.ts wires the panel open-handler.
		window.dispatchEvent(new CustomEvent('coach:open-panel'));
	}
</script>

<button
	type="button"
	on:click={openPanel}
	class="coach-light"
	data-coach-light={display.kind}
	aria-live="polite"
	aria-label="Coach status: {display.label}"
	title={display.title}
>
	<span class="dot {display.cls}" class:pulse={display.pulse} />
	<span class="label">Coach: {display.label}</span>
</button>

<style>
	.coach-light {
		position: fixed;
		right: 18px;
		bottom: 18px;
		z-index: 50;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		border-radius: 9999px;
		background: rgba(255, 255, 255, 0.92);
		color: rgba(17, 24, 39, 0.9);
		font-size: 12px;
		font-family: ui-sans-serif, system-ui, sans-serif;
		line-height: 1;
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.08),
			0 4px 12px rgba(0, 0, 0, 0.08);
		border: 1px solid rgba(0, 0, 0, 0.06);
		backdrop-filter: blur(6px);
		cursor: pointer;
		transition:
			transform 0.12s ease,
			box-shadow 0.12s ease;
	}
	:global(.dark) .coach-light {
		background: rgba(17, 24, 39, 0.82);
		color: rgba(229, 231, 235, 0.95);
		border-color: rgba(255, 255, 255, 0.08);
	}
	.coach-light:hover {
		transform: translateY(-1px);
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.1),
			0 8px 20px rgba(0, 0, 0, 0.12);
	}
	.coach-light:focus-visible {
		outline: 2px solid #2563eb;
		outline-offset: 2px;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 9999px;
		display: inline-block;
		flex: none;
	}
	.pulse {
		animation: coach-light-pulse 1.1s ease-in-out infinite;
	}
	.label {
		white-space: nowrap;
		tabular-nums: 1;
	}
	@keyframes coach-light-pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.55;
			transform: scale(0.82);
		}
	}
</style>
