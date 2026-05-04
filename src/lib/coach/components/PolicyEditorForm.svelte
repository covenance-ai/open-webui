<script lang="ts">
	// Form-only policy editor — no Modal wrapper. Used by:
	//   - PolicyEditor.svelte (rail's compact modal — narrow textarea)
	//   - /coach route page (full-width inline editor — tall textarea)
	//
	// The split exists because the modal version is too cramped for real
	// policy authoring (the user said: "when creating policies I need
	// more space than the side panel allows"). Both surfaces share the
	// same field set + validation so behaviour stays consistent.

	import { createEventDispatcher } from 'svelte';
	import { KIND_META } from '../kindMeta';
	import { POLICY_KINDS, type CoachPolicy, type PolicyKind } from '../types';

	export let policy: CoachPolicy | null = null;
	// Compact: rail/modal use case. Roomy: dedicated /coach page.
	export let compact = false;
	export let saving = false;
	// When creating a new policy from a kind-specific entrypoint (e.g.
	// the /coach demo card's "+ Author one" button), pre-select the kind
	// without pretending the policy exists. Ignored on edit.
	export let defaultKind: PolicyKind = 'flag';

	$: isNew = policy === null;

	let title = policy?.title ?? '';
	let body = policy?.body ?? '';
	// Default kind for new policies = caller-supplied or 'flag' (least-
	// surprising / least-invasive). Edit kind = the policy's own kind.
	let kind: PolicyKind = (policy?.kind as PolicyKind) ?? defaultKind;

	// Re-seed when the parent swaps the policy (e.g. user edits a different
	// one). Tracks identity, not deep equality, so in-progress edits to the
	// SAME policy aren't clobbered by store updates. ``defaultKind`` is
	// captured into ``kind`` only at re-seed time; later changes to the
	// prop don't clobber a user's in-progress kind selection.
	let lastPolicyId: string | null | undefined;
	$: if ((policy?.id ?? null) !== lastPolicyId) {
		lastPolicyId = policy?.id ?? null;
		title = policy?.title ?? '';
		body = policy?.body ?? '';
		kind = (policy?.kind as PolicyKind) ?? defaultKind;
	}

	const dispatch = createEventDispatcher<{
		save: { id: string | null; title: string; body: string; kind: PolicyKind };
		cancel: void;
	}>();

	$: canSave = title.trim().length > 0 && body.trim().length > 0;

	function save() {
		if (!canSave) return;
		dispatch('save', {
			id: policy?.id ?? null,
			title: title.trim(),
			body: body.trim(),
			kind
		});
	}
</script>

<div class="flex flex-col gap-3 {compact ? '' : 'h-full'}">
	<div class="text-base font-medium text-gray-800 dark:text-gray-100">
		{isNew ? 'New policy' : 'Edit policy'}
	</div>

	<!-- Kind picker: three radio cards laid out as a single row.
	     This is the 'family' question for each policy — pick before
	     writing the body so the rest of the form is framed by intent.
	     On compact (rail modal) we collapse to a horizontal pill row. -->
	<fieldset class="flex flex-col gap-1.5">
		<legend class="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
			What should this policy do when it fires?
		</legend>
		<div class="grid grid-cols-3 gap-2 {compact ? 'gap-1.5' : ''}">
			{#each POLICY_KINDS as k}
				{@const meta = KIND_META[k]}
				<label
					class="flex flex-col gap-0.5 px-2.5 py-2 rounded-lg border cursor-pointer text-left transition
						{kind === k
							? `${meta.cardBg} ${meta.cardBorder} ${meta.cardAccent}`
							: 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}"
				>
					<input
						type="radio"
						bind:group={kind}
						value={k}
						class="sr-only"
						disabled={saving}
					/>
					<span class="flex items-center gap-1.5 text-sm font-medium">
						<span aria-hidden="true">{meta.icon}</span>
						<span>{meta.label}</span>
					</span>
					<span
						class="text-[10.5px] leading-tight {kind === k
							? meta.cardAccent
							: 'text-gray-500 dark:text-gray-400'}"
					>
						{meta.tagline}
					</span>
				</label>
			{/each}
		</div>
		{#if !compact}
			<p class="text-[11px] text-gray-500 dark:text-gray-400 leading-snug pt-0.5">
				{KIND_META[kind].when}
			</p>
		{/if}
	</fieldset>

	<label class="flex flex-col gap-1">
		<span class="text-xs text-gray-500 dark:text-gray-400">Title</span>
		<input
			type="text"
			bind:value={title}
			placeholder="e.g. Stay factual; cite sources"
			maxlength="200"
			disabled={saving}
			class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
		/>
	</label>

	<label class="flex flex-col gap-1 {compact ? '' : 'flex-1 min-h-0'}">
		<span class="text-xs text-gray-500 dark:text-gray-400">
			Policy prompt
			<span class="text-[10px] text-gray-400 dark:text-gray-500">
				· plain language; the coach reads this verbatim
			</span>
		</span>
		<textarea
			bind:value={body}
			rows={compact ? 6 : 22}
			placeholder="Describe what the coach should check for. Specific examples — both passing and failing — make verdicts more reliable."
			maxlength="5000"
			disabled={saving}
			class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent outline-none focus:ring-1 focus:ring-emerald-500 resize-y font-mono text-sm leading-relaxed disabled:opacity-50 {compact
				? ''
				: 'flex-1 min-h-[20rem]'}"
		></textarea>
		<span class="text-[10px] text-gray-400 dark:text-gray-500 self-end">
			{body.length} / 5000
		</span>
	</label>

	<div class="flex justify-end gap-2 pt-1">
		<button
			type="button"
			class="px-3 py-1.5 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
			on:click={() => dispatch('cancel')}
			disabled={saving}
		>
			Cancel
		</button>
		<button
			type="button"
			disabled={!canSave || saving}
			class="px-3 py-1.5 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
			on:click={save}
		>
			{saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
		</button>
	</div>
</div>
