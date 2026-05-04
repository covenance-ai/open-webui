<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import { KIND_META } from '../kindMeta';
	import type { CoachPolicy } from '../types';

	export let policies: CoachPolicy[] = [];
	export let activeIds: string[] = [];
	export let editable = false; // personal policies: show edit/delete
	export let shareable = false; // admin only: show share-this-one
	export let disabled = false;
	// Hide the kind chip — useful when the parent already groups by kind
	// and the chip is redundant (e.g. /coach page sections).
	export let showKind = true;

	const dispatch = createEventDispatcher<{
		toggleActive: string;
		edit: CoachPolicy;
		delete: CoachPolicy;
		share: CoachPolicy;
		unshare: CoachPolicy;
	}>();

	$: activeSet = new Set(activeIds);
</script>

<ul class="flex flex-col gap-0.5">
	{#each policies as p (p.id)}
		<li
			class="flex items-center gap-2 py-1 px-1 rounded-md {disabled
				? 'opacity-50'
				: 'hover:bg-gray-100 dark:hover:bg-gray-850'}"
		>
			<input
				type="checkbox"
				{disabled}
				checked={activeSet.has(p.id)}
				on:change={() => dispatch('toggleActive', p.id)}
				class="size-3.5 cursor-pointer"
			/>

			{#if showKind}
				{@const meta = KIND_META[p.kind ?? 'flag']}
				<Tooltip content={meta.tagline} placement="top">
					<span
						class="text-[10px] px-1.5 py-0.5 rounded-md font-medium select-none {meta.chipBg} {meta.chipFg}"
						aria-label="kind: {meta.label}"
					>
						{meta.icon} {meta.label}
					</span>
				</Tooltip>
			{/if}

			<Tooltip content={p.body} placement="right">
				<span class="text-sm flex-1 truncate select-none">
					{p.title}
				</span>
			</Tooltip>

			{#if editable && !disabled}
				<button
					type="button"
					class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1"
					on:click={() => dispatch('edit', p)}
					title="Edit"
				>
					✎
				</button>
				<button
					type="button"
					class="text-xs text-gray-400 hover:text-red-500 px-1"
					on:click={() => dispatch('delete', p)}
					title="Delete"
				>
					✕
				</button>
			{/if}

			{#if shareable && !disabled}
				{#if p.is_shared}
					<button
						type="button"
						class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1"
						on:click={() => dispatch('unshare', p)}
						title="Unshare"
					>
						↺
					</button>
				{:else}
					<button
						type="button"
						class="text-xs text-gray-400 hover:text-emerald-500 px-1"
						on:click={() => dispatch('share', p)}
						title="Share with everyone"
					>
						↗
					</button>
				{/if}
			{/if}
		</li>
	{/each}
</ul>
