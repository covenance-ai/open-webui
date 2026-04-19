// Shared helpers for positioning coach chip overlays relative to the
// message DOM. Kept tiny and framework-free so unit tests can drive
// them directly without mounting Svelte components.

export interface RectLike {
	top: number;
	left: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

/**
 * Returns the first ancestor/self that has a non-zero bounding box.
 *
 * Upstream Messages.svelte wraps each message in `<li class="contents">`,
 * which applies `display: contents` — the li has no layout box of its
 * own and `getBoundingClientRect()` returns a zero-size rect. If we
 * position our chip against that, it lands in the viewport's top-left
 * (or is clipped off-screen), which is why the shields were invisible.
 *
 * The real geometry lives on the first descendant that actually renders,
 * so we probe children in DOM order and take the first one with width
 * and height. Falls back to the element's own (possibly zero) rect if
 * nothing better is found — caller decides what to do with that.
 */
export function firstLaidOutRect(el: Element | null): RectLike | null {
	if (!el) return null;
	const own = (el as HTMLElement).getBoundingClientRect();
	if (own.width > 0 && own.height > 0) return own;
	for (const child of Array.from(el.children)) {
		const r = (child as HTMLElement).getBoundingClientRect();
		if (r.width > 0 && r.height > 0) return r;
	}
	return own;
}

/** Structural compare — avoids spurious re-renders when positions are unchanged. */
export function rectsEqual(
	a: Record<string, RectLike | null>,
	b: Record<string, RectLike | null>
) {
	const ak = Object.keys(a);
	const bk = Object.keys(b);
	if (ak.length !== bk.length) return false;
	for (const k of ak) {
		const ra = a[k];
		const rb = b[k];
		if (ra === rb) continue;
		if (!ra || !rb) return false;
		if (
			ra.top !== rb.top ||
			ra.left !== rb.left ||
			ra.width !== rb.width ||
			ra.height !== rb.height
		) {
			return false;
		}
	}
	return true;
}
