// Per-message coach state store. Keyed by messageId, drives the chip
// overlay (BadgeOverlay). States:
//   - 'reviewing-pre'  → coach is screening the user query right now
//   - 'reviewing-post' → coach is reviewing the assistant reply right now
//   - 'approved'       → coach looked and found nothing to flag
//
// Flags (critical / warn) live in the separate coachFlags store so the
// severity styling stays centralized there. This store covers only the
// benign path: we were looking, we're done, all clear.

import { writable } from 'svelte/store';

export type CoachApprovalKind = 'reviewing-pre' | 'reviewing-post' | 'approved';

export interface CoachApproval {
	kind: CoachApprovalKind;
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
