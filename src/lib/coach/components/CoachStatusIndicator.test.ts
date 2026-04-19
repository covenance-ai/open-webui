// SSR-rendering test for the per-chat coach status pill.
//
// SSR (svelte/server) catches the blunder we just shipped: a previous
// version of this component rendered nothing in the absence of an
// active event, so the user saw no pill at all even when coach was on.
// A render assertion against `cfg.enabled=true` would have failed
// loudly before commit.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { get } from 'svelte/store';

import { coachConfig } from '../stores/config';
import {
	_resetCoachStatusForTests,
	flashCoachResult,
	setCoachProcessing
} from '../stores/status';
import CoachStatusIndicator from './CoachStatusIndicator.svelte';

const SAMPLE_CFG = {
	user_id: 'u1',
	enabled: true,
	demo_mode: false,
	coach_model_id: 'm',
	active_policy_ids: ['p1'],
	created_at: 0,
	updated_at: 0
};

beforeEach(() => {
	_resetCoachStatusForTests();
	coachConfig.set(null as never);
});

afterEach(() => {
	_resetCoachStatusForTests();
});

function html(props: { chatId: string | null }) {
	return render(CoachStatusIndicator, { props }).body;
}

describe('CoachStatusIndicator (SSR)', () => {
	it('renders nothing when coach is off', () => {
		coachConfig.set({ ...SAMPLE_CFG, enabled: false });
		expect(html({ chatId: 'chat-A' })).not.toContain('data-coach-status');
	});

	it('renders the idle pill when coach is on with no active event', () => {
		coachConfig.set(SAMPLE_CFG);
		const out = html({ chatId: 'chat-A' });
		expect(out).toContain('data-coach-status="idle"');
		expect(out).toContain('idle');
	});

	it('renders the per-chat status when one exists', () => {
		coachConfig.set(SAMPLE_CFG);
		setCoachProcessing('pre', 'chat-A');
		const out = html({ chatId: 'chat-A' });
		expect(out).toContain('data-coach-status="processing-pre"');
		expect(out).toContain('screening');
	});

	it('one chat\'s flash does not bleed into another chat\'s pill', () => {
		coachConfig.set(SAMPLE_CFG);
		flashCoachResult('blocked', 'chat-A');

		expect(html({ chatId: 'chat-A' })).toContain('data-coach-status="blocked"');
		expect(html({ chatId: 'chat-B' })).toContain('data-coach-status="idle"');
	});

	it('renders idle when chatId is null (no chat in scope yet, but coach is on)', () => {
		coachConfig.set(SAMPLE_CFG);
		// chatId=null means "this view has no specific chat"; we still want
		// to communicate that coach is on globally — by showing idle.
		expect(html({ chatId: null })).toContain('data-coach-status="idle"');
	});

	it('hides when coach is on but chatId is null AND we are off', () => {
		// Sanity: off + null → nothing.
		coachConfig.set({ ...SAMPLE_CFG, enabled: false });
		expect(html({ chatId: null })).not.toContain('data-coach-status');
	});
});
