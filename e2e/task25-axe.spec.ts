/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file (Playwright is not a repo dependency; env-driven) */
// QA Task 25 (AC-91 item 3): axe on the vendor pages on a phone, es and en. Read-only: no message is sent.
// Needs QA_BASE (the facturas Worker), QA_STATUS_PATH (a real /estado/<token> path) and AXE (path to axe-core/axe.min.js).
import { createRequire } from 'node:module';
const { test } = createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright/test');

const BASE = process.env.QA_BASE!;
const STATUS = process.env.QA_STATUS_PATH!;
test.use({ viewport: { width: 390, height: 844 }, bypassCSP: true });
for (const lang of ['es', 'en']) for (const [n, p] of [['portal', '/andina-labs'], ['status', STATUS], ['invalid', '/estado/abcdefghijklmnopqrstuvwxyz0123456789abcdefg'], ['notfound', '/zzz']]) {
  test(`axe ${n} ${lang}`, async ({ page }) => {
    await page.goto(`${BASE}${p}?lang=${lang}`); await page.locator('h1').waitFor();
    await page.addScriptTag({ path: process.env.AXE! });
    const r = await page.evaluate(async () => (await (window as any).axe.run()).violations.map((v: any) => ({ id: v.id, impact: v.impact, n: v.nodes.length, first: v.nodes[0].target.join(' ') })));
    console.log(`AXE ${n} ${lang}`, JSON.stringify(r));
  });
}
