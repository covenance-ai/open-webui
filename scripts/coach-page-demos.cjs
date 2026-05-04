#!/usr/bin/env node
// Drive the /coach page, click each of the 3 demo cards, and screenshot
// the simulated chat that plays out below the hero. Used to verify
// DEMO_SCRIPTS (in src/routes/(app)/coach/+page.svelte) read clearly.
//
// Usage:
//   node scripts/coach-page-demos.cjs [--frontend=http://localhost:5175] [--api=http://localhost:8080] [--out-dir=/tmp]
//
// Logs in as the dev-seed admin (admin@local.dev / admin), navigates to
// /coach, clicks each demo, waits for the script to fully play out, and
// writes /tmp/coach-demo-{block,flag,intervene}.png.

const { chromium } = require('playwright');

function argv(key, def) {
	const hit = process.argv.find((a) => a.startsWith(`--${key}=`));
	return hit ? hit.split('=').slice(1).join('=') : def;
}

const FRONTEND = argv('frontend', 'http://localhost:5175');
const API = argv('api', 'http://localhost:8080');
const OUT_DIR = argv('out-dir', '/tmp');
const EMAIL = argv('email', 'admin@local.dev');
const PASSWORD = argv('password', 'admin');

const KINDS = ['block', 'flag', 'intervene'];
// DEMO_SCRIPTS use stepDelayMs = 700; longest script (intervene) = 8 steps,
// so ~6s of animation. Wait 9s to be safe and let transitions settle.
const SCRIPT_PLAY_MS = 9000;

function log(...args) {
	console.error('[coach-page-demos]', ...args);
}

async function getToken() {
	const res = await fetch(`${API}/api/v1/auths/signin`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: EMAIL, password: PASSWORD })
	});
	if (!res.ok) throw new Error(`signin failed: ${res.status} ${await res.text()}`);
	const json = await res.json();
	if (!json.token) throw new Error('signin returned no token');
	return json.token;
}

(async () => {
	const token = await getToken();
	log('logged in as', EMAIL);

	const browser = await chromium.launch();
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page = await context.newPage();

	await page.addInitScript((t) => {
		try {
			localStorage.setItem('token', t);
		} catch {}
	}, token);

	await page.goto(`${FRONTEND}/coach`, { waitUntil: 'networkidle', timeout: 30_000 });
	// Hydration + onboarding modal dismissal.
	await page.waitForTimeout(2000);
	for (let i = 0; i < 3; i++) {
		const dialog = page.locator('div[role="dialog"][aria-modal="true"]');
		if (!(await dialog.isVisible().catch(() => false))) break;
		const dismiss = dialog
			.locator(
				'button:has-text("Okay"), button:has-text("Got it"), button:has-text("Close"), button[aria-label*="close" i]'
			)
			.first();
		if (await dismiss.isVisible().catch(() => false)) {
			await dismiss.click({ force: true }).catch(() => {});
		} else {
			await page.keyboard.press('Escape').catch(() => {});
		}
		await page.waitForTimeout(400);
	}

	for (const kind of KINDS) {
		// Each card is an <article> containing the kind label and a
		// "▶ Try it" button. Locate the article by its visible label, then
		// click the "Try it" inside.
		const labelByKind = { block: 'Block', flag: 'Flag', intervene: 'Intervene' };
		const card = page.locator('article').filter({ hasText: labelByKind[kind] }).first();
		const tryBtn = card.locator('button', { hasText: 'Try it' }).first();
		await tryBtn.waitFor({ state: 'visible', timeout: 10_000 });
		await tryBtn.click();
		log(`clicked ${kind} "Try it"; waiting ${SCRIPT_PLAY_MS}ms for script to play`);
		await page.waitForTimeout(SCRIPT_PLAY_MS);

		// Scroll the chat area into view so the screenshot focuses on it.
		const chatLabel = page
			.locator(`[aria-label*="${labelByKind[kind]} demo"]`)
			.first();
		if (await chatLabel.isVisible().catch(() => false)) {
			await chatLabel.scrollIntoViewIfNeeded();
		}
		await page.waitForTimeout(500);

		const out = `${OUT_DIR}/coach-demo-${kind}.png`;
		await page.screenshot({ path: out, fullPage: true });
		log('wrote', out);
	}

	await browser.close();
	console.log(KINDS.map((k) => `${OUT_DIR}/coach-demo-${k}.png`).join('\n'));
})().catch((err) => {
	console.error('[coach-page-demos] ERROR:', err.message);
	process.exit(1);
});
