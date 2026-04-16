// Coach side-effect bootstrap.
//
// Imported once from src/routes/+layout.svelte (injection site #2). Here we:
// 1. Subscribe to the user store. When a verified user is present, fetch the
//    coach config + policies and populate the stores.
// 2. Register window event listeners that Chat.svelte dispatches when the
//    assistant stream finishes (Phase 4) — wiring lives there.
// 3. Mount the overlay (Phase 5) for chip/badge rendering on message DOM.
//
// We intentionally do NOT boot coach stores on the auth screen; waiting for
// $user to be non-null avoids unauthenticated 401s during first paint.

import { user } from '$lib/stores';
import * as api from './api';
import { coachConfig } from './stores/config';
import { coachPolicies } from './stores/policies';

let bootstrapped = false;

function getToken(): string | null {
	// Open WebUI stores the JWT in localStorage.token; this is the same
	// source every other feature uses (see $lib/apis/* modules).
	if (typeof localStorage === 'undefined') return null;
	return localStorage.token ?? null;
}

async function bootstrap() {
	if (bootstrapped) return;
	const token = getToken();
	if (!token) return;
	bootstrapped = true;
	try {
		const [cfg, pols] = await Promise.all([api.getCoachConfig(token), api.listCoachPolicies(token)]);
		coachConfig.set(cfg);
		coachPolicies.set(pols);
	} catch (err) {
		// Don't kill app init on coach bootstrap failure; log and leave stores empty.
		console.warn('[coach] bootstrap failed:', err);
		bootstrapped = false; // allow a retry when user changes
	}
}

// Re-evaluate on every user change. Tokens are in localStorage, keyed off
// the same login flow that updates `user`.
user.subscribe((u) => {
	if (u) {
		void bootstrap();
	}
});
