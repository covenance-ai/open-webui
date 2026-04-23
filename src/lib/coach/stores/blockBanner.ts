// Persistent "coach blocked your last message" banner state, per chat.
//
// When coach's pre-flight verdict is `block`, we capture enough info to
// render a prominent banner the employee cannot miss: the policy title,
// the rationale the coach produced, and — if the policy has one — a
// "read full explanation" URL (e.g. a Wikipedia article or an internal
// wiki page).
//
// Banner is per-chat so a block in conversation A doesn't spook the user
// while they work on conversation B. Persistence is in-memory: the
// banner is a here-and-now cue, not a long-term audit trail (the events
// log already plays that role).
//
// Contract:
//   setBlockBanner(chatId, info)   → show banner for chatId
//   clearBlockBanner(chatId)       → user dismissed, or new message sent

import { writable } from 'svelte/store';

export interface BlockBannerInfo {
	policyId: string | null;
	policyTitle: string | null;
	rationale: string;
	explanationUrl: string | null;
	// When it happened (ms epoch). Useful if we decide to auto-expire
	// banners after some duration.
	at: number;
}

export const blockBannerByChat = writable<Record<string, BlockBannerInfo>>({});

export function setBlockBanner(chatId: string, info: BlockBannerInfo): void {
	blockBannerByChat.update((m) => ({ ...m, [chatId]: info }));
}

export function clearBlockBanner(chatId: string): void {
	blockBannerByChat.update((m) => {
		if (!(chatId in m)) return m;
		const next = { ...m };
		delete next[chatId];
		return next;
	});
}

export function _resetBlockBannerForTests(): void {
	blockBannerByChat.set({});
}
