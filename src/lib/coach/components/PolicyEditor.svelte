<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import Modal from '$lib/components/common/Modal.svelte';
	import type { CoachPolicy } from '../types';

	export let show = false;
	export let policy: CoachPolicy | null = null;

	let title = '';
	let body = '';

	// Reset fields when the incoming policy changes (or becomes null for a create).
	$: if (show) {
		title = policy?.title ?? '';
		body = policy?.body ?? '';
	}

	const dispatch = createEventDispatcher<{
		save: { id: string | null; title: string; body: string };
		close: void;
	}>();

	function save() {
		const t = title.trim();
		const b = body.trim();
		if (!t || !b) return;
		dispatch('save', { id: policy?.id ?? null, title: t, body: b });
	}
</script>

<Modal size="md" bind:show on:close={() => dispatch('close')}>
	<div class="p-5">
		<div class="text-lg font-medium mb-3">
			{policy ? 'Edit policy' : 'New policy'}
		</div>

		<div class="flex flex-col gap-3">
			<label class="flex flex-col gap-1">
				<span class="text-xs text-gray-500 dark:text-gray-400">Title</span>
				<input
					type="text"
					bind:value={title}
					placeholder="e.g. Stay factual; cite sources"
					maxlength="200"
					class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent outline-none focus:ring-1 focus:ring-emerald-500"
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-xs text-gray-500 dark:text-gray-400">Policy prompt</span>
				<textarea
					bind:value={body}
					rows="6"
					placeholder="Describe what the coach should check for, in plain language."
					maxlength="5000"
					class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent outline-none focus:ring-1 focus:ring-emerald-500 resize-y"
				></textarea>
			</label>
		</div>

		<div class="flex justify-end gap-2 mt-5">
			<button
				type="button"
				class="px-3 py-1.5 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
				on:click={() => dispatch('close')}
			>
				Cancel
			</button>
			<button
				type="button"
				disabled={!title.trim() || !body.trim()}
				class="px-3 py-1.5 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
				on:click={save}
			>
				{policy ? 'Save' : 'Create'}
			</button>
		</div>
	</div>
</Modal>
