/* eslint-disable @typescript-eslint/no-explicit-any -- e2e suite: Playwright is resolved at runtime (local @playwright/test or the global install) */
// Shared fixture: every test gets `guard`, which fails the test on console errors or warnings, page errors and 4xx/5xx responses
// (except the ones a test declares with guard.allow), and guard.check(label) asserts, on the state on screen: no horizontal overflow
// at <= 480 px, CLS <= 0.01 since guard.land() (all layout shifts, the landing click's recent-input exemption is not applied), no clipped text.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const req = createRequire(import.meta.url);
const dir = process.env.PLAYWRIGHT_DIR || (() => { try { return req.resolve('@playwright/test/package.json').replace(/[\\/]package\.json$/, ''); } catch { return execSync('npm root -g').toString().trim() + '/playwright'; } })();
const pw = req(/@playwright[\\/]test$/.test(dir) ? dir : `${dir}/test`);
export const expect = pw.expect;
export const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
export const RUN = process.env.E2E_RUN || 'r202610162341';
export type Lang = 'es' | 'en';
export const t = (lang: Lang, es: string, en: string) => (lang === 'es' ? es : en);

export const INIT = `(() => { const s = (window.__e2e = { ls: [], mark: 0 }); s.markNow = () => { s.mark = performance.now(); };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) s.ls.push({ t: e.startTime, v: e.value, r: e.hadRecentInput,
    src: (e.sources || []).map((x) => x.node ? (x.node.nodeName + '.' + String(x.node.className || '').slice(0, 40)) : '?').join(',') }); }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {} })();`;

export async function setLang(page: any, lang: Lang) {
  if (lang === 'es') return;
  const b = page.getByRole('button', { name: /^(English|en|EN)$/ }).first();
  await b.click();
}

export interface Guard { allow(re: RegExp): void; watch(p: any): void; land(p?: any): Promise<void>; check(label: string, p?: any): Promise<void> }

export const test = pw.test.extend({
  lang: ['es', { option: true }],
  context: async ({ context }: any, use: any) => { await context.addInitScript(INIT); await use(context); },
  guard: [async ({ page }: any, use: any, info: any) => {
    const bad: string[] = []; const allowed: RegExp[] = [];
    const watch = (p: any) => {
      p.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') bad.push(`console.${m.type()} ${m.text().slice(0, 300)} @ ${p.url()}`); });
      p.on('pageerror', (e: any) => bad.push(`pageerror ${String(e).slice(0, 300)} @ ${p.url()}`));
      p.on('response', (r: any) => { if (r.status() >= 400) bad.push(`http ${r.status()} ${r.request().method()} ${r.url().slice(0, 200)}`); });
      p.on('requestfailed', (r: any) => { const e = r.failure()?.errorText || ''; if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(e)) bad.push(`requestfailed ${e} ${r.url().slice(0, 200)}`); });
    };
    watch(page);
    const g: Guard = {
      allow: (re) => { allowed.push(re); },
      watch,
      land: async (p = page) => { await p.evaluate(() => (window as any).__e2e?.markNow()).catch(() => {}); },
      check: async (label, p = page) => {
        const r = await p.evaluate(() => {
          const s = (window as any).__e2e || { ls: [], mark: 0 };
          const shifts = s.ls.filter((e: any) => e.t >= s.mark && (!e.r || e.t <= s.mark + 600));
          const cls = shifts.reduce((a: number, e: any) => a + e.v, 0);
          const de = document.documentElement;
          const clipped: string[] = []; const truncated: string[] = [];
          for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) {
            if (/^(INPUT|TEXTAREA|SELECT|OPTION|SCRIPT|STYLE|svg|VIDEO|IMG|CANVAS|IFRAME)$/i.test(el.tagName)) continue;
            const cs = getComputedStyle(el); const ox = cs.overflowX, oy = cs.overflowY;
            if (!/hidden|clip/.test(ox + oy) || cs.visibility === 'hidden' || cs.display === 'none') continue;
            const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0);
            if (!own || el.offsetParent === null && cs.position !== 'fixed') continue;
            if (el.closest('[aria-hidden="true"], .sr-only, .visually-hidden')) continue;
            const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
            const over = (/hidden|clip/.test(ox) && el.scrollWidth > el.clientWidth + 1) || (/hidden|clip/.test(oy) && el.scrollHeight > el.clientHeight + 1);
            const ellipsis = cs.textOverflow === 'ellipsis' || ((cs as any).webkitLineClamp && (cs as any).webkitLineClamp !== 'none');
            if (over) (ellipsis ? truncated : clipped).push(`${el.tagName}.${String(el.className).slice(0, 40)} "${(el.textContent || '').trim().slice(0, 40)}" ${el.scrollWidth}x${el.scrollHeight}>${el.clientWidth}x${el.clientHeight}`);
          }
          return { w: innerWidth, sw: de.scrollWidth, cw: de.clientWidth, cls: Math.round(cls * 10000) / 10000, shifts: shifts.filter((e: any) => e.v > 0.0005).slice(0, 6), clipped: clipped.slice(0, 8), truncated: truncated.slice(0, 8) };
        });
        if (r.w <= 480) expect.soft(r.sw, `[${label}] horizontal overflow at ${r.w}px: scrollWidth ${r.sw} > clientWidth ${r.cw}`).toBeLessThanOrEqual(r.cw);
        expect.soft(r.cls, `[${label}] CLS since landing ${r.cls} > 0.01; shifts ${JSON.stringify(r.shifts)}`).toBeLessThanOrEqual(0.01);
        expect.soft(r.clipped, `[${label}] text clipped by its box (no ellipsis)`).toEqual([]);
        if (r.truncated.length) info.annotations.push({ type: 'truncated-with-ellipsis', description: `[${label}] ${r.truncated.join(' ; ')}` });
        await info.attach(`state-${label}`, { body: await p.screenshot(), contentType: 'image/png' }).catch(() => {});
      },
    };
    await use(g);
    const left = bad.filter((b) => !allowed.some((re) => re.test(b)));
    expect.soft(left, 'console errors/warnings, page errors and 4xx/5xx responses (undeclared)').toEqual([]);
  }, { auto: true }],
});

// Trial door: /login -> «Probar con mi propia empresa» -> usable Bandeja. One trial company per call.
export async function trialDoor(page: any, guard: Guard, lang: Lang) {
  await page.goto(`${BASE}/login`);
  await setLang(page, lang);
  const door = page.getByRole('button', { name: t(lang, 'Probar con mi propia empresa', 'Try it with my own company') });
  await expect(door).toBeEnabled();
  await page.waitForTimeout(400);
  await guard.land(page);
  await door.click();
  await expect(page.locator('h1').filter({ hasText: t(lang, 'Bandeja', 'Inbox') })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('table.inbox-list tbody tr[data-id]').first()).toBeVisible({ timeout: 20000 });
}

// Admin-API user (no mail): created confirmed, then its 6-digit code comes from generate_link. Emails: qa-<RUN>-e2e-*@example.com.
export async function adminUser(tag: string): Promise<string> {
  const email = `qa-${RUN}-e2e-${tag}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.com`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: h, body: JSON.stringify({ email, email_confirm: true }) });
  if (!r.ok) throw new Error(`admin create ${r.status}`);
  return email;
}
export async function adminOtp(email: string): Promise<string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) });
  return (await r.json()).email_otp;
}
// OTP door with an Admin-API code; the OTP mail request is stubbed so nothing is sent.
export async function otpDoor(page: any, guard: Guard, lang: Lang, email: string) {
  await page.route('**/auth/v1/otp*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(`${BASE}/login`);
  await setLang(page, lang);
  await page.locator('#login-email').fill(email);
  await page.getByRole('button', { name: t(lang, 'Enviar código', 'Send code') }).click();
  const code = await adminOtp(email);
  await page.getByLabel(t(lang, 'Código de 6 dígitos', '6-digit code')).fill(code);
  await page.waitForTimeout(300);
  await guard.land(page);
  await page.getByRole('button', { name: t(lang, 'Verificar código', 'Verify code'), exact: true }).click();
  await expect(page.locator('h1').filter({ hasText: t(lang, 'Bandeja', 'Inbox') })).toBeVisible({ timeout: 20000 });
}
