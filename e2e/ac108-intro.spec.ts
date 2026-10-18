/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-108: the wordmark intro on /login and /demo. QA_URL + QA_LIVE=1. No user is created; the demo door signs the shared demo user in; the OTP request is stubbed (no mail).
import { createRequire } from 'node:module';
import { DIR } from './qa52-helpers';
const { test } = createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright/test');
const URL_ = process.env.QA_URL!;
test.skip(process.env.QA_LIVE !== '1', 'set QA_LIVE=1');

const PROBE = `(() => {
  const w = window; w.__p = { cls: [], long: [], anims: null };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__p.cls.push([Math.round(e.startTime), +e.value.toFixed(4)]); }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__p.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  const logoAnims = () => document.getAnimations().filter((a) => ['logo-letter', 'logo-mark'].includes(a.animationName) || (a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.logo')));
  w.__logoAnims = logoAnims;
  const rec = new Map();
  (function tick() { for (const a of logoAnims()) { const el = a.effect.target; const k = el.tagName + (el.textContent || '').slice(0, 1) + a.animationName; if (!rec.has(k)) { const kf = a.effect.getKeyframes(); const t = a.effect.getComputedTiming(); rec.set(k, { tag: el.tagName, txt: (el.textContent || '').slice(0, 1), name: a.animationName, props: [...new Set(kf.flatMap((x) => Object.keys(x).filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p))))], delay: Math.round(t.delay), dur: Math.round(t.duration), startAt: Math.round(a.startTime), end: Math.round(t.endTime), inHeader: !!el.closest('header') }); } } w.__p.anims = [...rec.values()]; requestAnimationFrame(tick); })();
})();`;
const watch = (page: any, ms: number) => page.evaluate((ms: number) => new Promise((res) => { const w: any = window; let max = 0; let intro = false; const t0 = performance.now(); (function tick() { max = Math.max(max, w.__logoAnims().length); if (document.querySelector('.logo-intro')) intro = true; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res({ maxLogoAnims: max, introClassSeen: intro }); })(); }), ms);

async function open(browser: any, path: string, opts: any = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.addInitScript(PROBE);
  const page = await ctx.newPage();
  await page.goto(`${URL_}${path}`);
  return { ctx, page };
}
const J = (x: any) => JSON.stringify(x);

for (const path of ['/login', '/demo']) {
  test(`AC-108 ${path}: motion, properties, timing, a11y`, async ({ browser }: any) => {
    const { ctx, page } = await open(browser, path);
    const during = await watch(page, 1600);
    const p = await page.evaluate(() => { const w: any = window; const fcp = performance.getEntriesByName('first-contentful-paint')[0]; return { anims: w.__p.anims, cls: w.__p.cls, long: w.__p.long, fcp: fcp && Math.round(fcp.startTime) }; });
    console.log(`[${path}] logo animations recorded: ${p.anims.length}; during-watch ${J(during)}`);
    console.log(`[${path}] properties animated: ${J([...new Set(p.anims.flatMap((a: any) => a.props))])}; letters: ${p.anims.filter((a: any) => a.name === 'logo-letter').length}; mark: ${p.anims.filter((a: any) => a.name === 'logo-mark').length}`);
    const letters = p.anims.filter((a: any) => a.name === 'logo-letter'); const d = letters.map((a: any) => a.delay);
    console.log(`[${path}] letter order ${letters.map((a: any) => a.txt).join('')}; delays ${J(d)}; steps ${J(d.slice(1).map((x: number, i: number) => x - d[i]))}; mark delay ${J(p.anims.filter((a: any) => a.name === 'logo-mark').map((a: any) => a.delay))}`);
    const ends = p.anims.map((a: any) => a.startAt + a.end); const first = Math.min(...p.anims.map((a: any) => a.startAt));
    console.log(`[${path}] FCP at ${p.fcp} ms; first logo animation starts at ${first} ms (document time); last ends at ${Math.max(...ends)} ms => ${Math.max(...ends) - p.fcp} ms after FCP, ${Math.max(...ends) - first} ms after intro start; max delay+duration ${Math.max(...p.anims.map((a: any) => a.end))} ms`);
    console.log(`[${path}] CLS entries: ${J(p.cls)}; long tasks: ${J(p.long)}`);
    console.log(`[${path}] a11y: ${J(await page.evaluate(() => { const l = document.querySelector('.logo'); return l && { tag: l.tagName, role: l.getAttribute('role'), label: l.getAttribute('aria-label'), wordHidden: l.querySelector('.logo-word')?.getAttribute('aria-hidden'), markHidden: l.querySelector('svg')?.getAttribute('aria-hidden') }; }))}`);
    await ctx.close();
  });

  test(`AC-108 ${path}: once per tab per screen`, async ({ browser }: any) => {
    const { ctx, page } = await open(browser, path);
    console.log(`[${path}] first open in new tab: ${J(await watch(page, 400))}`);
    await page.waitForTimeout(1500);
    await page.reload(); console.log(`[${path}] same tab, reload: ${J(await watch(page, 400))}`);
    await page.getByRole('button', { name: 'English' }).first().click(); console.log(`[${path}] language switch: ${J(await watch(page, 400))}`);
    if (path === '/login') {
      await page.route('**/auth/v1/otp*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      await page.getByLabel('Email').fill('qa-r202610162341-52-intro@example.com'); await page.getByRole('button', { name: 'Send code' }).click();
      console.log(`[${path}] email-to-code step: ${J(await watch(page, 400))} (OTP request stubbed, no mail)`);
    }
    const other = path === '/login' ? '/demo' : '/login';
    await page.goto(`${URL_}${other}`); console.log(`[${path}] same tab, first visit of ${other}: ${J(await watch(page, 400))}`);
    await page.waitForTimeout(1500);
    await page.goto(`${URL_}${path}`); console.log(`[${path}] same tab, back to ${path}: ${J(await watch(page, 400))}`);
    const p2 = await ctx.newPage(); await p2.addInitScript(PROBE); await p2.goto(`${URL_}${path}`);
    console.log(`[${path}] NEW tab (same context): ${J(await watch(p2, 400))}`);
    await ctx.close();
  });

  test(`AC-108 ${path}: reduced motion is static`, async ({ browser }: any) => {
    const { ctx, page } = await open(browser, path, { reducedMotion: 'reduce' });
    console.log(`[${path}] reduced motion: ${J(await watch(page, 1500))}; recorded=${(await page.evaluate(() => (window as any).__p.anims)).length}; logo classes: ${await page.evaluate(() => document.querySelector('.logo')?.className)}`);
    await page.screenshot({ path: `${DIR}/logo-reduced${path.replace('/', '-')}.png`, clip: { x: 0, y: 0, width: 800, height: 420 } });
    await ctx.close();
  });
}

test('AC-108 final frame equals the static logo (pixels), login', async ({ browser }: any) => {
  const a = await open(browser, '/login'); await a.page.waitForTimeout(2200);
  const b = await open(browser, '/login', { reducedMotion: 'reduce' }); await b.page.waitForTimeout(2200);
  const sel = '.logo';
  const boxA = await a.page.locator(sel).first().boundingBox(); const boxB = await b.page.locator(sel).first().boundingBox();
  const bufA = await a.page.locator(sel).first().screenshot(); const bufB = await b.page.locator(sel).first().screenshot();
  console.log(`[/login] logo box intro-end ${J(boxA)} vs static ${J(boxB)}; screenshots byte-identical: ${Buffer.compare(bufA, bufB) === 0} (${bufA.length} vs ${bufB.length} bytes)`);
  await a.ctx.close(); await b.ctx.close();
});

test('AC-108 /demo: door enabled at DCL+100 ms, a click then starts the sign-in, top-bar logo does not animate', async ({ browser }: any) => {
  const { ctx, page } = await open(browser, '/demo');
  const reqs: string[] = []; page.on('request', (r: any) => { if (/auth\/v1\/token/.test(r.url())) reqs.push(`${r.method()} ${new globalThis.URL(r.url()).pathname} at ${Date.now() - t.v}`); });
  const t = { v: 0 };
  await ctx.clearCookies(); const p2 = await ctx.newPage(); await p2.addInitScript(PROBE);
  p2.on('request', (r: any) => { if (/auth\/v1\/token/.test(r.url())) reqs.push(`${r.method()} ${new globalThis.URL(r.url()).pathname} at +${Date.now() - t.v}ms after the click`); });
  await p2.goto(`${URL_}/demo`, { waitUntil: 'commit' });
  await p2.evaluate(() => new Promise((r) => { const go = () => setTimeout(r, 100); if (document.readyState !== 'loading') go(); else document.addEventListener('DOMContentLoaded', go); }));
  const btn = p2.getByRole('button', { name: /Entrar como Andina Labs/ });
  const st = await p2.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Entrar como Andina Labs/.test(x.textContent || '')); return { present: !!b, enabled: !!b && !b.disabled, logoAnimating: (window as any).__logoAnims().length }; });
  console.log(`[/demo] at DCL+100 ms: ${J(st)}`);
  t.v = Date.now(); await btn.click({ timeout: 4000 }); await p2.waitForTimeout(2500);
  console.log(`[/demo] sign-in requests: ${J(reqs)}; url ${p2.url()}`);
  await p2.locator('h1', { hasText: /Bandeja/ }).waitFor({ timeout: 20000 });
  console.log(`[/demo] in-app top-bar logo: ${J(await watch(p2, 600))}; header logo class: ${await p2.evaluate(() => document.querySelector('header .logo')?.className)}`);
  await ctx.close();
});
