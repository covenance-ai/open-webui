// Mirror of the backend's in-memory /api/v1/coach/events log.
//
// Populated by init.ts: after every `coach:chat:finish` turn we refetch
// and push into this store so the CoachPanel's activity strip updates
// in place. The page load bootstrap also calls refreshCoachEvents().

import { writable } from 'svelte/store';
import { listCoachEvents } from '../api';
import type { CoachEvent } from '../types';

export const coachEvents = writable<CoachEvent[]>([]);

export async function refreshCoachEvents(token: string, limit = 50): Promise<void> {
	try {
		const events = await listCoachEvents(token, limit);
		coachEvents.set(events);
	} catch (err) {
		console.warn('[coach] refreshCoachEvents failed:', err);
	}
}
