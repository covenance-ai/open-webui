<script lang="ts">
	// Dry-run playground. Compose a transcript, pick policies and a model,
	// hit Run — see the full CoachInspector view: prompt, raw reply,
	// verdict. Nothing is persisted; the /dry-run endpoint is side-effect
	// free so you can iterate on policy wording without polluting a chat.

	import { createEventDispatcher } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { models } from '$lib/stores';
	import * as api from '../api';
	import { coachConfig } from '../stores/config';
	import { coachPolicies } from '../stores/policies';
	import type { CoachEventDetail, CoachConversationTurn } from '../types';

	import CoachInspector from './CoachInspector.svelte';

	const dispatch = createEventDispatcher();

	$: token = typeof localStorage !== 'undefined' ? (localStorage.token ?? '') : '';

	// Default a reasonable transcript so the first Run is productive.
	let userMessage = 'What are the side effects of ibuprofen?';
	let assistantMessage =
		"Common side effects include stomach upset, nausea, and in rare cases gastrointestinal bleeding. Consult your doctor if you have kidney or liver issues.";

	let coachModelId = '';
	let demoMode = false;
	let selectedPolicyIds: Record<string, boolean> = {};

	// Seed from current config the first time this component mounts.
	let seeded = false;
	$: if (!seeded && $coachConfig) {
		coachModelId = $coachConfig.coach_model_id ?? '';
		demoMode = $coachConfig.demo_mode ?? false;
		for (const id of $coachConfig.active_policy_ids ?? []) {
			selectedPolicyIds[id] = true;
		}
		seeded = true;
	}

	let result: CoachEventDetail | null = null;
	let running = false;

	async function run() {
		if (!token) return;
		if (!userMessage.trim() && !assistantMessage.trim()) {
			toast.error('Playground: add at least one turn.');
			return;
		}

		const conversation: CoachConversationTurn[] = [];
		if (userMessage.trim()) {
			conversation.push({ role: 'user', content: userMessage, coach_authored: false });
		}
		if (assistantMessage.trim()) {
			conversation.push({ role: 'assistant', content: assistantMessage, coach_authored: false });
		}

		const chosenIds = Object.entries(selectedPolicyIds)
			.filter(([, on]) => on)
			.map(([id]) => id);

		running = true;
		try {
			result = await api.dryRunCoach(token, {
				conversation,
				policy_ids: chosenIds,
				coach_model_id: coachModelId || null,
				demo_mode: demoMode,
				enabled: true // playground always runs the pipeline
			});
		} catch (err) {
			toast.error(`Playground: ${(err as Error).message}`);
		} finally {
			running = false;
		}
	}

	function close() {
		dispatch('close');
	}
</script>

<div class="flex flex-col gap-4 text-sm text-gray-800 dark:text-gray-100">
	<header class="flex items-center justify-between">
		<div>
			<h2 class="text-base font-semibold">Coach playground</h2>
			<p class="text-xs text-gray-500 dark:text-gray-400">
				Evaluate a transcript against your policies without touching a real chat.
				Nothing here is persisted.
			</p>
		</div>
		<button
			type="button"
			class="text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
			on:click={close}
			aria-label="Close"
		>
			✕
		</button>
	</header>

	<!-- Configuration row -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
		<label class="flex flex-col gap-1 text-xs">
			<span class="text-gray-500 dark:text-gray-400">Coach model</span>
			<select
				bind:value={coachModelId}
				disabled={demoMode}
				class="px-2 py-1 rounded-md bg-transparent border border-gray-200 dark:border-gray-700 outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
			>
				<option value="">— none —</option>
				{#each $models as m}
					<option value={m.id}>{m.name ?? m.id}</option>
				{/each}
			</select>
		</label>
		<label class="flex items-center gap-2 text-xs mt-5">
			<input type="checkbox" bind:checked={demoMode} class="accent-purple-500" />
			<span>Demo mode (scripted verdicts, no LLM call)</span>
		</label>
	</div>

	<!-- Policy picker -->
	<div>
		<div class="flex items-center justify-between mb-1">
			<span class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
				Policies ({Object.values(selectedPolicyIds).filter(Boolean).length}/{$coachPolicies.length})
			</span>
		</div>
		{#if $coachPolicies.length === 0}
			<div class="text-xs text-gray-400 dark:text-gray-500 italic">
				No policies yet — create one from the sidebar to give coach something to evaluate against.
			</div>
		{:else}
			<ul class="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1">
				{#each $coachPolicies as p (p.id)}
					<li class="flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							bind:checked={selectedPolicyIds[p.id]}
							class="accent-emerald-500"
						/>
						<span class="font-medium">{p.title}</span>
						{#if p.is_shared}
							<span class="text-[10px] px-1 rounded bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">shared</span>
						{/if}
						<span class="text-gray-400 dark:text-gray-500 truncate">— {p.body}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- Transcript -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
		<label class="flex flex-col gap-1 text-xs">
			<span class="text-gray-500 dark:text-gray-400 uppercase tracking-wider">User message</span>
			<textarea
				bind:value={userMessage}
				rows="4"
				class="px-2 py-1 rounded-md bg-transparent border border-gray-200 dark:border-gray-700 outline-none focus:ring-1 focus:ring-emerald-500 font-mono text-[12px]"
				placeholder="Paste what the user asked"
			></textarea>
		</label>
		<label class="flex flex-col gap-1 text-xs">
			<span class="text-gray-500 dark:text-gray-400 uppercase tracking-wider">Assistant reply</span>
			<textarea
				bind:value={assistantMessage}
				rows="4"
				class="px-2 py-1 rounded-md bg-transparent border border-gray-200 dark:border-gray-700 outline-none focus:ring-1 focus:ring-emerald-500 font-mono text-[12px]"
				placeholder="Paste what the assistant answered"
			></textarea>
		</label>
	</div>

	<div class="flex items-center justify-end gap-2">
		<button
			type="button"
			class="px-3 py-1.5 text-xs rounded-md bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-50"
			disabled={running}
			on:click={run}
		>
			{running ? 'Running…' : 'Run coach'}
		</button>
	</div>

	{#if result}
		<div class="border-t border-gray-200 dark:border-gray-700 pt-3">
			<CoachInspector detail={result} />
		</div>
	{/if}
</div>
