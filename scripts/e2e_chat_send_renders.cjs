#!/usr/bin/env node
// End-to-end smoke test: "user clicks send, the chat panel actually
// renders the message + the streamed response."
//
// Caught a real regression once: the [coach] overlay-anchor edit in
// Messages.svelte added a half-applied virtualization wrapper around the
// message <ul> (`topSpacerHeight`, `bottomSpacerHeight`, `visibleStart`,
// `visibleEnd`) without declaring those vars. The component crashed
// silently on every render — backend got the chat-completion request and
// title generation ran, but the user just saw a spinner. Backend tests
// can't catch this; only loading the SPA and clicking send does.
//
// Drives the running Vite dev server, signs in as admin@local.dev / admin,
// types a short prompt, clicks send, and asserts:
//   1. .chat-user appears   (message added to history & rendered)
//   2. /api/chat/completions POST observed
//   3. .chat-assistant appears   (response started streaming + rendered)
//   4. no unhandled JS errors, no fatal console errors
//
// Pre-reqs:
//   * `npm run dev` is up (vite on 5173 or 5175 — pass the URL as argv[2])
//   * backend is up with `OUR_WEBUI_DEV_AUTOSEED=1` so admin@local.dev exists
//   * a working OPENAI_API_KEYS entry so the LLM stream actually returns
//
// Usage:
//   node scripts/e2e_chat_send_renders.cjs
//   node scripts/e2e_chat_send_renders.cjs http://localhost:5175/

const { chromium } = require('playwright');

const URL = process.argv[2] || 'http://localhost:5173/';
const EMAIL = process.env.REPRO_EMAIL || 'admin@local.dev';
const PASSWORD = process.env.REPRO_PASSWORD || 'admin';

(async () => {
	const browser = await chromium.launch();
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page = await context.newPage();

	const consoleErrors = [];
	const pageErrors = [];
	const chatRequests = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(msg.text());
	});
	page.on('pageerror', (err) => pageErrors.push(err.message));
	page.on('request', (req) => {
		const u = req.url();
		if (u.includes('/api/chat/completions') || u.includes('/api/v1/coach/evaluate')) {
			chatRequests.push(`${req.method()} ${u}`);
		}
	});

	const fail = (msg) => {
		console.error('FAIL:', msg);
		console.error('---console errors:', consoleErrors.length);
		consoleErrors.forEach((e) => console.error('  ·', e));
		console.error('---page errors:', pageErrors.length);
		pageErrors.forEach((e) => console.error('  ·', e));
		console.error('---chat requests:', chatRequests.length);
		chatRequests.forEach((r) => console.error('  ·', r));
		process.exit(1);
	};

	try {
		// Sign in.
		await page.goto(URL + 'auth', { waitUntil: 'networkidle', timeout: 30_000 });
		await page.fill('input[autocomplete="email"]', EMAIL);
		await page.fill('input[type="password"]', PASSWORD);
		await page.click('button[type="submit"]');
		await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 15_000 });
		await page.waitForLoadState('networkidle', { timeout: 15_000 });
		await page.waitForTimeout(1500);

		// Dismiss the changelog dialog if it shows on first run.
		const okayBtn = page.getByRole('button', { name: /Okay, Let's Go/i });
		if (await okayBtn.count()) {
			await okayBtn.click().catch(() => {});
			await page.waitForTimeout(500);
		}
		await page.screenshot({ path: '/tmp/repro_home.png', fullPage: true });

		// Type and send. The home page comes up with a default model already
		// selected (the picker shows it in the header). No need to click it.
		const input = page.locator('#chat-input');
		await input.waitFor({ timeout: 10_000 });
		await input.fill('reply with the single word: pong');
		await page.screenshot({ path: '/tmp/repro_typed.png', fullPage: true });
		// The send button is the only enabled button[type="submit"] when the
		// input has text. There may be other submit-type buttons elsewhere
		// (e.g. nested forms), so disambiguate by enabled state.
		const submit = page.locator('button[type="submit"]:not([disabled])').last();
		await submit.click();

		// Assertion 1: user message appears.
		try {
			await page.waitForSelector('.chat-user', { timeout: 5_000 });
		} catch {
			fail('.chat-user did not appear within 5s after clicking send');
		}

		// Assertion 2: /api/chat/completions was POSTed within 5s.
		const t0 = Date.now();
		while (Date.now() - t0 < 5_000) {
			if (chatRequests.some((r) => r.includes('/api/chat/completions'))) break;
			await page.waitForTimeout(200);
		}
		if (!chatRequests.some((r) => r.includes('/api/chat/completions'))) {
			fail('no POST /api/chat/completions observed within 5s');
		}

		// Assertion 3: assistant message starts rendering within 15s.
		try {
			await page.waitForSelector('.chat-assistant', { timeout: 15_000 });
		} catch {
			fail('.chat-assistant did not appear within 15s after send');
		}

		// Assertion 4: no unhandled JS errors and no console errors. The
		// regression we're guarding here was: Messages.svelte referenced
		// undeclared `topSpacerHeight` / `bottomSpacerHeight` / `visibleStart`
		// / `visibleEnd` (introduced as part of a half-applied virtualization
		// change in the coach overlay anchor commit). The component crashed
		// silently — backend got the request and the chat title generated,
		// but the message panel never rendered. Page-error → fail.
		if (pageErrors.length > 0) {
			fail(`unhandled JS errors during chat round-trip: ${pageErrors.length}`);
		}
		// Console errors are noisier (some upstream libs whine on dev), so
		// we only fail on patterns that smell like real bugs we've burned
		// time on before. Extend the list as new ones surface.
		const fatal = consoleErrors.filter((e) =>
			/topSpacerHeight|bottomSpacerHeight|visibleStart|visibleEnd|is not a function|is not defined/.test(e)
		);
		if (fatal.length > 0) {
			fail(`fatal console errors during chat round-trip:\n  ${fatal.join('\n  ')}`);
		}

		console.log('OK: user → assistant chat round-trip works');
		console.log('chat requests:', chatRequests);
	} finally {
		await browser.close();
	}
})().catch((err) => {
	console.error('repro crashed:', err);
	process.exit(2);
});
