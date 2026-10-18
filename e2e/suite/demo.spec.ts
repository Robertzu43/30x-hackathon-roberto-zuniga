/* eslint-disable @typescript-eslint/no-explicit-any -- e2e suite */
// /demo (read-only): hero and slogan (AC-119), the film request, poster and English captions answer 200 (AC-111/AC-114; this Chromium cannot
// decode H.264, so playback is not asserted, only that the player or its designed error state shows), step cards (AC-116), every link
// answers 200, and the AC-112 band at 390 / 1280 / 1440 / 1920.
import { test, expect, BASE, setLang } from './pw';

test('/demo: hero, film request, poster, captions, step cards, links, band', async ({ page, guard, lang, request }: any, info: any) => {
  const media: string[] = [];
  page.on('response', (r: any) => { if (/\.(mp4|vtt|jpe?g|png|webp|avif)(\?|$)/.test(r.url())) media.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/demo`);
  await expect(page.locator('h1').first()).toBeVisible();
  await page.waitForTimeout(2500);
  await guard.check('demo');
  await setLang(page, lang);
  await page.waitForTimeout(500);
  await guard.check(`demo-${lang}`);
  // the player, or its designed error state (this Chromium has no H.264 decoder)
  const player = page.locator('video').first();
  const errorState = page.getByText(/No pud|could not|couldn't|can't play|no se puede/i).first();
  await expect.poll(async () => (await player.isVisible()) || (await errorState.isVisible()), { message: 'AC-114 the player or its designed error state shows in the hero' }).toBe(true);
  const film = await request.get(`${BASE}/demo/thesaurus-launch.mp4`, { headers: { Range: 'bytes=0-1023' } });
  expect([200, 206], `AC-111 film request ${film.status()}`).toContain(film.status());
  await page.waitForTimeout(1500);
  const poster = media.find((m) => /\.(jpe?g|png|webp|avif)/.test(m) && /poster|launch|film|video/i.test(m));
  expect.soft(poster, `AC-114 poster request answered 200 (media seen: ${JSON.stringify(media)})`).toMatch(/^200 /);
  const vttUrl = await page.evaluate(() => (Array.from(document.querySelectorAll('track')) as any[]).find((x) => x.srclang === 'en')?.src);
  const vttGuess = vttUrl || media.find((m) => /\.vtt/.test(m))?.split(' ')[1] || `${BASE}/demo/thesaurus-launch.en.vtt`;
  expect.soft(vttGuess, `AC-111 English captions track (media seen: ${JSON.stringify(media)})`).toBeTruthy();
  if (vttGuess) { const vtt = await request.get(vttGuess); expect.soft(vtt.status()).toBe(200); expect.soft(await vtt.text()).toMatch(/^WEBVTT/); }
  // step cards
  expect(await page.locator('main ol li, [data-step], .step-card').count(), 'step cards').toBeGreaterThanOrEqual(3);
  // every link answers 200
  const links: string[] = await page.$$eval('a[href]', (as: any[]) => [...new Set(as.map((a) => a.href).filter((h: string) => /^https?:/.test(h)))]);
  const bad: string[] = [];
  for (const l of links) { const r = await request.get(l, { maxRedirects: 5, timeout: 20000 }).catch((e: any) => ({ status: () => String(e).slice(0, 60) })); if (r.status() !== 200) bad.push(`${r.status()} ${l}`); }
  expect(bad, `links on /demo (${links.length})`).toEqual([]);
  // AC-112 demo band: min(1280, W - 2P), equal margins
  const widths = info.project.name.startsWith('m390') ? [390] : [1280, 1440, 1920];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(300);
    const b = await page.evaluate(() => { const e = document.querySelector('[data-band]') as HTMLElement; const r = e.getBoundingClientRect(), s = getComputedStyle(e); const x = r.left + parseFloat(s.paddingLeft); const wd = r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight); return { x, wd, right: innerWidth - x - wd }; });
    const exp = ({ 390: [24, 342], 1440: [80, 1280], 1920: [320, 1280] } as any)[w];
    if (exp) { expect.soft(Math.abs(b.x - exp[0]), `band at ${w}: ${JSON.stringify(b)} expected x ${exp[0]} width ${exp[1]}`).toBeLessThanOrEqual(2); expect.soft(Math.abs(b.wd - exp[1]), `band width at ${w}`).toBeLessThanOrEqual(2); }
    else { expect.soft(Math.abs(b.x - b.right), `band centred at ${w}: ${JSON.stringify(b)}`).toBeLessThanOrEqual(2); expect.soft(b.x, `side gutter at ${w} <= 80`).toBeLessThanOrEqual(80); }
  }
});
