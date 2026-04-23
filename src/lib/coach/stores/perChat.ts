// Per-chat coach on/off override.
//
// The global `coachConfig.enabled` is the user-level default (shared
// across devices, persisted server-side). Per-chat override is a local
// tweak that answers "don't coach me on *this* conversation" (or the
// inverse: "coach me on this chat even though I generally leave it off").
//
// Semantics:
//   undefined  → follow global
//   true/false → explicit override for that chat
//
// Stored in localStorage so it survives reloads; keyed by chatId so it
// can't accidentally apply to a different chat. Not synced across
// devices on purpose — this is a moment-to-moment user choice, not a
// setting worth a round-trip.

import { writable } from 'svelte/store';

const STORAGE_KEY = 'coach_per_chat_enabled';

type Overrides = Record<string, boolean>;

function load(): Overrides {
	// Wrapped in try/catch because some environments (vitest jsdom,
	// Safari private mode) throw on localStorage access. Fail to empty.
	try {
		const raw = localStorage?.getItem?.(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			const out: Overrides = {};
			for (const [k, v] of Object.entries(parsed)) {
				if (typeof v === 'boolean') out[k] = v;
			}
			return out;
		}
	} catch {
		// fall through
	}
	return {};
}

function persist(o: Overrides): void {
	try {
		localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(o));
	} catch {
		// private mode / quota / jsdom — ignore
	}
}

export const coachPerChatEnabled = writable<Overrides>(load());

coachPerChatEnabled.subscribe(persist);

/**
 * Set or clear the per-chat override. Pass `null` to "follow global".
 * Passing the same value as global is stored as an explicit override on
 * purpose — so if the global flips later, this chat keeps its intent.
 * Callers who want "reset to default" should pass null.
 */
export function setCoachForChat(chatId: string, enabled: boolean | null): void {
	coachPerChatEnabled.update((o) => {
		const next = { ...o };
		if (enabled === null) {
			delete next[chatId];
		} else {
			next[chatId] = enabled;
		}
		return next;
	});
}

/**
 * Effective on/off for a chat: per-chat override if set, else global.
 * `chatId` null (no active chat) returns global — we can't override
 * something that doesn't exist yet.
 */
export function isCoachEnabledForChat(
	chatId: string | null,
	globalEnabled: boolean,
	overrides: Overrides
): boolean {
	if (!chatId) return globalEnabled;
	const o = overrides[chatId];
	return typeof o === 'boolean' ? o : globalEnabled;
}

// Test-only reset.
export function _resetPerChatForTests(): void {
	coachPerChatEnabled.set({});
}
