import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import {
	FLASH_MS,
	_resetCoachStatusForTests,
	coachStatusByChat,
	flashCoachResult,
	setCoachProcessing
} from './status';

beforeEach(() => {
	vi.useFakeTimers();
	_resetCoachStatusForTests();
});

afterEach(() => {
	_resetCoachStatusForTests();
	vi.useRealTimers();
});

describe('coach status store', () => {
	it('starts empty', () => {
		expect(get(coachStatusByChat)).toEqual({});
	});

	it('setCoachProcessing writes the per-chat phase', () => {
		setCoachProcessing('pre', 'chat-A');
		expect(get(coachStatusByChat)).toEqual({ 'chat-A': 'processing-pre' });

		setCoachProcessing('post', 'chat-A');
		expect(get(coachStatusByChat)).toEqual({ 'chat-A': 'processing-post' });
	});

	it('setCoachProcessing is a no-op without a chatId — no global slot', () => {
		setCoachProcessing('pre', null);
		expect(get(coachStatusByChat)).toEqual({});
	});

	it('multiple chats keep independent state — no clobbering', () => {
		setCoachProcessing('pre', 'chat-A');
		setCoachProcessing('post', 'chat-B');
		expect(get(coachStatusByChat)).toEqual({
			'chat-A': 'processing-pre',
			'chat-B': 'processing-post'
		});
	});

	it('flashCoachResult sets the state and auto-clears after FLASH_MS', () => {
		flashCoachResult('flagged', 'chat-A');
		expect(get(coachStatusByChat)['chat-A']).toBe('flagged');

		vi.advanceTimersByTime(FLASH_MS - 1);
		expect(get(coachStatusByChat)['chat-A']).toBe('flagged');

		vi.advanceTimersByTime(1);
		expect(get(coachStatusByChat)['chat-A']).toBeUndefined();
	});

	it('a fresh flash supersedes the prior one and resets the timer', () => {
		flashCoachResult('ok', 'chat-A');
		vi.advanceTimersByTime(FLASH_MS - 1);

		// new flash arrives just before the old one would clear; the new
		// state must persist a full FLASH_MS, not get yanked at +1ms.
		flashCoachResult('flagged', 'chat-A');
		vi.advanceTimersByTime(2);
		expect(get(coachStatusByChat)['chat-A']).toBe('flagged');

		vi.advanceTimersByTime(FLASH_MS);
		expect(get(coachStatusByChat)['chat-A']).toBeUndefined();
	});

	it('processing → flash → empty round-trips the same chat correctly', () => {
		setCoachProcessing('pre', 'chat-A');
		expect(get(coachStatusByChat)['chat-A']).toBe('processing-pre');

		flashCoachResult('blocked', 'chat-A');
		expect(get(coachStatusByChat)['chat-A']).toBe('blocked');

		vi.advanceTimersByTime(FLASH_MS);
		expect(get(coachStatusByChat)['chat-A']).toBeUndefined();
	});

	it('flash on one chat does not erase processing state on another', () => {
		setCoachProcessing('post', 'chat-A');
		flashCoachResult('flagged', 'chat-B');

		expect(get(coachStatusByChat)).toEqual({
			'chat-A': 'processing-post',
			'chat-B': 'flagged'
		});

		vi.advanceTimersByTime(FLASH_MS);
		expect(get(coachStatusByChat)).toEqual({ 'chat-A': 'processing-post' });
	});
});
