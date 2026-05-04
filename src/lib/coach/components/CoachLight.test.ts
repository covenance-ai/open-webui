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

import { describe, expect, it } from 'vitest';

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

describe('coach UI variant escape hatch', () => {
	it('is reachable from outside the rail variant', () => {
		const hits = filesMutatingVariant();
		const outsideRail = hits.filter((p) => !p.includes('/ui/rail/'));
		// At least one mutation site must live outside ui/rail/, otherwise
		// switching away from rail strands the user with no picker.
		expect(outsideRail.length).toBeGreaterThan(0);
	});
});
