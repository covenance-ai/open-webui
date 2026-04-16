// CoachConfig store. Loaded once from /api/v1/coach/config on app mount;
// updated after every POST to the same endpoint.

import { writable } from 'svelte/store';
import type { CoachConfig } from '../types';

export const coachConfig = writable<CoachConfig | null>(null);
