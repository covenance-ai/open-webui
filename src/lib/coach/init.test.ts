// Pure-logic tests for the coach helpers exposed to Chat.svelte.
// We don't mount components or hit the network here — just exercise
// composeCoachBlockMarkdown and coachInsertBlockExchange against
// representative inputs to catch shape regressions.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { get } from 'svelte/store';

import { _resetCoachApprovalsForTests, coachApprovals } from './stores/approvals';
import { coachFlags } from './stores/flags';
import { coachPolicies } from './stores/policies';
import {
	coachAppendBlockMessage,
	coachHydrateFromHistory,
	composeCoachBlockMarkdown,
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
});

afterEach(() => {
	coachPolicies.set([]);
	_resetCoachApprovalsForTests();
	coachFlags.set({});
});

describe('composeCoachBlockMarkdown', () => {
	it('includes the policy title, body and rationale when policy is known', () => {
		const md = composeCoachBlockMarkdown({
			policy_id: 'pol-hiring',
			rationale: 'You asked who to hire.'
		});
		expect(md).toContain('Coach blocked this request');
		expect(md).toContain('No LLM for hiring decisions');
		expect(md).toContain('EU AI Act');
		expect(md).toContain('You asked who to hire.');
	});

	it('still produces something readable when the policy id is unknown', () => {
		const md = composeCoachBlockMarkdown({
			policy_id: 'no-such-policy',
			rationale: 'redacted'
		});
		expect(md).toContain('Coach blocked this request');
		expect(md).toContain('redacted');
	});

	it('omits the rationale block when no rationale was given', () => {
		const md = composeCoachBlockMarkdown({ policy_id: 'pol-hiring', rationale: null });
		expect(md).toContain('No LLM for hiring decisions');
		expect(md).not.toMatch(/coach's rationale/i);
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
