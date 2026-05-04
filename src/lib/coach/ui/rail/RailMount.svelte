<script lang="ts">
	// Entry point for the "rail" variant: a persistent right-side panel plus
	// per-message numbered breadcrumbs. Mounted once by init.ts when the
	// active UI variant is 'rail'.
	//
	// Hidden on /coach — the dedicated page IS the workspace and already
	// renders settings + policies + activity at full width. Showing the
	// rail there doubles up the chrome and squeezes the editor pane.
	import { page } from '$app/stores';
	import RailPanel from './RailPanel.svelte';
	import RailMarkers from './RailMarkers.svelte';

	$: hide = $page.url.pathname.startsWith('/coach');
</script>

{#if !hide}
	<RailPanel />
	<RailMarkers />
{/if}
