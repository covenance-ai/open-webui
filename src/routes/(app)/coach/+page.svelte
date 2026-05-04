<script lang="ts">
	// Dedicated full-page Coach workbench. The page is structured around
	// the 3 canonical use cases — block / flag / intervene — so the user
	// sees what coach DOES before configuring how. Top of the page:
	// three "Try it" cards that play out a deterministic simulated chat
	// for each kind. Below: policies grouped by kind, with an inline
	// editor that has room for real authoring (rows=22, ~70vh). Sidebar
	// holds compact settings.

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
	import {
		POLICY_KINDS,
		type CoachConfigForm,
		type CoachPolicy,
		type PolicyKind
	} from '$lib/coach/types';

	import CoachAccessAdmin from '$lib/coach/components/CoachAccessAdmin.svelte';
	import CoachDemoChat from '$lib/coach/components/CoachDemoChat.svelte';
	import CoachPlayground from '$lib/coach/components/CoachPlayground.svelte';
	import PolicyEditorForm from '$lib/coach/components/PolicyEditorForm.svelte';
	import PolicyList from '$lib/coach/components/PolicyList.svelte';
	import { KIND_META, type DemoStep } from '$lib/coach/kindMeta';
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

	// ─── Demo runner ──────────────────────────────────────────────────
	// One script per kind. Steps run with a fixed delay between them in
	// CoachDemoChat. Wording mirrors how coach renders in real chat:
	// red block banner, amber flag chip, sky-coloured intervene reply.
	const DEMO_SCRIPTS: Record<PolicyKind, DemoStep[]> = {
		block: [
			{ role: 'system', text: 'pre-flight (before the LLM sees the message)' },
			{
				role: 'user',
				text:
					"Here are three candidates' résumés — who should I hire for " +
					'the senior engineer role?'
			},
			{ role: 'coach', variant: 'reviewing', transient: true },
			{
				role: 'coach',
				variant: 'block',
				policyTitle: 'No LLM for hiring decisions',
				text:
					'This request appears to involve using an LLM for hiring ' +
					'decisions, which your coach policy forbids. Please handle ' +
					'candidate evaluation outside of this assistant.'
			},
			{ role: 'system', text: 'the LLM was never called' }
		],
		flag: [
			{ role: 'system', text: 'post-flight (after the LLM replies)' },
			{
				role: 'user',
				text: 'Summarise the article on dark patterns in UI design.'
			},
			{ role: 'assistant', variant: 'thinking', transient: true },
			{
				role: 'assistant',
				text:
					'Dark patterns are deceptive UI designs that trick users into ' +
					'doing things they would not choose to do — sneak-into-basket, ' +
					'forced continuity, confirmshaming, etc.'
			},
			{ role: 'coach', variant: 'reviewing', transient: true },
			{
				role: 'coach',
				variant: 'flag',
				policyTitle: 'Cite sources for factual claims',
				text:
					'No source cited for the article being summarised. Reader ' +
					"can't verify the summary against the original."
			}
		],
		intervene: [
			{ role: 'system', text: 'post-flight (after the LLM replies)' },
			{
				role: 'user',
				text: 'Explain how rate limiting protects an API.'
			},
			{ role: 'assistant', variant: 'thinking', transient: true },
			{
				role: 'assistant',
				text:
					'Rate limiting restricts how often clients can call an API in a ' +
					'time window, preventing overload and abuse.'
			},
			{ role: 'coach', variant: 'reviewing', transient: true },
			{
				role: 'coach',
				variant: 'intervene',
				text:
					'Please add one concrete example of a rate-limit policy (e.g. ' +
					'"100 req/min per IP") and one concrete failure mode it ' +
					'prevents — the answer is too abstract to be useful.'
			},
			{ role: 'assistant', variant: 'thinking', transient: true },
			{
				role: 'assistant',
				text:
					'Concrete example: 100 requests / minute per IP, returning HTTP ' +
					"429 over the limit.\n\nWithout it: a single misbehaving client " +
					'can saturate worker pools and DOS legitimate traffic — even ' +
					'unintentionally, e.g. a retry loop after a transient 500.'
			}
		]
	};

	let activeKind: PolicyKind | null = null;
	function runDemo(kind: PolicyKind) {
		// Always reset so re-clicking the same card replays the script.
		activeKind = null;
		setTimeout(() => (activeKind = kind), 0);
	}
	function clearDemo() {
		activeKind = null;
	}

	// ─── Editor state ─────────────────────────────────────────────────
	let editorOpen = false;
	let editorPolicy: CoachPolicy | null = null;
	let saving = false;

	function openCreate(kind: PolicyKind | null = null) {
		// kind can be passed by the demo cards' "Author one" link to
		// pre-select the kind in the new-policy form.
		editorPolicy = kind
			? ({
					id: '',
					user_id: null,
					is_shared: false,
					title: '',
					body: '',
					kind,
					created_at: 0,
					updated_at: 0
				} as CoachPolicy)
			: null;
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

	// ─── Config + policy mutations ────────────────────────────────────
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

	async function onSave(
		e: CustomEvent<{
			id: string | null;
			title: string;
			body: string;
			kind: PolicyKind;
		}>
	) {
		if (!token) return;
		const { id, title, body, kind } = e.detail;
		// New-create path passes a synthetic empty id from openCreate(kind).
		// Treat empty id as create-new.
		const realId = id && id.length > 0 ? id : null;
		saving = true;
		try {
			if (realId) {
				const updated = await api.updateCoachPolicy(token, realId, {
					title,
					body,
					kind
				});
				coachPolicies.update((ps) =>
					ps.map((p) => (p.id === updated.id ? updated : p))
				);
				editorPolicy = updated;
			} else {
				const created = await api.createCoachPolicy(token, {
					title,
					body,
					kind
				});
				coachPolicies.update((ps) => [created, ...ps]);
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
				void saveConfig({
					active_policy_ids: activeIds.filter((x) => x !== p.id)
				});
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
			coachPolicies.update((ps) =>
				ps.map((x) => (x.id === shared.id ? shared : x))
			);
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
		}
	}

	async function onUnshare(p: CoachPolicy) {
		if (!token) return;
		try {
			const unshared = await api.unshareCoachPolicy(token, p.id);
			coachPolicies.update((ps) =>
				ps.map((x) => (x.id === unshared.id ? unshared : x))
			);
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
		}
	}

	let accessAdminOpen = false;
	let playgroundOpen = false;

	// Group policies by kind for the sectioned list view. Each group
	// renders as its own PolicyList — chip is hidden inside each section
	// (already implied by the section header).
	$: personalByKind = (() => {
		const out: Record<PolicyKind, CoachPolicy[]> = {
			block: [],
			flag: [],
			intervene: []
		};
		for (const p of $personalPolicies as CoachPolicy[]) {
			out[p.kind ?? 'flag'].push(p);
		}
		return out;
	})();
	$: sharedByKind = (() => {
		const out: Record<PolicyKind, CoachPolicy[]> = {
			block: [],
			flag: [],
			intervene: []
		};
		for (const p of $sharedPolicies as CoachPolicy[]) {
			out[p.kind ?? 'flag'].push(p);
		}
		return out;
	})();

	onMount(() => {
		if (!token) return;
		void api
			.listCoachPolicies(token)
			.then((ps) => coachPolicies.set(ps))
			.catch(() => {});
		void api
			.getCoachConfig(token)
			.then((c) => coachConfig.set(c))
			.catch(() => {});
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
				policy authoring + live demo
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

	<!-- Two columns: settings sidebar + main content -->
	<div class="flex-1 grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-0 overflow-hidden">
		<!-- LEFT: settings (compact) -->
		<aside
			class="border-r border-gray-200 dark:border-gray-800 overflow-y-auto p-5 flex flex-col gap-5 text-sm"
		>
			<section class="flex flex-col gap-3">
				<h2
					class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
				>
					Settings
				</h2>

				<div class="flex items-center justify-between">
					<div class="flex flex-col">
						<span>Demo mode</span>
						<span class="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">
							Scripted verdicts for live demos · keywords: demo:block, demo:flag,
							demo:intervene
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

			{#if isAdmin}
				<section
					class="flex flex-col gap-1 border-t border-gray-200 dark:border-gray-800 pt-3"
				>
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

		<!-- RIGHT: hero (3 demo cards + simulated chat) above the editor + policy lists -->
		<main class="overflow-y-auto p-6 lg:p-8 flex flex-col gap-6">
			<!-- Hero: how coach works -->
			<section class="flex flex-col gap-3">
				<header class="flex items-baseline justify-between">
					<h2 class="text-base font-semibold text-gray-800 dark:text-gray-100">
						Coach has 3 modes — try them
					</h2>
					{#if activeKind}
						<button
							type="button"
							class="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100"
							on:click={clearDemo}
						>
							✕ close demo
						</button>
					{/if}
				</header>

				<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
					{#each POLICY_KINDS as kind}
						{@const meta = KIND_META[kind]}
						<article
							class="rounded-xl border {meta.cardBorder} {meta.cardBg} p-4 flex flex-col gap-2"
						>
							<div class="flex items-center gap-2 {meta.cardAccent}">
								<span class="text-xl" aria-hidden="true">{meta.icon}</span>
								<span class="font-semibold text-sm">{meta.label}</span>
							</div>
							<p class="text-xs text-gray-700 dark:text-gray-200">
								{meta.tagline}.
							</p>
							<p class="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
								{meta.when}
							</p>
							<div class="flex flex-wrap gap-2 mt-1">
								<button
									type="button"
									class="px-2.5 py-1 text-xs rounded-md font-medium text-white
										{kind === 'block'
										? 'bg-red-600 hover:bg-red-700'
										: kind === 'flag'
											? 'bg-amber-600 hover:bg-amber-700'
											: 'bg-sky-600 hover:bg-sky-700'}"
									on:click={() => runDemo(kind)}
								>
									▶ Try it
								</button>
								<button
									type="button"
									class="px-2.5 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 hover:border-emerald-500"
									on:click={() => openCreate(kind)}
								>
									+ Author one
								</button>
							</div>
						</article>
					{/each}
				</div>

				<CoachDemoChat scripts={DEMO_SCRIPTS} {activeKind} />
			</section>

			<!-- Editor pane (only when an edit is in progress) -->
			{#if editorOpen}
				<section
					class="rounded-xl border border-gray-200 dark:border-gray-800 p-5 bg-white dark:bg-gray-900"
				>
					<PolicyEditorForm
						policy={editorPolicy}
						{saving}
						on:save={onSave}
						on:cancel={closeEditor}
					/>
				</section>
			{/if}

			<!-- Policy lists, grouped by kind -->
			<section class="flex flex-col gap-4">
				<header class="flex items-center justify-between">
					<h2 class="text-base font-semibold text-gray-800 dark:text-gray-100">
						Policies
					</h2>
					<button
						type="button"
						class="text-xs px-2.5 py-1 rounded-md bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
						disabled={!enabled}
						on:click={() => openCreate(null)}
					>
						+ New policy
					</button>
				</header>

				{#each POLICY_KINDS as kind}
					{@const meta = KIND_META[kind]}
					{@const personal = personalByKind[kind]}
					{@const shared = sharedByKind[kind]}
					{#if personal.length > 0 || shared.length > 0}
						<div class="flex flex-col gap-1.5">
							<div class="flex items-center gap-2 text-xs">
								<span
									class="px-1.5 py-0.5 rounded-md font-medium {meta.chipBg} {meta.chipFg}"
								>
									{meta.icon} {meta.label}
								</span>
								<span class="text-gray-500 dark:text-gray-400">
									{meta.tagline}
								</span>
							</div>
							{#if shared.length > 0}
								<PolicyList
									policies={shared}
									{activeIds}
									showKind={false}
									shareable={isAdmin}
									disabled={!enabled}
									on:toggleActive={(e) => togglePolicyActive(e.detail)}
									on:unshare={(e) => onUnshare(e.detail)}
								/>
							{/if}
							{#if personal.length > 0}
								<PolicyList
									policies={personal}
									{activeIds}
									showKind={false}
									editable
									shareable={isAdmin}
									disabled={!enabled}
									on:toggleActive={(e) => togglePolicyActive(e.detail)}
									on:edit={(e) => openEdit(e.detail)}
									on:delete={(e) => onDelete(e.detail)}
									on:share={(e) => onShare(e.detail)}
								/>
							{/if}
						</div>
					{/if}
				{/each}

				{#if $personalPolicies.length === 0 && $sharedPolicies.length === 0}
					<div class="text-gray-400 dark:text-gray-500 italic text-sm py-1">
						No policies yet — pick a kind above to author one.
					</div>
				{/if}
			</section>
		</main>
	</div>
</div>

<!-- Dry-run playground stays a modal — separate workflow. -->
<Modal bind:show={playgroundOpen} size="xl">
	<div class="p-5">
		<CoachPlayground on:close={() => (playgroundOpen = false)} />
	</div>
</Modal>
