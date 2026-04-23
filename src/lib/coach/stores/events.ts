// Mirror of the backend's in-memory /api/v1/coach/events log.
//
// Populated by init.ts: after every `coach:chat:finish` turn we refetch
// and push into this store so the CoachPanel's activity strip updates
// in place. The page load bootstrap also calls refreshCoachEvents().
//
// The backend log is volatile (in-memory; resets on container restart),
// so per-chat events are also persisted into history.coach_events and
// hydrated on chat load via coachHydrateFromHistory. That means the
// store can carry events the backend no longer knows about, so we
// MERGE on refresh (by id) rather than replacing — otherwise a refresh
// would wipe out persisted-only events.

import { writable } from 'svelte/store';
import { listCoachEvents } from '../api';
import type { CoachEvent } from '../types';

export const coachEvents = writable<CoachEvent[]>([]);

export async function refreshCoachEvents(token: string, limit = 50): Promise<void> {
	try {
		const fresh = await listCoachEvents(token, limit);
		coachEvents.update((existing) => {
			const seen = new Set(existing.map((e) => e.id));
			const merged = [...existing];
			for (const e of fresh) if (!seen.has(e.id)) merged.push(e);
			merged.sort((a, b) => (b.ts_ms ?? 0) - (a.ts_ms ?? 0));
			return merged;
		});
	} catch (err) {
		console.warn('[coach] refreshCoachEvents failed:', err);
	}
}
