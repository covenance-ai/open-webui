// Regression test for the "trapped in theater/chips" bug.
//
// The variant picker used to live only inside CoachPanel, which is mounted
// only by the rail variant. After switching to theater or chips, the user
// had no way back. Fix: an always-on surface (CoachLight) now mutates
// coachUIVariant, so a user in any variant can reach the picker.
//
// We assert the structural property — "at least one component reachable
// outside the rail variant writes coachUIVariant" — by grepping component
// sources. SSR can't open the menu (menuOpen is internal), so a DOM
// snapshot wouldn't catch a regression where the menu is silently
// reverted. The grep does.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

import { coachConfig } from '../stores/config';
import { coachUIVariant } from '../stores/ui';
import CoachLight from './CoachLight.svelte';

const COACH_DIR = new URL('..', import.meta.url).pathname; // src/lib/coach/

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walk(p);
		} else if (entry.isFile()) {
			yield p;
		}
	}
}

function filesMutatingVariant(): string[] {
	const hits: string[] = [];
	for (const path of walk(COACH_DIR)) {
		if (!/\.(svelte|ts)$/.test(path)) continue;
		if (path.endsWith('.test.ts')) continue;
		if (path.endsWith('/stores/ui.ts')) continue; // the store itself
		const src = readFileSync(path, 'utf8');
		if (/coachUIVariant\.set\(|setCoachUIVariant\(/.test(src)) {
			hits.push(path);
		}
	}
	return hits;
}

const SAMPLE_CFG = {
	user_id: 'u1',
	enabled: true,
	access_enabled: true,
	demo_mode: false,
	coach_model_id: 'm',
	active_policy_ids: ['p1'],
	created_at: 0,
	updated_at: 0
};

beforeEach(() => {
	coachConfig.set(null as never);
	coachUIVariant.set('theater');
});

afterEach(() => {
	coachUIVariant.set('rail');
});

describe('coach UI variant escape hatch', () => {
	it('is reachable from outside the rail variant', () => {
		const hits = filesMutatingVariant();
		const outsideRail = hits.filter((p) => !p.includes('/ui/rail/'));
		// At least one mutation site must live outside ui/rail/, otherwise
		// switching away from rail strands the user with no picker.
		expect(outsideRail.length).toBeGreaterThan(0);
	});

	it('CoachLight SSR-renders without crashing in non-rail variants', () => {
		// Catches the render-time-crash class that the e2e chat test
		// catches at runtime — but cheap, so it runs on every CI.
		coachConfig.set(SAMPLE_CFG);
		for (const variant of ['chips', 'theater'] as const) {
			coachUIVariant.set(variant);
			const body = render(CoachLight, { props: {} }).body;
			expect(body).toContain('data-coach-light');
		}
	});
});
