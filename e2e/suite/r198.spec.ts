/* eslint-disable @typescript-eslint/no-explicit-any -- e2e suite */
// R-198's two known FAILs as assertions (AC-107, AC-109): (a) landing CLS <= 0.01 at 390 and 1440 for the trial door and the OTP door,
// 5 runs each (es projects only: 10 trial companies + 10 Admin-API users per run); (b) the «n de m» denominator never changes across 5 reloads.
import { test, expect, t, trialDoor, otpDoor, adminUser, INIT } from './pw';
test.describe.configure({ retries: 0 }); // every attempt creates trial companies or users (budget)

async function landingCls(page: any) {
  await page.waitForTimeout(3000); // late data (company name, figures) lands inside this window
  return page.evaluate(() => { const s = (window as any).__e2e; const sh = s.ls.filter((e: any) => e.t >= s.mark && (!e.r || e.t <= s.mark + 600)); return { cls: Math.round(sh.reduce((a: number, e: any) => a + e.v, 0) * 10000) / 10000, shifts: sh.filter((e: any) => e.v > 0.0005).slice(0, 5) }; });
}
for (const door of ['trial', 'otp'] as const) {
  test(`R-198(a) AC-107/AC-109 landing CLS <= 0.01, ${door} door, 5 runs`, async ({ browser, guard, lang }: any, info: any) => {
    test.skip(lang !== 'es', 'run once per width (es projects) to keep the trial budget');
    const rows: any[] = [];
    for (let i = 0; i < 5; i++) {
      const ctx = await browser.newContext({ viewport: info.project.use.viewport, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch, locale: info.project.use.locale });
      await ctx.addInitScript(INIT);
      const p = await ctx.newPage(); guard.watch(p);
      if (door === 'trial') await trialDoor(p, guard, lang); else await otpDoor(p, guard, lang, await adminUser(`cls${i}`));
      const r = await landingCls(p); rows.push(r);
      await info.attach(`${door}-run${i + 1}`, { body: await p.screenshot(), contentType: 'image/png' });
      await ctx.close();
    }
    console.log(`R198a ${door} ${info.project.name}: ${JSON.stringify(rows)}`);
    for (const [i, r] of rows.entries()) expect.soft(r.cls, `run ${i + 1}: landing CLS ${r.cls}, shifts ${JSON.stringify(r.shifts)}`).toBeLessThanOrEqual(0.01);
  });
}

test('R-198(b) AC-107 «n de m» denominator stays the same across 5 reloads during the first-login pass', async ({ page, guard, lang }: any, info: any) => {
  test.skip(info.project.name !== 'd1440-es', 'one trial company per run');
  await trialDoor(page, guard, lang);
  const re = new RegExp(t(lang, '(\\d+) de (\\d+)', '(\\d+) of (\\d+)'));
  const read = async () => { const m = (await page.locator('main').innerText()).match(new RegExp(t(lang, 'Decidiendo[^\\n]*?', 'Deciding[^\\n]*?') + re.source)); return m ? [Number(m[1]), Number(m[2])] : null; };
  const seen: any[] = [await read()];
  for (let i = 0; i < 5; i++) {
    await page.reload();
    await expect(page.locator('table.inbox-list tbody tr[data-id]').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(400);
    seen.push(await read());
  }
  console.log(`R198b n-de-m after each reload: ${JSON.stringify(seen)}`);
  const during = seen.filter(Boolean) as number[][];
  expect(during.length, 'the pass is still visible after the first reload').toBeGreaterThan(1);
  for (const [n, m] of during) expect.soft(n).toBeLessThanOrEqual(m);
  expect(new Set(during.map((x) => x[1])).size, `denominator changed mid-run: ${JSON.stringify(seen)}`).toBe(1);
  await guard.check('after-reloads');
});
