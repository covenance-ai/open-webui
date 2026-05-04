<script lang="ts">
	// Modal wrapper around PolicyEditorForm. Kept for the rail/CoachPanel's
	// inline create/edit flow. The dedicated /coach page uses
	// PolicyEditorForm directly with compact=false so authors get a tall
	// textarea instead of the cramped modal.

	import { createEventDispatcher } from 'svelte';
	import Modal from '$lib/components/common/Modal.svelte';
	import type { CoachPolicy } from '../types';
	import PolicyEditorForm from './PolicyEditorForm.svelte';

	export let show = false;
	export let policy: CoachPolicy | null = null;

	const dispatch = createEventDispatcher<{
		save: { id: string | null; title: string; body: string };
		close: void;
	}>();
</script>

<Modal size="md" bind:show on:close={() => dispatch('close')}>
	<div class="p-5">
		<PolicyEditorForm
			{policy}
			compact
			on:save={(e) => dispatch('save', e.detail)}
			on:cancel={() => dispatch('close')}
		/>
	</div>
</Modal>
