// Per-message coach-approval store. Mirrors the shape of `coachFlags`:
// keyed by messageId, populated when coach reviews a turn and decides
// it's fine. Drives the green-shield BadgeOverlay.
//
// Two phases trigger an approval:
//   - 'pre'  → coach screened the user query and let it through.
//   - 'post' → coach reviewed the assistant reply and didn't flag it.
//
// We deliberately don't persist these into chat JSON: a green shield is
// a "we looked, all clear" signal that should reflect the *current*
// policy set, not stale judgements from when the chat was first sent.

import { writable } from 'svelte/store';

export interface CoachApproval {
	phase: 'pre' | 'post';
	policyCount: number;
	createdAt: number;
}

export const coachApprovals = writable<Record<string, CoachApproval>>({});

export function setApproval(messageId: string, approval: CoachApproval) {
	coachApprovals.update((m) => ({ ...m, [messageId]: approval }));
}

export function clearApproval(messageId: string) {
	coachApprovals.update((m) => {
		if (!(messageId in m)) return m;
		const next = { ...m };
		delete next[messageId];
		return next;
	});
}

// Test-only: wipe approvals between cases.
export function _resetCoachApprovalsForTests() {
	coachApprovals.set({});
}
