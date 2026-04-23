<script lang="ts">
	// Entry point for the "rail" variant: a persistent right-side panel plus
	// per-message numbered breadcrumbs. Mounted once by init.ts when the
	// active UI variant is 'rail'.
	import RailPanel from './RailPanel.svelte';
	import RailMarkers from './RailMarkers.svelte';
</script>

<RailPanel />
<RailMarkers />
