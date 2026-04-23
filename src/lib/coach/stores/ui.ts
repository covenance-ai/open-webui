// Coach UI variant — which visual skin is active.
//
// The data layer (flags, approvals, status, config, policies, events) is
// invariant. Only the presentation changes between variants. Store is
// localStorage-backed so a reload keeps the user's choice; the key lives
// outside upstream's settings so a fresh install defaults cleanly.
//
// Adding a variant: extend CoachUIVariant, teach init.ts's mountForVariant
// to build it, and add an option in CoachPanel's selector.

import { writable } from 'svelte/store';

export const COACH_UI_VARIANTS = ['chips', 'rail', 'theater'] as const;
export type CoachUIVariant = (typeof COACH_UI_VARIANTS)[number];
export const DEFAULT_COACH_UI_VARIANT: CoachUIVariant = 'chips';

const STORAGE_KEY = 'coach_ui_variant';

function readInitial(): CoachUIVariant {
	// Wrapped in try/catch because some environments (vitest jsdom, private
	// browsing) expose localStorage but throw on access. We fall back to
	// the default silently.
	try {
		const raw = localStorage?.getItem?.(STORAGE_KEY);
		return (COACH_UI_VARIANTS as readonly string[]).includes(raw ?? '')
			? (raw as CoachUIVariant)
			: DEFAULT_COACH_UI_VARIANT;
	} catch {
		return DEFAULT_COACH_UI_VARIANT;
	}
}

export const coachUIVariant = writable<CoachUIVariant>(readInitial());

coachUIVariant.subscribe((v) => {
	try {
		localStorage?.setItem?.(STORAGE_KEY, v);
	} catch {
		// private mode / quota / jsdom — ignore
	}
});

export function setCoachUIVariant(v: CoachUIVariant) {
	coachUIVariant.set(v);
}
