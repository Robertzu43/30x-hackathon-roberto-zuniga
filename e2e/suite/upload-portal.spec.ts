/* eslint-disable @typescript-eslint/no-explicit-any -- e2e suite */
// «Nueva factura» with a PDF and an image until a decision appears (AC-9/AC-10, AC-77), then the trial company's own vendor portal at 390 px
// (AC-83..AC-86): a text message, a PDF attach (confirmation names what was read, the status link opens the status page), an image attach
// (shown, not sent: read budget), an unknown company page is friendly. Model reads per run: 3 (2 uploads + 1 portal PDF); portal sends: 2.
import path from 'node:path';
import { test, expect, t, trialDoor, INIT } from './pw';
test.describe.configure({ retries: 0 });
const FIX = path.resolve('web/public/demo/invoices');
const OUTCOME = /\b(PAGAR|FRENAR|ESCALAR|PAY|STOP|ESCALATE|HOLD)\b/;

test('Subir factura PDF + image to a decision, then the trial company portal (390)', async ({ page, browser, guard, lang }: any, info: any) => {
  test.skip(info.project.name !== 'd1440-es', 'real model reads and portal sends: once per run');
  test.setTimeout(420000);
  await trialDoor(page, guard, lang);
  const skip = page.getByRole('button', { name: t(lang, 'Saltar', 'Skip') });
  if (await skip.isVisible({ timeout: 8000 }).catch(() => false)) await skip.click();
  const portalUrl = (await page.locator('main').innerText()).match(/https:\/\/\S+/)?.[0];
  for (const file of ['01.pdf', '18.png']) {
    await page.goto(page.url().replace(/(https?:\/\/[^/]+).*/, '$1/'));
    await page.getByRole('button', { name: t(lang, 'Nueva factura', 'New invoice') }).click();
    await guard.check(`new-invoice-dialog-${file}`);
    await page.locator('input[type=file]').first().setInputFiles(path.join(FIX, file));
    await page.getByRole('button', { name: t(lang, 'Enviar al agente', 'Send to the agent') }).click();
    await expect.poll(async () => {
      const onRecord = /\/invoices\//.test(page.url()) && (await page.getByRole('heading', { name: t(lang, 'Lo que decidí', 'What I decided') }).count()) > 0;
      const inDialog = OUTCOME.test(await page.locator('[role=dialog], dialog').allInnerTexts().then((x: string[]) => x.join(' ')).catch(() => ''));
      return onRecord || inDialog;
    }, { timeout: 120000, message: `a decision appears for ${file}` }).toBe(true);
    await page.waitForTimeout(800);
    await guard.check(`decision-${file}`);
  }
  // vendor portal of this trial company at 390
  expect(portalUrl, 'the Bandeja portal card shows the company link').toBeTruthy();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-CO' });
  await ctx.addInitScript(INIT);
  const p = await ctx.newPage(); guard.watch(p);
  await p.goto(portalUrl!);
  await expect(p.locator('h1').first()).toBeVisible();
  await p.waitForTimeout(1500);
  await guard.check('portal', p);
  await p.locator('textarea').fill('Hola, ¿cuándo pagan la cuenta de cobro de octubre?');
  await p.locator('button.primary').click();
  await expect(p.locator('ol.log li').nth(1)).toBeVisible({ timeout: 60000 });
  await guard.check('portal-text-reply', p);
  await p.locator('input[type=file]').setInputFiles(path.join(FIX, '04.pdf'));
  await p.locator('button.primary').click();
  const status = p.locator('a[href*="/estado/"]').first();
  await expect(status).toBeVisible({ timeout: 120000 });
  const reply = await p.locator('ol.log').innerText();
  expect(reply, 'the confirmation names what was read (an amount or a number)').toMatch(/\d/);
  await guard.check('portal-pdf-reply', p);
  await p.locator('input[type=file]').setInputFiles(path.join(FIX, '18.png'));
  await expect(p.getByText('18.png').first(), 'the attached image is shown before sending').toBeVisible();
  await guard.check('portal-image-attached', p);
  const href = await status.getAttribute('href');
  await p.goto(new URL(href!, portalUrl!).toString());
  await expect(p.locator('h1').first()).toBeVisible();
  await guard.check('status-page', p);
  guard.allow(/http 404 GET https:\/\/[^ ]+\/qa-e2e-no-existe/);
  await p.goto(portalUrl!.replace(/[^/]+$/, 'qa-e2e-no-existe'));
  await expect(p.locator('h1, h2').first()).toBeVisible();
  expect(await p.locator('body').innerText(), 'unknown company page is friendly').not.toMatch(/Error:|stack|undefined|null|Internal/);
  await guard.check('portal-unknown', p);
  await ctx.close();
});
