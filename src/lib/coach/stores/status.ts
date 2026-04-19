// Coach status — keyed by chatId. There is no global truth: every coach
// run belongs to a specific conversation, so a single global pill would
// constantly thrash whenever there's more than one chat active.
//
// Components read either:
//   - their chat's status from the map (transient, dropped after FLASH_MS),
//   - or nothing (no entry → no pill).
//
// On/off is *not* a status — it's a config concern (cfg.enabled), already
// surfaced by the Switch in CoachPanel. Indicators that want to render
// "coach is off" should consult the config store, not this one.

import { writable } from 'svelte/store';

export type CoachStatus =
	| 'processing-pre'
	| 'processing-post'
	| 'ok'
	| 'flagged'
	| 'followed-up'
	| 'blocked'
	| 'error';

const FLASH_MS = 4000;

// Per-chat status map. Chats with no entry have nothing happening.
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
