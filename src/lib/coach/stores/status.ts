// Coach status state machine — keyed by chatId.
//
// Each chat session has its own life-cycle (pre-flight screening → assistant
// reply → post-flight review), so a single global status pill would
// constantly thrash whenever the user has more than one chat open or
// switches tabs mid-evaluation. We instead keep a map of `chatId → status`
// plus a global base state ('off' / 'idle') for the on/off switch.
//
// Indicators read either:
//   - their chat's status from the map, or
//   - the global base state when there's no chat-scoped entry.
//
// Transient states (ok / flagged / followed-up / blocked / error) flash
// briefly then drop out of the map; processing states stay until the next
// flash overwrites them.

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

// Global base state — driven by the on/off toggle.
export const coachBaseState = writable<'off' | 'idle'>('off');

// Per-chat status map. Chats with no entry inherit the base state.
export const coachStatusByChat = writable<Record<string, CoachStatus>>({});

// Track the most-recently-touched chat so global indicators (the sidebar
// pill) can show meaningful activity even when the user is on the splash
// page or navigated away from the chat that's still being evaluated.
export const lastActiveChatId = writable<string | null>(null);

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
	lastActiveChatId.set(chatId);
}

function dropChatStatus(chatId: string) {
	coachStatusByChat.update((m) => {
		if (!(chatId in m)) return m;
		const next = { ...m };
		delete next[chatId];
		return next;
	});
}

export function setCoachBaseState(state: 'off' | 'idle') {
	coachBaseState.set(state);
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
