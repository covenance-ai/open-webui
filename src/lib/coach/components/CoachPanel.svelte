<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { models, user } from '$lib/stores';
	import Modal from '$lib/components/common/Modal.svelte';
	import Switch from '$lib/components/common/Switch.svelte';
	import * as api from '../api';
	import { coachConfig } from '../stores/config';
	import { coachEvents, refreshCoachEvents } from '../stores/events';
	import { coachPolicies, personalPolicies, sharedPolicies } from '../stores/policies';
	import { COACH_UI_VARIANTS, coachUIVariant, type CoachUIVariant } from '../stores/ui';
	import type {
		CoachConfigForm,
		CoachEvent,
		CoachEventDetail,
		CoachPolicy
	} from '../types';

	import CoachInspector from './CoachInspector.svelte';
	import CoachPlayground from './CoachPlayground.svelte';
	import PolicyEditor from './PolicyEditor.svelte';
	import PolicyList from './PolicyList.svelte';

	// Collapse state persists in localStorage, matching the upstream pattern.
	let expanded = false;

	onMount(() => {
		try {
			expanded = localStorage.getItem('showCoachPanel') === 'true';
		} catch {
			expanded = false;
		}
	});

	function setExpanded(v: boolean) {
		expanded = v;
		try {
			localStorage.setItem('showCoachPanel', String(v));
		} catch {
			/* ignore */
		}
	}

	$: enabled = $coachConfig?.enabled ?? false;
	$: demoMode = $coachConfig?.demo_mode ?? false;
	$: coachModelId = $coachConfig?.coach_model_id ?? '';
	$: activeIds = $coachConfig?.active_policy_ids ?? [];
	$: isAdmin = ($user as { role?: string } | null)?.role === 'admin';
	$: token = typeof localStorage !== 'undefined' ? (localStorage.token ?? '') : '';

	// ─── Config mutations ─────────────────────────────────────────────
	async function saveConfig(patch: CoachConfigForm) {
		if (!token) return;
		try {
			const cfg = await api.saveCoachConfig(token, patch);
			coachConfig.set(cfg);
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
		}
	}

	function onToggleEnabled(e: CustomEvent<boolean>) {
		void saveConfig({ enabled: e.detail });
	}

	function onToggleDemoMode(e: CustomEvent<boolean>) {
		void saveConfig({ demo_mode: e.detail });
	}

	// ─── Activity log ─────────────────────────────────────────────────
	let activityOpen = false;
	$: recentEvents = ($coachEvents ?? []) as CoachEvent[];

	function toggleActivity() {
		activityOpen = !activityOpen;
		if (activityOpen && token) void refreshCoachEvents(token);
	}

	async function onClearActivity() {
		if (!token) return;
		try {
			await api.clearCoachEvents(token);
			coachEvents.set([]);
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
		}
	}

	// ─── Inspector + Playground modals ────────────────────────────────
	let inspectorOpen = false;
	let inspectorDetail: CoachEventDetail | null = null;
	let inspectorLoading = false;
	let playgroundOpen = false;

	async function openInspector(eventId: string) {
		if (!token) return;
		inspectorOpen = true;
		inspectorDetail = null;
		inspectorLoading = true;
		try {
			inspectorDetail = await api.getCoachEventDetail(token, eventId);
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
			inspectorOpen = false;
		} finally {
			inspectorLoading = false;
		}
	}

	function formatTs(ms: number): string {
		const d = new Date(ms);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	}

	function statusClass(s: CoachEvent['status']): string {
		switch (s) {
			case 'ok':
				return 'text-emerald-600 dark:text-emerald-400';
			case 'error':
				return 'text-red-600 dark:text-red-400';
			case 'demo':
				return 'text-purple-600 dark:text-purple-400';
			default:
				return 'text-gray-500 dark:text-gray-400';
		}
	}

	function onModelChange(e: Event) {
		const id = (e.target as HTMLSelectElement).value || null;
		void saveConfig({ coach_model_id: id });
	}

	function togglePolicyActive(policyId: string) {
		const next = activeIds.includes(policyId)
			? activeIds.filter((x) => x !== policyId)
			: [...activeIds, policyId];
		void saveConfig({ active_policy_ids: next });
	}

	// ─── Policy mutations ─────────────────────────────────────────────
	let editorOpen = false;
	let editorPolicy: CoachPolicy | null = null;

	function openEditor(p: CoachPolicy | null) {
		editorPolicy = p;
		editorOpen = true;
	}

	async function onEditorSave(
		e: CustomEvent<{ id: string | null; title: string; body: string }>
	) {
		if (!token) return;
		const { id, title, body } = e.detail;
		try {
			if (id) {
				const updated = await api.updateCoachPolicy(token, id, { title, body });
				coachPolicies.update((ps) => ps.map((p) => (p.id === updated.id ? updated : p)));
			} else {
				const created = await api.createCoachPolicy(token, { title, body });
				coachPolicies.update((ps) => [created, ...ps]);
			}
			editorOpen = false;
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
		}
	}

	async function onDeletePolicy(e: CustomEvent<CoachPolicy>) {
		if (!token) return;
		const p = e.detail;
		if (!confirm(`Delete policy "${p.title}"?`)) return;
		try {
			await api.deleteCoachPolicy(token, p.id);
			coachPolicies.update((ps) => ps.filter((x) => x.id !== p.id));
			// Also remove from active list if present — defensive cleanup.
			if (activeIds.includes(p.id)) {
				void saveConfig({ active_policy_ids: activeIds.filter((x) => x !== p.id) });
			}
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
		}
	}

	async function onSharePolicy(e: CustomEvent<CoachPolicy>) {
		if (!token) return;
		try {
			const shared = await api.shareCoachPolicy(token, e.detail.id);
			coachPolicies.update((ps) => ps.map((p) => (p.id === shared.id ? shared : p)));
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
		}
	}

	async function onUnsharePolicy(e: CustomEvent<CoachPolicy>) {
		if (!token) return;
		try {
			const unshared = await api.unshareCoachPolicy(token, e.detail.id);
			coachPolicies.update((ps) => ps.map((p) => (p.id === unshared.id ? unshared : p)));
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
		}
	}
</script>

<!-- Container styled to match upstream sidebar vocabulary (rounded, low-contrast). -->
<div class="flex flex-col text-gray-700 dark:text-gray-300 mb-2">
	<!-- Header row: disclosure chevron + label + on/off switch -->
	<div class="flex items-center justify-between px-1">
		<button
			type="button"
			class="flex items-center gap-1.5 py-1 text-sm font-medium flex-1 text-left"
			on:click={() => setExpanded(!expanded)}
			aria-expanded={expanded}
		>
			<span class="transition-transform inline-block {expanded ? 'rotate-90' : ''}">▸</span>
			<span>Coach</span>
			{#if enabled && activeIds.length > 0}
				<span
					class="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400"
				>· {activeIds.length} active</span>
			{/if}
		</button>
		<Switch state={enabled} on:change={onToggleEnabled} tooltip={enabled ? 'On' : 'Off'} />
	</div>

	{#if expanded}
		<div class="px-1 pb-2 flex flex-col gap-2 text-xs">
			<!-- Demo mode row -->
			<div class="flex items-center justify-between">
				<div class="flex flex-col">
					<span class="text-gray-500 dark:text-gray-400">Demo mode</span>
					<span class="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">
						Scripted verdicts; keywords: demo:flag, demo:followup, demo:critical, demo:none
					</span>
				</div>
				<Switch state={demoMode} on:change={onToggleDemoMode} tooltip={demoMode ? 'Demo' : 'Live'} />
			</div>

			<!-- Model picker -->
			<label class="flex flex-col gap-0.5">
				<span class="text-gray-500 dark:text-gray-400">Coach model</span>
				<select
					value={coachModelId}
					on:change={onModelChange}
					disabled={!enabled || demoMode}
					class="w-full px-2 py-1 rounded-md bg-transparent border border-gray-200 dark:border-gray-700 outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
				>
					<option value="">— none —</option>
					{#each $models as m}
						<option value={m.id}>{m.name ?? m.id}</option>
					{/each}
				</select>
			</label>

			<!-- UI variant picker -->
			<label class="flex flex-col gap-0.5">
				<span class="text-gray-500 dark:text-gray-400">UI style</span>
				<select
					value={$coachUIVariant}
					on:change={(e) => coachUIVariant.set((e.currentTarget as HTMLSelectElement).value as CoachUIVariant)}
					class="w-full px-2 py-1 rounded-md bg-transparent border border-gray-200 dark:border-gray-700 outline-none focus:ring-1 focus:ring-emerald-500"
				>
					{#each COACH_UI_VARIANTS as v}
						<option value={v}>{v}</option>
					{/each}
				</select>
				<span class="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">
					{#if $coachUIVariant === 'chips'}
						Minimal overlays on each message + corner pill.
					{:else if $coachUIVariant === 'rail'}
						Persistent right-side activity panel.
					{:else}
						Anthropomorphic coach persona + whispers.
					{/if}
				</span>
			</label>

			<!-- Shared policies -->
			{#if $sharedPolicies.length > 0}
				<div>
					<div class="text-gray-500 dark:text-gray-400 mt-1 mb-0.5">Shared</div>
					<PolicyList
						policies={$sharedPolicies}
						{activeIds}
						shareable={isAdmin}
						disabled={!enabled}
						on:toggleActive={(e) => togglePolicyActive(e.detail)}
						on:unshare={onUnsharePolicy}
					/>
				</div>
			{/if}

			<!-- Personal policies -->
			<div>
				<div class="flex items-center justify-between text-gray-500 dark:text-gray-400 mt-1 mb-0.5">
					<span>My policies</span>
					<button
						type="button"
						class="text-xs hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-50"
						disabled={!enabled}
						on:click={() => openEditor(null)}
					>
						+ new
					</button>
				</div>
				{#if $personalPolicies.length === 0}
					<div class="text-gray-400 dark:text-gray-500 italic text-xs py-0.5">
						No personal policies yet.
					</div>
				{:else}
					<PolicyList
						policies={$personalPolicies}
						{activeIds}
						editable
						shareable={isAdmin}
						disabled={!enabled}
						on:toggleActive={(e) => togglePolicyActive(e.detail)}
						on:edit={(e) => openEditor(e.detail)}
						on:delete={onDeletePolicy}
						on:share={onSharePolicy}
					/>
				{/if}
			</div>

			<!-- Playground trigger -->
			<button
				type="button"
				class="self-start text-xs px-2 py-1 rounded-md border border-dashed border-gray-300 dark:border-gray-600 hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400"
				on:click={() => (playgroundOpen = true)}
			>
				▶ Playground (dry-run)
			</button>

			<!-- Activity log: per-user in-memory ring from /api/v1/coach/events -->
			<div class="mt-1">
				<div class="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-0.5">
					<button
						type="button"
						class="flex items-center gap-1 text-xs"
						on:click={toggleActivity}
						aria-expanded={activityOpen}
					>
						<span class="transition-transform inline-block {activityOpen ? 'rotate-90' : ''}">▸</span>
						<span>Activity</span>
						{#if recentEvents.length > 0}
							<span class="text-[10px] text-gray-400 dark:text-gray-500">
								· {recentEvents.length}
							</span>
						{/if}
					</button>
					{#if activityOpen}
						<button
							type="button"
							class="text-[10px] hover:text-red-500 disabled:opacity-50"
							disabled={recentEvents.length === 0}
							on:click={onClearActivity}
							title="Clear activity log"
						>
							clear
						</button>
					{/if}
				</div>

				{#if activityOpen}
					{#if recentEvents.length === 0}
						<div class="text-gray-400 dark:text-gray-500 italic text-xs py-0.5">
							No coach activity yet.
						</div>
					{:else}
						<ul class="flex flex-col gap-0.5 max-h-48 overflow-y-auto pr-1 text-[11px]">
							{#each recentEvents as evt (evt.id)}
								<li
									class="flex flex-col border-l-2 pl-1.5 {evt.status === 'error'
										? 'border-red-400'
										: evt.status === 'demo'
											? 'border-purple-400'
											: evt.status === 'ok'
												? 'border-emerald-400'
												: 'border-gray-300 dark:border-gray-600'}"
								>
									<div class="flex items-center gap-1 font-mono">
										<span class="text-gray-400 dark:text-gray-500">{formatTs(evt.ts_ms)}</span>
										<span class="font-semibold {statusClass(evt.status)}">{evt.status}</span>
										<span class="text-gray-600 dark:text-gray-300">{evt.action ?? '—'}</span>
										<span class="ml-auto text-gray-400 dark:text-gray-500">{evt.duration_ms}ms</span>
										<button
											type="button"
											class="text-[10px] px-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
											on:click={() => openInspector(evt.id)}
											title="Inspect: prompt, raw reply, verdict"
										>
											inspect
										</button>
									</div>
									<div class="flex flex-wrap gap-x-2 text-gray-500 dark:text-gray-400">
										{#if evt.model_id}<span>model={evt.model_id}</span>{/if}
										{#if evt.tokens_in !== null || evt.tokens_out !== null}
											<span>tok {evt.tokens_in ?? '?'}→{evt.tokens_out ?? '?'}</span>
										{/if}
										{#if evt.policy_count > 0}<span>policies={evt.policy_count}</span>{/if}
										{#if evt.reason}<span>skip={evt.reason}</span>{/if}
									</div>
									{#if evt.error}
										<div class="text-red-500 dark:text-red-400 break-all" title={evt.error}>
											{evt.error}
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</div>

<PolicyEditor bind:show={editorOpen} policy={editorPolicy} on:save={onEditorSave} on:close={() => (editorOpen = false)} />

<!-- Event inspector: loads GET /events/{id} on open. -->
<Modal bind:show={inspectorOpen} size="lg">
	<div class="flex flex-col gap-3 p-5">
		<header class="flex items-center justify-between">
			<h2 class="text-base font-semibold text-gray-800 dark:text-gray-100">Coach event</h2>
			<button
				type="button"
				class="text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
				on:click={() => (inspectorOpen = false)}
				aria-label="Close"
			>
				✕
			</button>
		</header>
		{#if inspectorLoading}
			<div class="text-sm text-gray-500 dark:text-gray-400 italic">Loading…</div>
		{:else if inspectorDetail}
			<CoachInspector detail={inspectorDetail} />
		{/if}
	</div>
</Modal>

<!-- Dry-run playground. -->
<Modal bind:show={playgroundOpen} size="xl">
	<div class="p-5">
		<CoachPlayground on:close={() => (playgroundOpen = false)} />
	</div>
</Modal>
