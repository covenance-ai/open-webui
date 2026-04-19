// Regression tests for the overlay rect helpers. The bug these catch:
// <li class="contents"> parents were reporting 0×0 rects, and the
// overlays positioned their chips at (0,0), so the shields looked
// "missing" to the user. firstLaidOutRect must drill past a zero-size
// parent and return the first child that actually has dimensions.

import { describe, expect, it } from 'vitest';

import { firstLaidOutRect, rectsEqual } from './rects';

function fakeElement(
	own: { w: number; h: number; top?: number; left?: number },
	children: Array<{ w: number; h: number; top?: number; left?: number }> = []
) {
	const mk = (d: { w: number; h: number; top?: number; left?: number }) =>
		({
			getBoundingClientRect: () => ({
				top: d.top ?? 0,
				left: d.left ?? 0,
				width: d.w,
				height: d.h,
				right: (d.left ?? 0) + d.w,
				bottom: (d.top ?? 0) + d.h
			})
		}) as unknown as HTMLElement;
	const el = mk(own) as unknown as Element;
	(el as unknown as { children: unknown[] }).children = children.map(mk);
	return el;
}

describe('firstLaidOutRect', () => {
	it('returns the element itself when it has a non-zero rect', () => {
		const el = fakeElement({ w: 400, h: 100, top: 50, left: 10 });
		const r = firstLaidOutRect(el)!;
		expect(r.width).toBe(400);
		expect(r.height).toBe(100);
		expect(r.top).toBe(50);
	});

	it('drills to the first sized child when parent is display:contents (0×0)', () => {
		const el = fakeElement(
			{ w: 0, h: 0 },
			[
				{ w: 0, h: 0 },
				{ w: 300, h: 80, top: 120, left: 40 },
				{ w: 50, h: 20 }
			]
		);
		const r = firstLaidOutRect(el)!;
		expect(r.width).toBe(300);
		expect(r.height).toBe(80);
		expect(r.top).toBe(120);
	});

	it('returns null when the element itself is null', () => {
		expect(firstLaidOutRect(null)).toBeNull();
	});

	it('falls back to the parent rect when no child has dimensions either', () => {
		const el = fakeElement({ w: 0, h: 0, top: 7 }, [{ w: 0, h: 0 }]);
		const r = firstLaidOutRect(el)!;
		expect(r.width).toBe(0);
		expect(r.top).toBe(7);
	});
});

describe('rectsEqual', () => {
	const rect = (top: number) => ({ top, left: 0, right: 10, bottom: 10, width: 10, height: 10 });

	it('equal maps compare equal', () => {
		expect(rectsEqual({ a: rect(1) }, { a: rect(1) })).toBe(true);
	});

	it('different top positions compare unequal', () => {
		expect(rectsEqual({ a: rect(1) }, { a: rect(2) })).toBe(false);
	});

	it('different key sets compare unequal', () => {
		expect(rectsEqual({ a: rect(1) }, { a: rect(1), b: rect(1) })).toBe(false);
	});

	it('null values compare equal only when both sides are null', () => {
		expect(rectsEqual({ a: null }, { a: null })).toBe(true);
		expect(rectsEqual({ a: null }, { a: rect(0) })).toBe(false);
	});
});
