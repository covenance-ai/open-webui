// Coach status — keyed by chatId. There is no global truth: every coach
// run belongs to a specific conversation, so a single global pill would
// constantly thrash whenever there's more than one chat active.
//
// 'idle' is intentionally NOT in this map; it's the implicit absence of
// any chat-scoped event. Indicators that want to render "coach is on but
// nothing's happening" should compose this with `coachConfig.enabled`.
//
// Transient states (ok / flagged / followed-up / blocked / error) flash
// briefly then drop out; processing states stay until overwritten.

import { writable } from 'svelte/store';

export type CoachStatus =
	| 'processing-pre'
	| 'processing-post'
	| 'ok'
	| 'flagged'
	| 'followed-up'
	| 'blocked'
	| 'error';

export const FLASH_MS = 4000;

export const coachStatusByChat = writable<Record<string, CoachStatus>>({});

const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearFlashTimer(key: string) {
	const t = flashTimers.get(key);
	if (t !== undefined) {
		clearTimeout(t);
		flashTimers.delete(key);
	}
}

function writeChatStatus(chatId: string, status: CoachStatus) {
	coachStatusByChat.update((m) => ({ ...m, [chatId]: status }));
}

function dropChatStatus(chatId: string) {
	coachStatusByChat.update((m) => {
		if (!(chatId in m)) return m;
		const next = { ...m };
		delete next[chatId];
		return next;
	});
}

export function setCoachProcessing(phase: 'pre' | 'post', chatId: string | null) {
	if (!chatId) return;
	clearFlashTimer(chatId);
	writeChatStatus(chatId, phase === 'pre' ? 'processing-pre' : 'processing-post');
}

export function flashCoachResult(
	state: 'ok' | 'flagged' | 'followed-up' | 'blocked' | 'error',
	chatId: string | null,
	ms = FLASH_MS
) {
	if (!chatId) return;
	clearFlashTimer(chatId);
	writeChatStatus(chatId, state);
	const t = setTimeout(() => {
		dropChatStatus(chatId);
		flashTimers.delete(chatId);
	}, ms);
	flashTimers.set(chatId, t);
}

// Test-only helper. Cancels every pending flash timer and clears the map
// so tests can assert end-state without waiting on FLASH_MS or leaking
// timers across cases. Production callers must not use this.
export function _resetCoachStatusForTests() {
	for (const t of flashTimers.values()) clearTimeout(t);
	flashTimers.clear();
	coachStatusByChat.set({});
}
