#!/usr/bin/env node
// Quick headless screenshot of the running dev server.
//
// Usage:
//   node scripts/screenshot.js [url] [out] [--width=W --height=H --wait=ms]
//
// Defaults to http://localhost:5174/ (vite HMR) and /tmp/openwebui-<ts>.png.
// Waits for the main input/model picker to render before shooting, so the
// screenshot isn't of a pre-hydration shell.
//
// Use it to verify UI changes you just made without having to alt-tab to
// a browser and find the right tab. See CLAUDE.md.

const { chromium } = require('playwright');

function argv(key, def) {
	const m = process.argv.find((a) => a.startsWith(`--${key}=`));
	return m ? m.split('=')[1] : def;
}

const url = process.argv[2] && !process.argv[2].startsWith('--')
	? process.argv[2]
	: 'http://localhost:5174/';
const out = process.argv[3] && !process.argv[3].startsWith('--')
	? process.argv[3]
	: `/tmp/openwebui-${Date.now()}.png`;
const width = parseInt(argv('width', '1440'), 10);
const height = parseInt(argv('height', '900'), 10);
const wait = parseInt(argv('wait', '2500'), 10);

(async () => {
	const browser = await chromium.launch();
	const context = await browser.newContext({
		viewport: { width, height }
	});
	const page = await context.newPage();
	await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
	// Give the SPA a beat to hydrate + render conditional content (rail,
	// coach panel, etc.). Longer than looks necessary because dev-server
	// HMR adds latency.
	await page.waitForTimeout(wait);
	await page.screenshot({ path: out, fullPage: true });
	await browser.close();
	console.log(out);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
