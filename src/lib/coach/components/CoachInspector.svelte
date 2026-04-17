<script lang="ts">
	// Full-fidelity view of one coach evaluation. Rendered inside the
	// detail modal (event inspector) and the playground result panel so
	// both surfaces stay visually identical — if you debug one, you know
	// how to read the other.
	//
	// Designed for an AI-dev reader: prompt, raw reply, and verdict are
	// the load-bearing blocks. Everything else (status, tokens, policies)
	// is supporting context shown above them.

	import type { CoachEventDetail, CoachRenderedMessage } from '../types';

	export let detail: CoachEventDetail;

	function statusTint(s: string): string {
		switch (s) {
			case 'ok':
				return 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200';
			case 'error':
				return 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200';
			case 'demo':
				return 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200';
			default:
				return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300';
		}
	}

	function roleTint(role: string): string {
		switch (role) {
			case 'system':
				return 'text-indigo-600 dark:text-indigo-400';
			case 'user':
				return 'text-emerald-600 dark:text-emerald-400';
			case 'assistant':
				return 'text-sky-600 dark:text-sky-400';
			default:
				return 'text-gray-500 dark:text-gray-400';
		}
	}

	function formatTs(ms: number): string {
		const d = new Date(ms);
		return d.toLocaleString();
	}

	$: verdictJson = JSON.stringify(detail.verdict ?? {}, null, 2);
</script>

<div class="flex flex-col gap-3 text-xs">
	<!-- Header: status + action + tokens + duration -->
	<div class="flex items-center flex-wrap gap-2">
		<span class="px-2 py-0.5 rounded-full font-semibold {statusTint(detail.status)}">
			{detail.status}
		</span>
		{#if detail.action}
			<span class="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 font-mono">
				{detail.action}
			</span>
		{/if}
		{#if detail.model_id}
			<span class="text-gray-500 dark:text-gray-400">model: <span class="font-mono">{detail.model_id}</span></span>
		{/if}
		{#if detail.tokens_in !== null || detail.tokens_out !== null}
			<span class="text-gray-500 dark:text-gray-400">
				tokens: <span class="font-mono">{detail.tokens_in ?? '?'} → {detail.tokens_out ?? '?'}</span>
			</span>
		{/if}
		<span class="text-gray-500 dark:text-gray-400">
			<span class="font-mono">{detail.duration_ms}ms</span>
		</span>
		<span class="ml-auto text-gray-400 dark:text-gray-500">{formatTs(detail.ts_ms)}</span>
	</div>

	{#if detail.error}
		<div class="rounded-md border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/40 p-2">
			<div class="text-red-700 dark:text-red-300 font-semibold mb-0.5">LLM error</div>
			<div class="font-mono break-all text-red-800 dark:text-red-200">{detail.error}</div>
		</div>
	{/if}

	{#if detail.reason}
		<div class="rounded-md border border-gray-200 dark:border-gray-700 p-2">
			<span class="font-semibold text-gray-700 dark:text-gray-200">Skipped:</span>
			<span class="font-mono text-gray-600 dark:text-gray-300">{detail.reason}</span>
		</div>
	{/if}

	<!-- Active policies -->
	<section>
		<div class="uppercase tracking-wider text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
			Active policies ({detail.active_policies.length})
		</div>
		{#if detail.active_policies.length === 0}
			<div class="text-gray-400 dark:text-gray-500 italic">No policies were active for this call.</div>
		{:else}
			<ul class="flex flex-col gap-1">
				{#each detail.active_policies as p (p.id)}
					<li class="rounded-md border border-gray-200 dark:border-gray-700 p-2">
						<div class="flex items-center gap-2">
							<span class="font-semibold">{p.title}</span>
							{#if p.is_shared}
								<span class="text-[10px] px-1 rounded bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">shared</span>
							{/if}
							<span class="ml-auto text-[10px] font-mono text-gray-400">{p.id.slice(0, 8)}</span>
						</div>
						<div class="text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{p.body}</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Conversation the coach saw -->
	<section>
		<div class="uppercase tracking-wider text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
			Conversation ({detail.conversation.length} turns)
		</div>
		<ul class="flex flex-col gap-1 max-h-52 overflow-y-auto pr-1">
			{#each detail.conversation as turn, i (i)}
				<li class="rounded-md border border-gray-200 dark:border-gray-700 p-2">
					<div class="flex items-center gap-2 font-mono text-[10px]">
						<span class={roleTint(turn.role)}>{turn.role}</span>
						{#if turn.coach_authored}
							<span class="text-purple-600 dark:text-purple-400">(coach-authored)</span>
						{/if}
					</div>
					<div class="whitespace-pre-wrap">{turn.content}</div>
				</li>
			{/each}
		</ul>
	</section>

	<!-- Rendered prompt sent to coach LLM -->
	<section>
		<div class="uppercase tracking-wider text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
			Prompt sent to coach
		</div>
		{#if detail.rendered_prompt.length === 0}
			<div class="text-gray-400 dark:text-gray-500 italic">
				LLM was not called (demo mode or pre-LLM skip).
			</div>
		{:else}
			<ul class="flex flex-col gap-1 max-h-80 overflow-y-auto pr-1">
				{#each detail.rendered_prompt as m, i (i)}
					{@const msg = m as CoachRenderedMessage}
					<li class="rounded-md border border-gray-200 dark:border-gray-700 p-2">
						<div class="font-mono text-[10px] {roleTint(msg.role)}">{msg.role}</div>
						<pre class="whitespace-pre-wrap font-mono text-[11px] leading-snug">{msg.content}</pre>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Raw LLM reply -->
	<section>
		<div class="uppercase tracking-wider text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
			Raw LLM reply
		</div>
		{#if detail.raw_reply === null || detail.raw_reply === undefined}
			<div class="text-gray-400 dark:text-gray-500 italic">No LLM call was made.</div>
		{:else if detail.raw_reply === ''}
			<div class="text-gray-400 dark:text-gray-500 italic">(empty string — LLM returned nothing)</div>
		{:else}
			<pre class="rounded-md border border-gray-200 dark:border-gray-700 p-2 whitespace-pre-wrap font-mono text-[11px] leading-snug max-h-60 overflow-y-auto">{detail.raw_reply}</pre>
		{/if}
	</section>

	<!-- Parsed verdict -->
	<section>
		<div class="uppercase tracking-wider text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
			Parsed verdict
		</div>
		<pre class="rounded-md border border-gray-200 dark:border-gray-700 p-2 whitespace-pre-wrap font-mono text-[11px] leading-snug">{verdictJson}</pre>
	</section>
</div>
