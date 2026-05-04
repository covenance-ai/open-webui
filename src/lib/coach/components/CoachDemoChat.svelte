<script lang="ts">
	// Simulated chat for the /coach page demo cards. Plays out a
	// synthetic user → LLM → coach-reaction sequence for one of the 3
	// kinds (block / flag / intervene). Runs entirely in the browser
	// against the kindMeta palette — no backend round-trip — so the
	// demo is deterministic and instant. The simulation is "in
	// character" with how coach renders in real chat: same colours,
	// same icons, same wording style.

	import { onDestroy } from 'svelte';
	import { KIND_META, type DemoStep } from '../kindMeta';
	import type { PolicyKind } from '../types';

	// Each step in the simulated stream is the DemoStep type from
	// kindMeta.ts. ``transient`` steps (typing dots, "reviewing…" pills)
	// are removed when the next step lands instead of remaining in the
	// transcript — that's what makes it feel like a live conversation.
	export let scripts: Record<PolicyKind, DemoStep[]>;
	export let activeKind: PolicyKind | null = null;
	export let stepDelayMs = 700;

	let visible: DemoStep[] = [];
	let runId = 0;
	let running = false;

	$: if (activeKind) {
		void run(activeKind);
	} else {
		visible = [];
	}

	async function sleep(ms: number) {
		return new Promise((r) => setTimeout(r, ms));
	}

	async function run(kind: PolicyKind) {
		const id = ++runId;
		running = true;
		visible = [];
		const steps = scripts[kind] ?? [];
		for (const step of steps) {
			// Bail if the user clicked another demo before this one
			// finished — without this, two scripts can interleave.
			if (id !== runId) return;
			// Drop the trailing transient (typing dots etc) before
			// pushing the next concrete event.
			visible = [...visible.filter((s) => !s.transient), step];
			await sleep(stepDelayMs);
		}
		// Strip any trailing transient when the script ends so the
		// preview lands on the final state without a stale spinner.
		if (id === runId) {
			visible = visible.filter((s) => !s.transient);
			running = false;
		}
	}

	onDestroy(() => {
		runId = -1; // cancel any in-flight script
	});
</script>

{#if activeKind}
	{@const meta = KIND_META[activeKind]}
	<div
		class="rounded-xl border {meta.cardBorder} {meta.cardBg} px-4 py-3 flex flex-col gap-2"
		aria-label="Simulated coach chat for {meta.label} demo"
	>
		<div class="flex items-center gap-2 text-xs">
			<span class="font-medium {meta.cardAccent}">
				{meta.icon} {meta.label} demo
			</span>
			<span class="text-gray-500 dark:text-gray-400">
				· {meta.tagline}
			</span>
			{#if running}
				<span class="text-gray-400 dark:text-gray-500 animate-pulse ml-auto">
					running…
				</span>
			{/if}
		</div>

		<ol class="flex flex-col gap-1.5 text-sm">
			{#each visible as step, i (i)}
				{#if step.role === 'user'}
					<li class="flex justify-end">
						<div
							class="max-w-[80%] px-3 py-1.5 rounded-2xl rounded-br-md bg-emerald-500 text-white"
						>
							{step.text}
						</div>
					</li>
				{:else if step.role === 'assistant' && step.variant === 'typing'}
					<li class="flex justify-start">
						<div
							class="px-3 py-1.5 rounded-2xl rounded-bl-md bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 italic"
						>
							typing…
						</div>
					</li>
				{:else if step.role === 'assistant' && step.variant === 'thinking'}
					<li class="flex justify-start">
						<div
							class="px-3 py-1.5 rounded-2xl rounded-bl-md bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 italic"
						>
							assistant thinking…
						</div>
					</li>
				{:else if step.role === 'assistant'}
					<li class="flex justify-start">
						<div
							class="max-w-[80%] px-3 py-1.5 rounded-2xl rounded-bl-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100 whitespace-pre-line"
						>
							{step.text}
						</div>
					</li>
				{:else if step.role === 'coach' && step.variant === 'reviewing'}
					<li class="flex justify-center">
						<div
							class="px-2 py-0.5 rounded-full text-[11px] bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 italic"
						>
							coach reviewing…
						</div>
					</li>
				{:else if step.role === 'coach' && step.variant === 'block'}
					<li>
						<div
							class="rounded-lg px-3 py-2 text-xs {meta.chatBubble} border-l-4 flex flex-col gap-0.5"
						>
							<span class="font-semibold {meta.cardAccent}">
								⛔ Coach blocked this message
							</span>
							{#if step.policyTitle}
								<span class="text-[10px] text-gray-500 dark:text-gray-400 italic">
									Policy: {step.policyTitle}
								</span>
							{/if}
							<span class="text-gray-700 dark:text-gray-200">{step.text}</span>
						</div>
					</li>
				{:else if step.role === 'coach' && step.variant === 'flag'}
					<li>
						<div
							class="rounded-lg px-3 py-2 text-xs {meta.chatBubble} border-l-4 flex flex-col gap-0.5"
						>
							<span class="font-semibold {meta.cardAccent}">
								🚩 Coach flagged the reply above
							</span>
							{#if step.policyTitle}
								<span class="text-[10px] text-gray-500 dark:text-gray-400 italic">
									Policy: {step.policyTitle}
								</span>
							{/if}
							<span class="text-gray-700 dark:text-gray-200">{step.text}</span>
						</div>
					</li>
				{:else if step.role === 'coach' && step.variant === 'intervene'}
					<li class="flex justify-end">
						<div
							class="max-w-[80%] px-3 py-1.5 rounded-2xl rounded-br-md border-2 border-dashed {meta.cardAccent} {meta.cardBg}"
						>
							<div class="text-[10px] uppercase tracking-wide opacity-70 mb-0.5">
								Coach (auto-sent on your behalf)
							</div>
							{#if step.policyTitle}
								<div class="text-[10px] text-gray-500 dark:text-gray-400 italic mb-0.5">
									Policy: {step.policyTitle}
								</div>
							{/if}
							<div class="text-gray-800 dark:text-gray-100">{step.text}</div>
						</div>
					</li>
				{:else if step.role === 'system'}
					<li class="flex justify-center">
						<div
							class="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
						>
							{step.text}
						</div>
					</li>
				{/if}
			{/each}
		</ol>
	</div>
{/if}
