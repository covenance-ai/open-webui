<script lang="ts">
	// Fixed-position pill that follows the *currently-viewed* chat. Mounted
	// once at boot from `init.ts`; reads the upstream chatId store and
	// shows that chat's status (or nothing if there's no active event).
	//
	// Sits in the bottom-right gutter so it's visible during typing and
	// doesn't fight the message stream or the right-rail tools.

	import { chatId } from '$lib/stores';

	import CoachStatusIndicator from '../components/CoachStatusIndicator.svelte';
</script>

<div class="coach-status-anchor">
	<CoachStatusIndicator chatId={$chatId || null} />
</div>

<style>
	.coach-status-anchor {
		position: fixed;
		right: 12px;
		bottom: 8px;
		z-index: 40;
		pointer-events: none;
	}
	.coach-status-anchor :global(span) {
		pointer-events: auto;
	}
</style>
