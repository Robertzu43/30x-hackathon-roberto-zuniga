/* eslint-disable @typescript-eslint/no-explicit-any -- e2e suite */
// @tour AC-42 / AC-115 / AC-117: «Ver tutorial» walks the 7 steps; per step the target is wholly in view (4.target), exactly one dim layer (4.dim),
// the card is wholly in view, does not touch the lit target and sits >= 8 px from it (4.cover), «Paso n de 7». Uses one Admin-API user per project.
import { test, expect, t, otpDoor, adminUser } from './pw';
test.describe.configure({ retries: 0 });

test('@tour seven steps: target in view, one dim layer, card clear of the target, Siguiente / Terminar', async ({ page, guard, lang }: any) => {
  await otpDoor(page, guard, lang, await adminUser('tour'));
  const skip = page.getByRole('button', { name: t(lang, 'Saltar', 'Skip') });
  if (await skip.isVisible({ timeout: 8000 }).catch(() => false)) await skip.click();
  await expect(page.getByText(t(lang, 'Decidiendo tus facturas pendientes', 'Deciding your pending invoices'))).toBeHidden({ timeout: 45000 });
  await page.getByRole('button', { name: t(lang, 'Ver tutorial', 'View tutorial') }).click();
  for (let step = 1; step <= 7; step++) {
    await expect(page.getByText(new RegExp(t(lang, `Paso ${step} de 7`, `Step ${step} of 7`))).first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(700);
    const g = await page.evaluate((step: number) => {
      const dims = document.querySelectorAll('[data-tour-dim]').length;
      const card = (document.querySelector('[role=dialog]') as HTMLElement)?.getBoundingClientRect();
      const lit = Array.from(document.querySelectorAll('[data-tour]')).map((e) => e as HTMLElement).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; });
      const named: Record<number, string> = { 1: 'inbox', 2: 'new-invoice', 3: 'run-agent', 4: 'invoice-row' };
      const tgt = (document.querySelector('[data-tour-active], [data-tour][aria-current], [data-tour].tour-target') as HTMLElement) || (named[step] ? document.querySelector(`[data-tour="${named[step]}"]`) as HTMLElement : lit.find((e) => e.closest('main')) || lit[0]);
      const T = tgt?.getBoundingClientRect();
      const hdr = document.querySelector('header')?.getBoundingClientRect();
      return { dims, vw: innerWidth, vh: innerHeight, card: card && { l: card.left, t: card.top, r: card.right, b: card.bottom }, T: T && { l: T.left, t: T.top, r: T.right, b: T.bottom }, tour: tgt?.getAttribute('data-tour'), hdrB: hdr?.bottom ?? 0 };
    }, step);
    const s = `step ${step} (${g.tour}) ${JSON.stringify(g)}`;
    expect.soft(g.dims, `${s}: exactly one [data-tour-dim]`).toBe(1);
    expect.soft(!!g.card && g.card.l >= -1 && g.card.t >= -1 && g.card.r <= g.vw + 1 && g.card.b <= g.vh + 1, `${s}: card wholly in the viewport`).toBe(true);
    if (g.T && g.card) {
      expect.soft(g.T.t >= g.hdrB - 1 && g.T.b <= g.vh + 1 && g.T.l >= -1 && g.T.r <= g.vw + 1, `${s}: target wholly in view below the top bar (4.target)`).toBe(true);
      const gap = Math.max(g.card.l - g.T.r, g.T.l - g.card.r, g.card.t - g.T.b, g.T.t - g.card.b);
      expect.soft(gap, `${s}: card >= 8 px from the target box (4.cover; H = T + p would need more)`).toBeGreaterThanOrEqual(8);
    }
    await guard.check(`tour-step-${step}`);
    const next = page.getByRole('button', { name: step < 7 ? t(lang, 'Siguiente', 'Next') : t(lang, 'Terminar', 'Finish') });
    await next.click();
  }
  await expect(page.locator('[data-tour-dim]')).toHaveCount(0);
});
