<script lang="ts">
	// In-thread card rendered in place of the LLM reply when coach blocks
	// a user's query. Reads a self-sufficient snapshot from message.coach
	// (see init.ts → coachAppendBlockMessage), so it renders the same after
	// a reload even if the policy was later edited or deleted.
	//
	// Previously this was assembled as an inline-HTML blob returned from
	// composeCoachBlockMarkdown() and stuffed into message.content; the
	// marked → Svelte pipeline escaped the HTML, and users saw the raw
	// <div style="..."> tags. Rendering as a real Svelte component with
	// scoped CSS sidesteps that entirely.

	import { coachPolicies } from '../stores/policies';

	export let message: {
		coach?: {
			type?: string;
			policy_id?: string | null;
			policy_title?: string | null;
			policy_body?: string | null;
			policy_explanation_url?: string | null;
			rationale?: string | null;
		};
	} | null = null;

	$: coach = message?.coach ?? {};

	// Fall back to the live policies store if an older persisted message
	// lacks the snapshot fields — keeps backward compat with anything
	// stored before we started embedding the snapshot.
	$: livePolicy = coach.policy_id
		? ($coachPolicies ?? []).find((p) => p.id === coach.policy_id) ?? null
		: null;

	$: title = coach.policy_title ?? livePolicy?.title ?? 'Policy violation';
	$: body = coach.policy_body ?? livePolicy?.body ?? '';
	$: url = coach.policy_explanation_url ?? livePolicy?.explanation_url ?? null;
	$: rationale = (coach.rationale ?? '').trim();

	let bodyOpen = false;
</script>

<article class="coach-block" role="note" aria-label="Coach blocked this request">
	<header class="head">
		<span class="sigil" aria-hidden="true">⛔</span>
		<span class="kicker">Coach blocked this request</span>
	</header>

	<h3 class="title">{title}</h3>

	{#if rationale}
		<blockquote class="rationale">{rationale}</blockquote>
	{/if}

	{#if body}
		<details class="body" bind:open={bodyOpen}>
			<summary>{bodyOpen ? 'Hide' : 'Show'} full policy text</summary>
			<div class="body-inner">{body}</div>
		</details>
	{/if}

	{#if url}
		<a class="cta" href={url} target="_blank" rel="noopener noreferrer">
			Read full explanation
			<span aria-hidden="true">↗</span>
		</a>
	{/if}

	<p class="footnote">
		Written by the policy coach — the LLM never saw this request. Rephrase
		or take the task outside the assistant.
	</p>
</article>

<style>
	.coach-block {
		position: relative;
		margin: 6px 0 14px;
		padding: 14px 16px 14px 18px;
		border-radius: 12px;
		border: 1px solid rgba(220, 38, 38, 0.25);
		border-left: 4px solid rgb(220, 38, 38);
		background: linear-gradient(
			180deg,
			rgba(254, 226, 226, 0.6),
			rgba(254, 226, 226, 0.15)
		);
		color: rgb(127, 29, 29);
		font-family: ui-sans-serif, system-ui, sans-serif;
	}
	:global(.dark) .coach-block {
		border-color: rgba(248, 113, 113, 0.28);
		border-left-color: rgb(239, 68, 68);
		background: linear-gradient(
			180deg,
			rgba(69, 10, 10, 0.55),
			rgba(69, 10, 10, 0.2)
		);
		color: rgb(252, 165, 165);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.85;
		margin-bottom: 6px;
	}
	.sigil {
		font-size: 14px;
		line-height: 1;
	}

	.title {
		margin: 0 0 10px;
		font-size: 17px;
		font-weight: 700;
		line-height: 1.3;
	}

	.rationale {
		margin: 0 0 10px;
		padding: 8px 12px;
		border-left: 3px solid rgba(185, 28, 28, 0.45);
		background: rgba(255, 255, 255, 0.5);
		font-style: italic;
		line-height: 1.5;
		border-radius: 0 8px 8px 0;
	}
	:global(.dark) .rationale {
		border-left-color: rgba(248, 113, 113, 0.55);
		background: rgba(0, 0, 0, 0.25);
	}

	.body {
		margin: 0 0 10px;
		font-size: 13px;
	}
	.body > summary {
		cursor: pointer;
		opacity: 0.7;
		font-size: 12px;
		user-select: none;
	}
	.body > summary:hover {
		opacity: 1;
	}
	.body-inner {
		margin-top: 6px;
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.cta {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		border-radius: 9999px;
		background: rgb(220, 38, 38);
		color: #fff;
		font-size: 13px;
		font-weight: 600;
		text-decoration: none;
		transition: background 0.15s ease;
	}
	.cta:hover {
		background: rgb(185, 28, 28);
	}

	.footnote {
		margin: 10px 0 0;
		font-size: 11px;
		opacity: 0.6;
		line-height: 1.4;
	}
</style>
