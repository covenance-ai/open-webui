// Pure-logic tests for the coach helpers exposed to Chat.svelte.
// We don't mount components or hit the network here — just exercise
// composeCoachBlockFallback and coachInsertBlockExchange against
// representative inputs to catch shape regressions.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { get } from 'svelte/store';

import { _resetCoachApprovalsForTests, coachApprovals } from './stores/approvals';
import { coachEvents } from './stores/events';
import { coachFlags } from './stores/flags';
import { coachPolicies } from './stores/policies';
import {
	coachAppendBlockMessage,
	coachBackfillChatId,
	coachHydrateFromHistory,
	composeCoachBlockFallback,
	markCoachApprovedPre,
	type PreflightBlockDetail
} from './init';

const HIRING_POLICY = {
	id: 'pol-hiring',
	user_id: null,
	is_shared: true,
	title: 'No LLM for hiring decisions',
	body: 'No hiring use. EU AI Act Annex III: high-risk.',
	created_at: 0,
	updated_at: 0
};

beforeEach(() => {
	coachPolicies.set([HIRING_POLICY]);
	_resetCoachApprovalsForTests();
	coachFlags.set({});
	coachEvents.set([]);
});

afterEach(() => {
	coachPolicies.set([]);
	_resetCoachApprovalsForTests();
	coachFlags.set({});
	coachEvents.set([]);
});

describe('composeCoachBlockFallback', () => {
	// The fallback is plain markdown meant for exports and non-custom
	// viewers. The primary rendering lives in CoachBlockMessage.svelte
	// and reads the structured snapshot from message.coach — so the
	// fallback intentionally only carries the headline, rationale, and
	// link (not the full policy body, which would bloat the stored
	// message.content).
	it('includes the policy title and rationale when policy is known', () => {
		const md = composeCoachBlockFallback({
			policy_id: 'pol-hiring',
			rationale: 'You asked who to hire.'
		});
		expect(md).toContain('Coach blocked this request');
		expect(md).toContain('No LLM for hiring decisions');
		expect(md).toContain('You asked who to hire.');
	});

	it('still produces something readable when the policy id is unknown', () => {
		const md = composeCoachBlockFallback({
			policy_id: 'no-such-policy',
			rationale: 'redacted'
		});
		expect(md).toContain('Coach blocked this request');
		expect(md).toContain('redacted');
	});

	it('omits the rationale block when no rationale was given', () => {
		const md = composeCoachBlockFallback({ policy_id: 'pol-hiring', rationale: null });
		expect(md).toContain('No LLM for hiring decisions');
		expect(md).not.toMatch(/> /);
	});
});

describe('coachAppendBlockMessage', () => {
	const verdict: PreflightBlockDetail = {
		policy_id: 'pol-hiring',
		rationale: 'overt hiring decision'
	};

	it('appends a coach assistant msg as child of the given user msg', () => {
		const userMessageId = 'user-1';
		const history = {
			messages: {
				[userMessageId]: {
					id: userMessageId,
					role: 'user',
					content: 'Who should I hire?',
					parentId: null,
					childrenIds: []
				}
			},
			currentId: userMessageId
		} as never;

		const { coachMessageId } = coachAppendBlockMessage(history, userMessageId, verdict);

		const h = history as { messages: Record<string, any>; currentId: string | null };
		expect(h.currentId).toBe(coachMessageId);

		const coachMsg = h.messages[coachMessageId];
		expect(coachMsg.role).toBe('assistant');
		expect(coachMsg.parentId).toBe(userMessageId);
		expect(coachMsg.coachAuthored).toBe(true);
		expect(coachMsg.coach_authored).toBe(true);
		expect(coachMsg.done).toBe(true);
		expect(coachMsg.coach.type).toBe('block');
		expect(coachMsg.content).toContain('Coach blocked');
		expect(coachMsg.content).toContain('No LLM for hiring decisions');

		// User message gets the coach reply added as a sibling branch.
		expect(h.messages[userMessageId].childrenIds).toContain(coachMessageId);
	});

	it('snapshots the policy title, body, and explanation url onto message.coach', () => {
		// The snapshot is what CoachBlockMessage.svelte renders from, so a
		// block message stays correct even if the policy is later edited
		// or deleted — the same property we rely on for assistant replies.
		const policyWithUrl = {
			...HIRING_POLICY,
			explanation_url: 'https://example.com/policy'
		};
		coachPolicies.set([policyWithUrl]);

		const history = {
			messages: {
				'u1': { id: 'u1', role: 'user', content: 'q', parentId: null, childrenIds: [] }
			},
			currentId: 'u1'
		} as never;
		const { coachMessageId } = coachAppendBlockMessage(history, 'u1', verdict);

		const coachMsg = (history as any).messages[coachMessageId];
		expect(coachMsg.coach.policy_title).toBe('No LLM for hiring decisions');
		expect(coachMsg.coach.policy_body).toContain('EU AI Act');
		expect(coachMsg.coach.policy_explanation_url).toBe('https://example.com/policy');
		expect(coachMsg.coach.created_at).toBeGreaterThan(0);
	});

	it('preserves existing siblings on the user message', () => {
		const userMessageId = 'user-1';
		const history = {
			messages: {
				[userMessageId]: {
					id: userMessageId,
					role: 'user',
					content: 'hey',
					parentId: null,
					childrenIds: ['prior-assistant']
				},
				'prior-assistant': {
					id: 'prior-assistant',
					role: 'assistant',
					content: 'earlier',
					parentId: userMessageId,
					childrenIds: []
				}
			},
			currentId: userMessageId
		} as never;

		const { coachMessageId } = coachAppendBlockMessage(history, userMessageId, verdict);

		const h = history as { messages: Record<string, any>; currentId: string | null };
		expect(h.messages[userMessageId].childrenIds).toEqual(['prior-assistant', coachMessageId]);
	});
});

describe('markCoachApprovedPre', () => {
	it('writes the approval onto history.messages[id].coach for later persistence', () => {
		const history = {
			messages: {
				'msg-1': { id: 'msg-1', role: 'user', content: 'hi', parentId: null, childrenIds: [] }
			},
			currentId: 'msg-1'
		} as never;
		markCoachApprovedPre('msg-1', history);
		const h = history as { messages: Record<string, any> };
		expect(h.messages['msg-1'].coach).toBeDefined();
		expect(h.messages['msg-1'].coach.type).toBe('approved');
		expect(h.messages['msg-1'].coach.phase).toBe('pre');
		// Store also updated.
		expect(get(coachApprovals)['msg-1'].kind).toBe('approved');
	});

	it('skips history mutation when message is unknown — still updates the store', () => {
		const history = { messages: {}, currentId: null } as never;
		markCoachApprovedPre('msg-missing', history);
		expect(get(coachApprovals)['msg-missing'].kind).toBe('approved');
	});
});

describe('coachHydrateFromHistory', () => {
	it('rebuilds coachApprovals from history.messages[id].coach entries', () => {
		const history = {
			messages: {
				'user-1': {
					role: 'user',
					content: 'hi',
					coach: { type: 'approved', phase: 'pre', policy_count: 2, created_at: 1000 }
				},
				'asst-1': {
					role: 'assistant',
					content: 'ok',
					coach: { type: 'approved', phase: 'post', policy_count: 2, created_at: 1001 }
				}
			},
			currentId: 'asst-1'
		} as never;

		coachHydrateFromHistory(history);
		const approvals = get(coachApprovals);
		expect(approvals['user-1'].phase).toBe('pre');
		expect(approvals['asst-1'].phase).toBe('post');
		expect(approvals['user-1'].kind).toBe('approved');
	});

	it('rebuilds coachFlags from type=flag entries (and legacy no-type rows)', () => {
		const history = {
			messages: {
				'asst-typed': {
					role: 'assistant',
					content: 'reply',
					coach: { type: 'flag', severity: 'warn', rationale: 'r', policy_id: 'p1' }
				},
				'asst-legacy': {
					role: 'assistant',
					content: 'reply',
					// No `type` — old rows written before the field existed.
					coach: { severity: 'critical', rationale: 'old', policy_id: 'p2' }
				}
			},
			currentId: 'asst-typed'
		} as never;

		coachHydrateFromHistory(history);
		const flags = get(coachFlags);
		expect(flags['asst-typed'].severity).toBe('warn');
		expect(flags['asst-legacy'].severity).toBe('critical');
	});

	it('ignores messages without a coach field and handles empty history', () => {
		coachHydrateFromHistory(undefined);
		expect(get(coachApprovals)).toEqual({});

		const history = {
			messages: { 'plain-msg': { role: 'user', content: 'hi' } },
			currentId: 'plain-msg'
		} as never;
		coachHydrateFromHistory(history);
		expect(get(coachApprovals)).toEqual({});
		expect(get(coachFlags)).toEqual({});
	});

	it('rehydrates history.coach_events into the coachEvents store', () => {
		// The backend's /coach/events log is in-memory only, so without
		// this step the "THIS CHAT" rail would forget what coach did in
		// this conversation after a page reload or container restart.
		const history = {
			messages: {},
			currentId: null,
			coach_events: [
				{
					id: 'ev-1',
					user_id: '',
					ts_ms: 1_000,
					status: 'ok',
					action: 'block',
					reason: null,
					model_id: null,
					policy_count: 2,
					duration_ms: 0,
					tokens_in: null,
					tokens_out: null,
					error: null,
					chat_id: 'chat-abc',
					message_id: null,
					phase: 'pre'
				},
				{
					id: 'ev-2',
					user_id: '',
					ts_ms: 2_000,
					status: 'ok',
					action: 'none',
					reason: null,
					model_id: null,
					policy_count: 2,
					duration_ms: 0,
					tokens_in: null,
					tokens_out: null,
					error: null,
					chat_id: 'chat-abc',
					message_id: 'msg-1',
					phase: 'post'
				}
			]
		} as never;
		coachHydrateFromHistory(history);
		const events = get(coachEvents);
		// Newest first.
		expect(events.map((e) => e.id)).toEqual(['ev-2', 'ev-1']);
	});

	it('dedupes persisted events by id when merging with the live store', () => {
		coachEvents.set([
			{
				id: 'ev-1',
				user_id: '',
				ts_ms: 1_000,
				status: 'ok',
				action: 'block',
				reason: null,
				model_id: null,
				policy_count: 2,
				duration_ms: 0,
				tokens_in: null,
				tokens_out: null,
				error: null,
				chat_id: 'chat-abc',
				message_id: null,
				phase: 'pre'
			}
		]);
		const history = {
			messages: {},
			currentId: null,
			coach_events: [
				{
					id: 'ev-1',
					user_id: '',
					ts_ms: 1_000,
					status: 'ok',
					action: 'block',
					reason: null,
					model_id: null,
					policy_count: 2,
					duration_ms: 0,
					tokens_in: null,
					tokens_out: null,
					error: null,
					chat_id: 'chat-abc',
					message_id: null,
					phase: 'pre'
				}
			]
		} as never;
		coachHydrateFromHistory(history);
		expect(get(coachEvents)).toHaveLength(1);
	});

	it('coachBackfillChatId rewrites null chat_id on events after chat creation', () => {
		// The block flow runs preflight before the chat has an id; the
		// events get chat_id=null and would be hidden from the rail's
		// per-chat view until the chat exists and we backfill.
		const eventA = {
			id: 'ev-a',
			user_id: '',
			ts_ms: 1_000,
			status: 'ok' as const,
			action: 'block',
			reason: null,
			model_id: null,
			policy_count: 1,
			duration_ms: 0,
			tokens_in: null,
			tokens_out: null,
			error: null,
			chat_id: null,
			message_id: null,
			phase: 'pre' as const
		};
		const eventB = { ...eventA, id: 'ev-b', chat_id: 'other-chat' };
		const history = { messages: {}, coach_events: [eventA, eventB] } as never;
		coachEvents.set([eventA, eventB]);

		coachBackfillChatId(history, 'new-chat');

		const h = history as { coach_events: typeof eventA[] };
		expect(h.coach_events[0].chat_id).toBe('new-chat');
		// The already-scoped event must not be touched.
		expect(h.coach_events[1].chat_id).toBe('other-chat');
		const live = get(coachEvents);
		expect(live.find((e) => e.id === 'ev-a')?.chat_id).toBe('new-chat');
		expect(live.find((e) => e.id === 'ev-b')?.chat_id).toBe('other-chat');
	});

	it('type=block is not mirrored into either store (content speaks for itself)', () => {
		const history = {
			messages: {
				'block-msg': {
					role: 'assistant',
					content: '🛑 Coach blocked',
					coach: { type: 'block', policy_id: 'p1', rationale: 'r' }
				}
			},
			currentId: 'block-msg'
		} as never;
		coachHydrateFromHistory(history);
		expect(get(coachApprovals)).toEqual({});
		expect(get(coachFlags)).toEqual({});
	});
});
