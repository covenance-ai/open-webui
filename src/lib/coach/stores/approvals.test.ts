import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import {
	_resetCoachApprovalsForTests,
	clearApproval,
	coachApprovals,
	setApproval
} from './approvals';

beforeEach(() => _resetCoachApprovalsForTests());
afterEach(() => _resetCoachApprovalsForTests());

describe('coach approvals store', () => {
	it('starts empty', () => {
		expect(get(coachApprovals)).toEqual({});
	});

	it('setApproval writes the per-message entry', () => {
		setApproval('msg-1', { phase: 'pre', policyCount: 2, createdAt: 100 });
		expect(get(coachApprovals)).toEqual({
			'msg-1': { phase: 'pre', policyCount: 2, createdAt: 100 }
		});
	});

	it('clearApproval removes one without touching others', () => {
		setApproval('a', { phase: 'pre', policyCount: 1, createdAt: 1 });
		setApproval('b', { phase: 'post', policyCount: 1, createdAt: 2 });
		clearApproval('a');
		expect(get(coachApprovals)).toEqual({
			b: { phase: 'post', policyCount: 1, createdAt: 2 }
		});
	});

	it('clearApproval on a missing id is a no-op (no allocation)', () => {
		setApproval('a', { phase: 'pre', policyCount: 1, createdAt: 1 });
		const before = get(coachApprovals);
		clearApproval('does-not-exist');
		expect(get(coachApprovals)).toBe(before);
	});

	it('setApproval overwrites an existing entry for the same id', () => {
		setApproval('m', { phase: 'pre', policyCount: 1, createdAt: 1 });
		setApproval('m', { phase: 'post', policyCount: 3, createdAt: 999 });
		expect(get(coachApprovals).m).toEqual({ phase: 'post', policyCount: 3, createdAt: 999 });
	});
});
