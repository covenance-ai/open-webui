#!/usr/bin/env node
// Sign in, open the model picker, and dump every /profile/image request +
// its final 302 location so we can see which models resolve to a CDN URL
// vs falling back to /static/favicon.png.
const { chromium } = require('playwright');

const [, , URL, EMAIL, PASSWORD] = process.argv;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const seen = [];
  page.on('response', async (r) => {
    const u = r.url();
    if (u.includes('/models/model/profile/image')) {
      const headers = r.headers();
      const req = r.request();
      let body = '';
      if (r.status() === 401) {
        try { body = (await r.text()).slice(0, 200); } catch (_) {}
      }
      seen.push({
        url: u.replace(URL, ''),
        status: r.status(),
        location: headers['location'] || '',
        ct: headers['content-type'] || '',
        sentCookie: (req.headers()['cookie'] || '').slice(0, 80),
        sentAuth: req.headers()['authorization'] ? 'YES' : '',
        body,
      });
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Dismiss release-notes modal.
  for (const sel of ["button:has-text(\"Okay, Let's Go!\")", "button:has-text(\"Okay\")"]) {
    const el = await page.$(sel);
    if (el) { await el.click().catch(() => {}); break; }
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(600);

  // Open picker.
  const picker = await page.$('button:has-text("GPT-5.4")');
  if (picker) await picker.click().catch(() => {});
  await page.waitForTimeout(8000);
  await browser.close();

  for (const r of seen) {
    console.log(`${r.status}  cookie=[${r.sentCookie}] auth=${r.sentAuth}  ${r.url}  -> ${r.location}  body=${r.body}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
