#!/usr/bin/env node
// Drive the coach pre-flight-block flow headlessly and grab a screenshot.
//
// Assumes coach-seed.mjs has already primed the instance (or is piped to
// this script). Reads the seed JSON (token + api url) from stdin or from
// --seed=path; uses the token to log in by injecting localStorage.token
// before the SPA hydrates, then types a hire-related prompt and waits
// for the CoachBlockMessage card to render.
//
// Usage:
//   node scripts/coach-seed.mjs | node scripts/coach-block-screenshot.mjs
//   node scripts/coach-block-screenshot.mjs --seed=/tmp/seed.json --frontend=http://localhost:5173
//
// Why inject the token instead of filling the signin form: the signin
// form is a SvelteKit page with its own login logic; bypassing it keeps
// this script insensitive to form-field churn.

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

function argv(key, def) {
	const hit = process.argv.find((a) => a.startsWith(`--${key}=`));
	return hit ? hit.split('=').slice(1).join('=') : def;
}

const FRONTEND = argv('frontend', process.env.COACH_FRONTEND || 'http://localhost:5173');
const SEED_PATH = argv('seed', null);
const OUT = argv('out', `/tmp/coach-block-${Date.now()}.png`);
const PROMPT = argv('prompt', 'is it better to hire black woman or white man for programmer job');
const WIDTH = parseInt(argv('width', '1440'), 10);
const HEIGHT = parseInt(argv('height', '900'), 10);
// How long to wait for the block card to render after pressing Enter.
// Coach pre-flight runs a backend roundtrip; demo mode is fast but we
// still allow a generous window so a slow dev server doesn't flake.
const BLOCK_TIMEOUT = parseInt(argv('timeout', '10000'), 10);

function log(...args) {
	console.error('[coach-screenshot]', ...args);
}

async function readSeed() {
	if (SEED_PATH) {
		return JSON.parse(readFileSync(SEED_PATH, 'utf8'));
	}
	// Read JSON from stdin — the seed script's last line.
	return await new Promise((resolve, reject) => {
		let buf = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (chunk) => (buf += chunk));
		process.stdin.on('end', () => {
			const last = buf.trim().split(/\r?\n/).filter(Boolean).pop();
			if (!last) return reject(new Error('no seed JSON on stdin; pipe coach-seed.mjs or use --seed'));
			try {
				resolve(JSON.parse(last));
			} catch (err) {
				reject(new Error(`seed stdin was not JSON: ${err.message}`));
			}
		});
		process.stdin.on('error', reject);
	});
}

(async () => {
	const seed = await readSeed();
	if (!seed.token) throw new Error('seed missing .token');
	log('using token for', seed.email ?? seed.user_id ?? '(unknown user)');

	const browser = await chromium.launch();
	const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
	const page = await context.newPage();

	// Stash the token in localStorage before the first Svelte page loads.
	// addInitScript fires on every navigation, including the initial one,
	// so /auth-guarded pages see the session from the very first paint.
	await page.addInitScript((token) => {
		try {
			localStorage.setItem('token', token);
		} catch {
			/* sandboxed storage — shouldn't happen in headless chromium */
		}
	}, seed.token);

	log('loading', FRONTEND);
	await page.goto(FRONTEND, { waitUntil: 'networkidle', timeout: 30_000 });
	// SvelteKit hydration + rail mount + onboarding dismissal takes a beat.
	await page.waitForTimeout(2500);

	// Open WebUI pops a "What's new" / changelog modal on the first load
	// of a new user. It's a <div role="dialog"> that intercepts clicks on
	// the chat input underneath, so we dismiss it before proceeding. A
	// best-effort Escape + "Okay, Let's Go!" button click covers both the
	// changelog dialog and any smaller modals (model-updated, etc).
	for (let i = 0; i < 3; i++) {
		const dialog = page.locator('div[role="dialog"][aria-modal="true"]');
		if (!(await dialog.isVisible().catch(() => false))) break;
		const dismiss = dialog.locator(
			'button:has-text("Okay"), button:has-text("Got it"), button:has-text("Close"), button[aria-label*="close" i]'
		).first();
		if (await dismiss.isVisible().catch(() => false)) {
			await dismiss.click({ force: true }).catch(() => {});
		} else {
			await page.keyboard.press('Escape').catch(() => {});
		}
		await page.waitForTimeout(400);
	}

	// The main chat input is a textarea with placeholder "Send a message"
	// in upstream; we also handle variants by falling back to any visible
	// contenteditable chat input.
	const input = await page
		.locator('#chat-input, textarea[placeholder*="Send a message" i]')
		.first();
	await input.waitFor({ state: 'visible', timeout: 15_000 });
	await input.click();
	await input.fill(PROMPT);
	log('submitting prompt:', PROMPT);
	await input.press('Enter');

	// Wait for the CoachBlockMessage to appear — its <article class="coach-block">
	// is the unambiguous landmark. No other component uses that class.
	const blockCard = page.locator('article.coach-block');
	try {
		await blockCard.waitFor({ state: 'visible', timeout: BLOCK_TIMEOUT });
		log('block card rendered');
	} catch (err) {
		log('WARN: block card did not appear within', BLOCK_TIMEOUT, 'ms — screenshotting anyway for inspection');
	}
	// Small settle for CSS transitions on the rail + body offset.
	await page.waitForTimeout(600);

	await page.screenshot({ path: OUT, fullPage: true });
	log('wrote', OUT);
	console.log(OUT);

	await browser.close();
})().catch((err) => {
	console.error('[coach-screenshot] ERROR:', err.message);
	process.exit(1);
});
