// Coach status state machine, surfaced as a single writable store so a
// small indicator pill in the sidebar and an inline banner in the
// composer can both reflect the same truth.
//
// Transient states (ok / flagged / followed-up / blocked / error) flash
// briefly then settle back to idle; the caller passes no TTL — the store
// schedules a revert itself so callers stay dumb.

import { writable } from 'svelte/store';

export type CoachStatus =
	| 'off'
	| 'idle'
	| 'processing-pre'
	| 'processing-post'
	| 'ok'
	| 'flagged'
	| 'followed-up'
	| 'blocked'
	| 'error';

const FLASH_MS = 4000;

export const coachStatus = writable<CoachStatus>('off');

let revertTimer: ReturnType<typeof setTimeout> | null = null;

function cancelTimer() {
	if (revertTimer !== null) {
		clearTimeout(revertTimer);
		revertTimer = null;
	}
}

export function setCoachBaseState(state: 'off' | 'idle') {
	cancelTimer();
	coachStatus.set(state);
}

export function setCoachProcessing(phase: 'pre' | 'post') {
	cancelTimer();
	coachStatus.set(phase === 'pre' ? 'processing-pre' : 'processing-post');
}

export function flashCoachResult(
	state: 'ok' | 'flagged' | 'followed-up' | 'blocked' | 'error',
	// After the flash, return to this base state. Default 'idle' — the
	// caller should pass 'off' if the user disabled coach meanwhile.
	base: 'off' | 'idle' = 'idle',
	ms = FLASH_MS
) {
	cancelTimer();
	coachStatus.set(state);
	revertTimer = setTimeout(() => {
		coachStatus.set(base);
		revertTimer = null;
	}, ms);
}
