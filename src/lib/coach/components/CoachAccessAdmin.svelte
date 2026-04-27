<script lang="ts">
	// Admin-only widget: enable/disable coach functionality per user.
	//
	// Renders inside CoachPanel for admins. List + per-row toggle hits the
	// /api/v1/coach/admin/users endpoints, which 403 for non-admins —
	// so the UI guard is just for ergonomics, not a security boundary.

	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import Switch from '$lib/components/common/Switch.svelte';
	import * as api from '../api';
	import type { CoachAdminUserAccessRow } from '../types';

	export let token: string;
	// Used to grey-out the admin's own row — admins don't need to toggle
	// themselves and we want the standard "you can't lock yourself out"
	// affordance even though the backend would happily honour it.
	export let selfUserId: string | null = null;

	let rows: CoachAdminUserAccessRow[] = [];
	let loading = false;
	let loaded = false;
	let pending = new Set<string>();

	async function load() {
		if (!token) return;
		loading = true;
		try {
			rows = await api.adminListCoachUserAccess(token);
			loaded = true;
		} catch (err) {
			toast.error(`Coach: ${(err as Error).message}`);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
	});

	async function toggle(row: CoachAdminUserAccessRow, next: boolean) {
		if (pending.has(row.user_id)) return;
		pending = new Set([...pending, row.user_id]);
		// Optimistic flip — restore on error.
		const prev = row.access_enabled;
		rows = rows.map((r) =>
			r.user_id === row.user_id ? { ...r, access_enabled: next } : r
		);
		try {
			const updated = await api.adminSetCoachUserAccess(token, row.user_id, next);
			rows = rows.map((r) => (r.user_id === updated.user_id ? updated : r));
		} catch (err) {
			rows = rows.map((r) =>
				r.user_id === row.user_id ? { ...r, access_enabled: prev } : r
			);
			toast.error(`Coach: ${(err as Error).message}`);
		} finally {
			const copy = new Set(pending);
			copy.delete(row.user_id);
			pending = copy;
		}
	}

	$: enabledCount = rows.filter((r) => r.access_enabled).length;
</script>

<div class="flex flex-col gap-2 text-xs">
	<div class="flex items-center justify-between">
		<div class="text-gray-500 dark:text-gray-400">
			{#if loaded}
				{enabledCount} / {rows.length} users with coach access
			{:else if loading}
				Loading users…
			{:else}
				—
			{/if}
		</div>
		<button
			type="button"
			class="text-[11px] hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-50"
			on:click={load}
			disabled={loading}
		>
			refresh
		</button>
	</div>

	{#if loaded && rows.length === 0}
		<div class="italic text-gray-400 dark:text-gray-500">No users found.</div>
	{:else if rows.length > 0}
		<ul class="flex flex-col gap-1 max-h-72 overflow-y-auto pr-1">
			{#each rows as row (row.user_id)}
				<li
					class="flex items-center justify-between gap-2 px-1.5 py-1 rounded-md hover:bg-gray-50 dark:hover:bg-gray-850/50"
				>
					<div class="flex flex-col min-w-0 flex-1">
						<span class="truncate text-gray-700 dark:text-gray-200">
							{row.name || row.email}
						</span>
						<span class="truncate text-[10px] text-gray-400 dark:text-gray-500">
							{row.email} · {row.role}
						</span>
					</div>
					<Switch
						state={row.access_enabled}
						on:change={(e) => toggle(row, e.detail)}
						tooltip={row.access_enabled ? 'Coach enabled' : 'Coach disabled'}
					/>
				</li>
			{/each}
		</ul>
	{/if}
</div>
