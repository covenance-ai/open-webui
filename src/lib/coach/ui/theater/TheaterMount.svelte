<script lang="ts">
	// Entry point for the "theater" variant: a floating anthropomorphic
	// persona that reacts to chat status, plus side "whisper" bubbles
	// attached to flagged messages. Mounted once by init.ts when the
	// active UI variant is 'theater'.
	import CoachAvatar from './CoachAvatar.svelte';
	import CoachWhispers from './CoachWhispers.svelte';
</script>

<CoachAvatar />
<CoachWhispers />
