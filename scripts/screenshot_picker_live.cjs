#!/usr/bin/env node
// Sign in to the live our-webui deployment and screenshot the model picker.
// Args: <url> <email> <password> <out_path>
const { chromium } = require('playwright');

const [, , URL, EMAIL, PASSWORD, OUT] = process.argv;
if (!URL || !EMAIL || !PASSWORD || !OUT) {
  console.error('usage: screenshot_picker.cjs <url> <email> <password> <out_path>');
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30_000 });
  // Sign-in form. Open WebUI uses placeholders/labels — try email field first.
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await page.waitForTimeout(2000);

  // Warm-up: reload once so all session/cookie state is established
  // before the picker fires its image requests (avoids intermittent
  // 401s on the very first paint).
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Dismiss the "What's New" / release notes modal if present so it
  // doesn't cover the picker.
  for (const sel of [
    'button:has-text("Okay, Let\'s Go!")',
    'button:has-text("Okay, Let\'s Go")',
    'button:has-text("Got it")',
    'button:has-text("Close")',
    '[role="dialog"] button[aria-label="Close"]',
  ]) {
    const el = await page.$(sel);
    if (el) {
      try { await el.click(); } catch (_) {}
      break;
    }
  }
  await page.waitForTimeout(800);
  // Press Escape as a belt-and-braces — closes any leftover dialog.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);

  // Open the model picker. Click the model-name button in the top bar.
  const pickerSel =
    'button:has-text("GPT-5.4"), button:has-text("Claude"), button:has-text("Gemini"), ' +
    'button:has-text("DeepSeek"), button:has-text("Qwen"), button:has-text("GLM"), ' +
    'button[aria-haspopup="listbox"]';
  const picker = await page.$(pickerSel);
  if (picker) {
    try { await picker.click(); } catch (_) {}
  }
  // Give the picker plenty of time to settle every image request, and
  // re-open if it auto-closed during the warm-up reload.
  await page.waitForTimeout(6000);
  await page.screenshot({ path: OUT, fullPage: true });
  await browser.close();
  console.log(OUT);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
