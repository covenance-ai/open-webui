// Pure-logic tests for the coach helpers exposed to Chat.svelte.
// We don't mount components or hit the network here — just exercise
// composeCoachBlockMarkdown and coachInsertBlockExchange against
// representative inputs to catch shape regressions.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { coachPolicies } from './stores/policies';
import {
	composeCoachBlockMarkdown,
	coachInsertBlockExchange,
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
});

afterEach(() => {
	coachPolicies.set([]);
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

describe('coachInsertBlockExchange', () => {
	const verdict: PreflightBlockDetail = {
		policy_id: 'pol-hiring',
		rationale: 'overt hiring decision'
	};

	it('appends a user msg + coach assistant msg to an empty history', () => {
		const history = { messages: {}, currentId: null } as never;
		const { userMessageId, coachMessageId } = coachInsertBlockExchange(
			history,
			'Who should I hire?',
			verdict,
			['some-model']
		);

		const h = history as { messages: Record<string, any>; currentId: string | null };
		expect(Object.keys(h.messages)).toHaveLength(2);
		expect(h.currentId).toBe(coachMessageId);

		const userMsg = h.messages[userMessageId];
		expect(userMsg.role).toBe('user');
		expect(userMsg.content).toBe('Who should I hire?');
		expect(userMsg.parentId).toBeNull();
		expect(userMsg.childrenIds).toEqual([coachMessageId]);

		const coachMsg = h.messages[coachMessageId];
		expect(coachMsg.role).toBe('assistant');
		expect(coachMsg.parentId).toBe(userMessageId);
		expect(coachMsg.coachAuthored).toBe(true);
		expect(coachMsg.coach_authored).toBe(true);
		expect(coachMsg.done).toBe(true);
		expect(coachMsg.coach.type).toBe('block');
		expect(coachMsg.content).toContain('Coach blocked');
		expect(coachMsg.content).toContain('No LLM for hiring decisions');
	});

	it('chains onto the prior currentId, updating its childrenIds', () => {
		const history = {
			messages: {
				prior: {
					id: 'prior',
					role: 'assistant',
					content: 'earlier reply',
					parentId: null,
					childrenIds: []
				}
			},
			currentId: 'prior'
		} as never;
		const { userMessageId, coachMessageId } = coachInsertBlockExchange(
			history,
			'follow-up that violates policy',
			verdict,
			[]
		);

		const h = history as { messages: Record<string, any>; currentId: string | null };
		expect(h.messages.prior.childrenIds).toContain(userMessageId);
		expect(h.messages[userMessageId].parentId).toBe('prior');
		expect(h.currentId).toBe(coachMessageId);
	});
});
