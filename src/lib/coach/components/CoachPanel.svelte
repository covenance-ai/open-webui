<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { models, user } from '$lib/stores';
	import Switch from '$lib/components/common/Switch.svelte';
	import * as api from '../api';
	import { coachConfig } from '../stores/config';
	import { coachPolicies, personalPolicies, sharedPolicies } from '../stores/policies';
	import type { CoachPolicy } from '../types';

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
	$: coachModelId = $coachConfig?.coach_model_id ?? '';
	$: activeIds = $coachConfig?.active_policy_ids ?? [];
	$: isAdmin = ($user as { role?: string } | null)?.role === 'admin';
	$: token = typeof localStorage !== 'undefined' ? (localStorage.token ?? '') : '';

	// ─── Config mutations ─────────────────────────────────────────────
	async function saveConfig(patch: {
		enabled?: boolean;
		coach_model_id?: string | null;
		active_policy_ids?: string[];
	}) {
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
			<!-- Model picker -->
			<label class="flex flex-col gap-0.5">
				<span class="text-gray-500 dark:text-gray-400">Coach model</span>
				<select
					value={coachModelId}
					on:change={onModelChange}
					disabled={!enabled}
					class="w-full px-2 py-1 rounded-md bg-transparent border border-gray-200 dark:border-gray-700 outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
				>
					<option value="">— none —</option>
					{#each $models as m}
						<option value={m.id}>{m.name ?? m.id}</option>
					{/each}
				</select>
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
		</div>
	{/if}
</div>

<PolicyEditor bind:show={editorOpen} policy={editorPolicy} on:save={onEditorSave} on:close={() => (editorOpen = false)} />
