// Policies store. Holds the union of personal + shared policies visible
// to the current user. Split into derived stores for the UI.

import { derived, writable } from 'svelte/store';
import type { CoachPolicy } from '../types';

export const coachPolicies = writable<CoachPolicy[]>([]);

export const sharedPolicies = derived(coachPolicies, ($p) => $p.filter((p) => p.is_shared));

export const personalPolicies = derived(coachPolicies, ($p) => $p.filter((p) => !p.is_shared));
