<script lang="ts">
	// Always-on coach status light — bottom-right corner, visible
	// regardless of which UI variant is active (chips/rail/theater all
	// keep their own richer surfaces on top of this).
	//
	// Four coarse states:
	//   off        coach disabled (globally or for this chat), no model,
	//              or no active policies — nothing will happen.
	//   ready      coach is armed and idle.
	//   processing currently evaluating (pre-flight or post-flight).
	//   intervened just produced a non-none verdict or errored —
	//              flashes for 4s then returns to ready.
	//
	// Click opens a menu with two toggles:
	//   - "Coach on new chats" (global default; writes to coachConfig)
	//   - "In this conversation" (per-chat override; null = follow global)

	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import { chatId } from '$lib/stores';
	import { coachConfig } from '../stores/config';
	import {
		coachPerChatEnabled,
		isCoachEnabledForChat,
		setCoachForChat
	} from '../stores/perChat';
	import { coachStatusByChat, type CoachStatus } from '../stores/status';
	import { COACH_UI_VARIANTS, coachUIVariant, type CoachUIVariant } from '../stores/ui';

	// Hide when the rail variant is active — the rail already shows
	// live status, toggles live in its embedded settings panel, and
	// the floating light pill overlaps upstream's send button. On the
	// chips/theater variants the light is the only status surface so
	// it stays.
	$: hidden = $coachUIVariant === 'rail';

	type Kind = 'off' | 'waiting' | 'processing' | 'intervened';
	interface Display {
		kind: Kind;
		label: string;
		title: string;
		cls: string;
		pulse: boolean;
	}

	$: cfg = $coachConfig;
	$: globalEnabled = cfg?.enabled ?? false;
	$: model = cfg?.coach_model_id ?? null;
	$: policyCount = cfg?.active_policy_ids?.length ?? 0;
	$: perChatOverride = ($chatId && $coachPerChatEnabled[$chatId]) ?? undefined;
	$: effectivelyEnabled = isCoachEnabledForChat(
		$chatId ?? null,
		globalEnabled,
		$coachPerChatEnabled
	);
	$: chatState = ($chatId && $coachStatusByChat[$chatId]) || null;

	function offReason(): string | null {
		if (!globalEnabled && !effectivelyEnabled) return 'off globally';
		if (!effectivelyEnabled) return 'off for this chat';
		if (!model) return 'no coach model selected';
		if (policyCount === 0) return 'no active policies';
		return null;
	}

	function classifyChatState(s: CoachStatus | null): Kind | null {
		if (s === null) return null;
		if (s === 'processing-pre' || s === 'processing-post') return 'processing';
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
				title: `Coach is off — ${off}. Click to change.`,
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
		return {
			kind: 'waiting',
			label: 'ready',
			title: `Coach is armed (${policyCount} ${policyCount === 1 ? 'policy' : 'policies'}, model: ${model})`,
			cls: 'bg-emerald-500',
			pulse: false
		};
	})();

	// ── Menu ──────────────────────────────────────────────────────────
	let menuOpen = false;
	let rootEl: HTMLElement;

	function toggleMenu() {
		menuOpen = !menuOpen;
	}

	function closeMenu() {
		menuOpen = false;
	}

	function onGlobalToggle() {
		// Optimistic local flip; persistence happens via the existing
		// coachConfig subscribe → PUT /api/v1/coach/config pipeline.
		coachConfig.update((c) => (c ? { ...c, enabled: !c.enabled } : c));
		// Trigger persistence through the existing flow: the upstream
		// config panel writes via its own save button, but the light
		// should feel instant. A single-field update is pushed via a
		// dedicated API call the config store handles — matches how
		// the panel's Enabled toggle works.
		void persistGlobalEnabled();
	}

	async function persistGlobalEnabled() {
		try {
			const token = localStorage.getItem('token');
			if (!token) return;
			const next = get(coachConfig);
			if (!next) return;
			await fetch('/api/v1/coach/config', {
				method: 'PUT',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					enabled: next.enabled,
					demo_mode: next.demo_mode,
					coach_model_id: next.coach_model_id,
					active_policy_ids: next.active_policy_ids
				})
			});
		} catch (err) {
			console.warn('[coach] failed to persist global enabled:', err);
		}
	}

	function onChatToggle() {
		if (!$chatId) return;
		// Three-state cycle is avoided — the user came here to flip ON/OFF.
		// If they want "follow global" they can use the "Reset" button.
		const current = isCoachEnabledForChat(
			$chatId,
			globalEnabled,
			$coachPerChatEnabled
		);
		setCoachForChat($chatId, !current);
	}

	function onChatReset() {
		if (!$chatId) return;
		setCoachForChat($chatId, null);
	}

	function onDocClick(e: MouseEvent) {
		if (!menuOpen) return;
		if (rootEl && !rootEl.contains(e.target as Node)) {
			closeMenu();
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && menuOpen) closeMenu();
	}

	onMount(() => {
		document.addEventListener('mousedown', onDocClick);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDocClick);
			document.removeEventListener('keydown', onKey);
		};
	});

	function onVariantChange(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value as CoachUIVariant;
		coachUIVariant.set(v);
		// Don't auto-close: switching to 'rail' unmounts this light, which
		// is already a clear signal. Switching to chips/theater keeps the
		// menu open so the user can verify the choice took.
	}
</script>

{#if !hidden}
<div class="coach-light-root" bind:this={rootEl}>
	{#if menuOpen}
		<div class="coach-menu" role="menu" aria-label="Coach settings">
			<div class="menu-row">
				<span class="menu-label">Coach on new chats</span>
				<button
					type="button"
					class="switch"
					class:on={globalEnabled}
					aria-pressed={globalEnabled}
					on:click={onGlobalToggle}
				>
					<span class="knob" />
				</button>
			</div>

			<div class="menu-row">
				<span class="menu-label">
					In this conversation
					{#if perChatOverride === undefined}
						<span class="hint">(following global)</span>
					{:else}
						<button type="button" class="reset" on:click={onChatReset}>reset</button>
					{/if}
				</span>
				<button
					type="button"
					class="switch"
					class:on={effectivelyEnabled}
					class:disabled={!$chatId}
					aria-pressed={effectivelyEnabled}
					disabled={!$chatId}
					on:click={onChatToggle}
				>
					<span class="knob" />
				</button>
			</div>

			<div class="menu-row variant-row">
				<span class="menu-label">Display</span>
				<select
					class="variant-select"
					value={$coachUIVariant}
					on:change={onVariantChange}
					aria-label="Coach display mode"
				>
					{#each COACH_UI_VARIANTS as v}
						<option value={v}>{v}</option>
					{/each}
				</select>
			</div>
		</div>
	{/if}

	<button
		type="button"
		on:click={toggleMenu}
		class="coach-light"
		data-coach-light={display.kind}
		aria-haspopup="menu"
		aria-expanded={menuOpen}
		aria-live="polite"
		aria-label="Coach status: {display.label}"
		title={display.title}
	>
		<span class="dot {display.cls}" class:pulse={display.pulse} />
		<span class="label">Coach: {display.label}</span>
	</button>
</div>
{/if}

<style>
	.coach-light-root {
		position: fixed;
		right: 18px;
		bottom: 18px;
		z-index: 50;
	}
	.coach-light {
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

	/* ── menu ─────────────────────────────────────────────────────── */
	.coach-menu {
		position: absolute;
		right: 0;
		bottom: calc(100% + 8px);
		min-width: 240px;
		padding: 0.5rem 0.25rem 0.25rem 0.25rem;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.98);
		color: rgba(17, 24, 39, 0.9);
		font-family: ui-sans-serif, system-ui, sans-serif;
		font-size: 12px;
		box-shadow:
			0 2px 8px rgba(0, 0, 0, 0.08),
			0 16px 48px rgba(0, 0, 0, 0.12);
		border: 1px solid rgba(0, 0, 0, 0.08);
	}
	:global(.dark) .coach-menu {
		background: rgba(17, 24, 39, 0.98);
		color: rgba(229, 231, 235, 0.95);
		border-color: rgba(255, 255, 255, 0.1);
	}
	.menu-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0.625rem;
	}
	.menu-label {
		display: flex;
		flex-direction: column;
	}
	.hint {
		font-size: 10.5px;
		opacity: 0.6;
		margin-top: 2px;
	}
	.reset {
		font-size: 10.5px;
		opacity: 0.7;
		background: none;
		border: none;
		padding: 0;
		margin-top: 2px;
		cursor: pointer;
		text-decoration: underline;
		color: inherit;
	}
	.reset:hover {
		opacity: 1;
	}
	.variant-row {
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		margin-top: 0.25rem;
		padding-top: 0.5rem;
	}
	:global(.dark) .variant-row {
		border-top-color: rgba(255, 255, 255, 0.08);
	}
	.variant-select {
		font: inherit;
		font-size: 11.5px;
		padding: 2px 6px;
		border-radius: 6px;
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: rgba(255, 255, 255, 0.9);
		color: inherit;
		cursor: pointer;
	}
	:global(.dark) .variant-select {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.14);
	}
	.switch {
		position: relative;
		width: 34px;
		height: 18px;
		border-radius: 9999px;
		background: rgba(0, 0, 0, 0.2);
		border: none;
		padding: 0;
		cursor: pointer;
		transition: background 0.15s ease;
		flex: none;
	}
	:global(.dark) .switch {
		background: rgba(255, 255, 255, 0.18);
	}
	.switch.on {
		background: #10b981;
	}
	.switch.disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 9999px;
		background: #fff;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
		transition: transform 0.15s ease;
	}
	.switch.on .knob {
		transform: translateX(16px);
	}
</style>
