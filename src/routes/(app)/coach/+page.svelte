<script lang="ts">
	// Dedicated full-page Coach workbench — settings + policies in a layout
	// that doesn't fight the rail's narrow sidebar for space. The rail's
	// CoachPanel stays as the always-visible "short view" and links here
	// for serious authoring.

	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { models, user } from '$lib/stores';
	import * as api from '$lib/coach/api';
	import { coachConfig } from '$lib/coach/stores/config';
	import {
		coachPolicies,
		personalPolicies,
		sharedPolicies
	} from '$lib/coach/stores/policies';
	import {
		COACH_UI_VARIANTS,
		coachUIVariant,
		type CoachUIVariant
	} from '$lib/coach/stores/ui';
	import type { CoachConfigForm, CoachPolicy } from '$lib/coach/types';

	import CoachAccessAdmin from '$lib/coach/components/CoachAccessAdmin.svelte';
	import CoachPlayground from '$lib/coach/components/CoachPlayground.svelte';
	import PolicyEditorForm from '$lib/coach/components/PolicyEditorForm.svelte';
	import PolicyList from '$lib/coach/components/PolicyList.svelte';
	import Switch from '$lib/components/common/Switch.svelte';
	import Modal from '$lib/components/common/Modal.svelte';

	$: token = typeof localStorage !== 'undefined' ? (localStorage.token ?? '') : '';
	$: cfg = $coachConfig;
	$: enabled = cfg?.enabled ?? false;
	$: accessEnabled = cfg?.access_enabled ?? true;
	$: demoMode = cfg?.demo_mode ?? false;
	$: coachModelId = cfg?.coach_model_id ?? '';
	$: activeIds = cfg?.active_policy_ids ?? [];
	$: isAdmin = ($user as { role?: string } | null)?.role === 'admin';
	$: selfUserId = ($user as { id?: string } | null)?.id ?? null;

	// ─── Editor state ─────────────────────────────────────────────────
	// `null` editorPolicy + `editorOpen=true` = creating new.
	// `policy + editorOpen=true` = editing.
	// `editorOpen=false` = empty pane on the right ("select or create").
	let editorOpen = false;
	let editorPolicy: CoachPolicy | null = null;
	let saving = false;

	function openCreate() {
		editorPolicy = null;
		editorOpen = true;
	}

	function openEdit(p: CoachPolicy) {
		editorPolicy = p;
		editorOpen = true;
	}

	function closeEditor() {
		editorOpen = false;
		editorPolicy = null;
	}

	// ─── Config mutations ─────────────────────────────────────────────
	async function saveConfig(patch: CoachConfigForm) {
		if (!token) return;
		try {
			const next = await api.saveCoachConfig(token, patch);
			coachConfig.set(next);
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
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
	async function onSave(
		e: CustomEvent<{ id: string | null; title: string; body: string }>
	) {
		if (!token) return;
		const { id, title, body } = e.detail;
		saving = true;
		try {
			if (id) {
				const updated = await api.updateCoachPolicy(token, id, { title, body });
				coachPolicies.update((ps) => ps.map((p) => (p.id === updated.id ? updated : p)));
				editorPolicy = updated;
			} else {
				const created = await api.createCoachPolicy(token, { title, body });
				coachPolicies.update((ps) => [created, ...ps]);
				// Stay in edit mode for the just-created policy so iteration
				// (tweak prompt → save → tweak) doesn't re-open the form.
				editorPolicy = created;
			}
			toast.success(`Saved "${title}"`);
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
		} finally {
			saving = false;
		}
	}

	async function onDelete(p: CoachPolicy) {
		if (!token) return;
		if (!confirm(`Delete policy "${p.title}"?`)) return;
		try {
			await api.deleteCoachPolicy(token, p.id);
			coachPolicies.update((ps) => ps.filter((x) => x.id !== p.id));
			if (activeIds.includes(p.id)) {
				void saveConfig({ active_policy_ids: activeIds.filter((x) => x !== p.id) });
			}
			if (editorPolicy?.id === p.id) closeEditor();
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
		}
	}

	async function onShare(p: CoachPolicy) {
		if (!token) return;
		try {
			const shared = await api.shareCoachPolicy(token, p.id);
			coachPolicies.update((ps) => ps.map((x) => (x.id === shared.id ? shared : x)));
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
		}
	}

	async function onUnshare(p: CoachPolicy) {
		if (!token) return;
		try {
			const unshared = await api.unshareCoachPolicy(token, p.id);
			coachPolicies.update((ps) => ps.map((x) => (x.id === unshared.id ? unshared : x)));
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
		}
	}

	// ─── Access admin / playground ────────────────────────────────────
	let accessAdminOpen = false;
	let playgroundOpen = false;

	// Refresh policies + config on mount in case the user lands here cold.
	onMount(() => {
		if (!token) return;
		void api.listCoachPolicies(token).then((ps) => coachPolicies.set(ps)).catch(() => {});
		void api.getCoachConfig(token).then((c) => coachConfig.set(c)).catch(() => {});
	});
</script>

<svelte:head>
	<title>Coach · Settings & Policies</title>
</svelte:head>

<div class="flex flex-col h-full overflow-hidden">
	<!-- Page header -->
	<header
		class="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-800"
	>
		<div class="flex items-center gap-3">
			<h1 class="text-lg font-semibold text-gray-800 dark:text-gray-100">Coach</h1>
			<span class="text-xs text-gray-500 dark:text-gray-400">
				settings & policies
			</span>
		</div>
		<div class="flex items-center gap-3">
			<span class="text-xs text-gray-500 dark:text-gray-400">
				{enabled ? 'on' : 'off'}
			</span>
			<div class={accessEnabled ? '' : 'pointer-events-none opacity-50'}>
				<Switch
					state={enabled}
					on:change={(e) => saveConfig({ enabled: e.detail })}
					tooltip={enabled ? 'On' : 'Off'}
				/>
			</div>
		</div>
	</header>

	{#if !accessEnabled}
		<div
			class="mx-6 mt-3 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
		>
			Coach access is disabled for your account by an administrator.
		</div>
	{/if}

	<!-- Main two-column layout -->
	<div class="flex-1 grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-0 overflow-hidden">
		<!-- LEFT: settings + policy list -->
		<aside
			class="border-r border-gray-200 dark:border-gray-800 overflow-y-auto p-5 flex flex-col gap-5 text-sm"
		>
			<section class="flex flex-col gap-3">
				<h2 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
					Settings
				</h2>

				<div class="flex items-center justify-between">
					<div class="flex flex-col">
						<span>Demo mode</span>
						<span class="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">
							Scripted verdicts · keywords: demo:flag, demo:followup, demo:critical, demo:none
						</span>
					</div>
					<div class={accessEnabled ? '' : 'pointer-events-none opacity-50'}>
						<Switch
							state={demoMode}
							on:change={(e) => saveConfig({ demo_mode: e.detail })}
							tooltip={demoMode ? 'Demo' : 'Live'}
						/>
					</div>
				</div>

				<label class="flex flex-col gap-1">
					<span class="text-xs text-gray-500 dark:text-gray-400">Coach model</span>
					<select
						value={coachModelId}
						on:change={onModelChange}
						disabled={!enabled || demoMode}
						class="w-full px-2 py-1.5 rounded-md bg-transparent border border-gray-200 dark:border-gray-700 outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
					>
						<option value="">— none —</option>
						{#each $models as m}
							<option value={m.id}>{m.name ?? m.id}</option>
						{/each}
					</select>
				</label>

				<label class="flex flex-col gap-1">
					<span class="text-xs text-gray-500 dark:text-gray-400">UI style</span>
					<select
						value={$coachUIVariant}
						on:change={(e) =>
							coachUIVariant.set(
								(e.currentTarget as HTMLSelectElement).value as CoachUIVariant
							)}
						class="w-full px-2 py-1.5 rounded-md bg-transparent border border-gray-200 dark:border-gray-700 outline-none focus:ring-1 focus:ring-emerald-500"
					>
						{#each COACH_UI_VARIANTS as v}
							<option value={v}>{v}</option>
						{/each}
					</select>
				</label>

				<button
					type="button"
					class="self-start text-xs px-2.5 py-1 rounded-md border border-dashed border-gray-300 dark:border-gray-600 hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400"
					on:click={() => (playgroundOpen = true)}
				>
					▶ Playground (dry-run)
				</button>
			</section>

			{#if $sharedPolicies.length > 0}
				<section class="flex flex-col gap-1">
					<h2 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
						Shared
					</h2>
					<PolicyList
						policies={$sharedPolicies}
						{activeIds}
						shareable={isAdmin}
						disabled={!enabled}
						on:toggleActive={(e) => togglePolicyActive(e.detail)}
						on:unshare={(e) => onUnshare(e.detail)}
					/>
				</section>
			{/if}

			<section class="flex flex-col gap-1">
				<div class="flex items-center justify-between">
					<h2 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
						My policies
					</h2>
					<button
						type="button"
						class="text-xs text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-50"
						disabled={!enabled}
						on:click={openCreate}
					>
						+ new
					</button>
				</div>
				{#if $personalPolicies.length === 0}
					<div class="text-gray-400 dark:text-gray-500 italic text-xs py-1">
						No personal policies yet — click <span class="font-mono">+ new</span> to write one.
					</div>
				{:else}
					<PolicyList
						policies={$personalPolicies}
						{activeIds}
						editable
						shareable={isAdmin}
						disabled={!enabled}
						on:toggleActive={(e) => togglePolicyActive(e.detail)}
						on:edit={(e) => openEdit(e.detail)}
						on:delete={(e) => onDelete(e.detail)}
						on:share={(e) => onShare(e.detail)}
					/>
				{/if}
			</section>

			{#if isAdmin}
				<section class="flex flex-col gap-1 border-t border-gray-200 dark:border-gray-800 pt-3">
					<button
						type="button"
						class="flex items-center gap-1 text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400"
						on:click={() => (accessAdminOpen = !accessAdminOpen)}
						aria-expanded={accessAdminOpen}
					>
						<span class="transition-transform inline-block {accessAdminOpen ? 'rotate-90' : ''}">
							▸
						</span>
						<span>Admin · user access</span>
					</button>
					{#if accessAdminOpen}
						{#key accessAdminOpen}
							<CoachAccessAdmin {token} {selfUserId} />
						{/key}
					{/if}
				</section>
			{/if}
		</aside>

		<!-- RIGHT: editor pane -->
		<main class="overflow-y-auto p-6 lg:p-8">
			{#if editorOpen}
				<div class="max-w-3xl mx-auto h-full flex flex-col">
					<PolicyEditorForm
						policy={editorPolicy}
						{saving}
						on:save={onSave}
						on:cancel={closeEditor}
					/>
				</div>
			{:else}
				<div
					class="h-full flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400 gap-3"
				>
					<div class="text-sm">
						Pick a policy from the left to edit, or start a new one.
					</div>
					<button
						type="button"
						class="px-3 py-1.5 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
						disabled={!enabled}
						on:click={openCreate}
					>
						+ New policy
					</button>
				</div>
			{/if}
		</main>
	</div>
</div>

<!-- Dry-run playground stays a modal — it's a separate workflow. -->
<Modal bind:show={playgroundOpen} size="xl">
	<div class="p-5">
		<CoachPlayground on:close={() => (playgroundOpen = false)} />
	</div>
</Modal>
