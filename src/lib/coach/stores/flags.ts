// Transient in-memory flag store, keyed by assistant message id.
// Phase 4 renders flags in-memory only (lost on reload). Phase 5 persists
// them into chat.chat.history.messages[id].coach; this store then mirrors
// what's in the chat JSON so the overlay can react to either source.

import { writable } from 'svelte/store';

export interface CoachFlag {
	severity: 'info' | 'warn' | 'critical';
	rationale: string;
	policyId: string | null;
	createdAt: number;
}

export const coachFlags = writable<Record<string, CoachFlag>>({});

export function setFlag(messageId: string, flag: CoachFlag) {
	coachFlags.update((m) => ({ ...m, [messageId]: flag }));
}

export function clearFlag(messageId: string) {
	coachFlags.update((m) => {
		const next = { ...m };
		delete next[messageId];
		return next;
	});
}
