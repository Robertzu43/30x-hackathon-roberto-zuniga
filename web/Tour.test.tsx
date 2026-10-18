import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, onTestFinished, test, vi } from 'vitest';
import { useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Tour from './components/Tour';
import { FirstRunProvider, markFirstRun } from './firstRun';
import { useT } from './i18n';
import { anchor, tourSteps } from './tour-steps';
import InvoiceTable, { type Row } from './dashboard/InvoiceTable';
import Policy from './pages/Policy';
import Beneficiaries from './pages/Beneficiaries';
import Period from './pages/Period';
import { mockApi, renderAt, signedInAs } from './test/utils';

const ALL = ['inbox', 'new-invoice', 'run-agent', 'invoice-row', 'policy', 'beneficiaries', 'period'];

// Mocked DOM: every route renders the anchors in `present`, and prints where we are.
function setup(present = [...ALL, 'inbox-title', 'invoice-open']) { // + the phone anchors (tour-steps.ts)
  const onDone = vi.fn();
  function Page() {
    return (
      <>
        <p>at:{useLocation().pathname}</p>
        {present.map((a) => <div key={a} data-tour={a} />)}
      </>
    );
  }
  renderAt(
    <>
      <button type="button" data-tour-opener="">Ver tutorial</button>
      <Routes><Route path="*" element={<Page />} /></Routes>
      <Tour onDone={onDone} />
      <LangSwitch />
    </>,
  );
  return onDone;
}
function LangSwitch() {
  const { setLang } = useT();
  return <button type="button" onClick={() => setLang('en')}>to-en</button>;
}
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

test('7 steps, one per area, each anchored on a data-tour selector (AC-42)', () => {
  expect(tourSteps.map((s) => s.selector)).toEqual(ALL.map((a) => `[data-tour="${a}"]`));
});

test('"Siguiente" advances to step 2 and "Atrás" returns to step 1', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  next();
  expect(await screen.findByRole('heading', { name: 'Nueva factura' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Atrás' }));
  expect(await screen.findByRole('heading', { name: 'Bandeja' })).toBeTruthy();
});

test('"Saltar" calls onDone', async () => {
  const onDone = setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  fireEvent.click(screen.getByRole('button', { name: 'Saltar' }));
  expect(onDone).toHaveBeenCalledOnce();
});

test('the tour navigates to each step route and "Terminar" on the last step calls onDone', async () => {
  const onDone = setup();
  for (const title of ['Bandeja', 'Nueva factura', 'Ejecutar agente', 'Detalle de factura', 'Política']) {
    await screen.findByRole('heading', { name: title });
    next();
  }
  expect(await screen.findByRole('heading', { name: 'Beneficiarios' })).toBeTruthy();
  expect(screen.getByText('at:/beneficiaries')).toBeTruthy();
  next();
  expect(await screen.findByRole('heading', { name: 'Periodo' })).toBeTruthy();
  expect(screen.getByText('at:/period')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Terminar' }));
  expect(onDone).toHaveBeenCalledOnce();
});

test('language en renders English titles and buttons', async () => {
  localStorage.setItem('lang', 'en');
  setup();
  expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('heading', { name: 'New invoice' })).toBeTruthy();
});

test('a step whose anchor is missing is skipped instead of breaking the tour', async () => {
  setup(ALL.filter((a) => a !== 'new-invoice'));
  await screen.findByRole('heading', { name: 'Bandeja' });
  next();
  expect(await screen.findByRole('heading', { name: 'Ejecutar agente' }, { timeout: 3000 })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Nueva factura' })).toBeNull();
});

// AC-117 4.spot / 4.dim: the lit area H is the target grown by p = 10 on every side, and it is the one dim layer (its shadow).
test('the lit area is the target grown by 10 px, and it is the only dim layer (AC-117)', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 100, left: 40, width: 300, height: 50, bottom: 150, right: 340 } as DOMRect);
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  const spot = document.querySelector<HTMLElement>('[data-tour-hole]')!;
  await waitFor(() => expect(spot.style.translate).toBe('30px 90px'));
  expect([spot.style.width, spot.style.height]).toEqual(['320px', '70px']);
  expect(document.querySelectorAll('[data-tour-dim]')).toHaveLength(1);
  expect(spot.hasAttribute('data-tour-dim')).toBe(true);
  expect(spot.style.boxShadow).toContain('rgba(0,0,0,.6)');
});

// R-182: no «large target» case any more. The lit area is never cut short where the card is; a target too big for the room
// is re-anchored (tour-steps.ts), not clipped.
test('no large-target case: a target taller than the room keeps its whole lit area (AC-117, R-182)', async () => {
  stubLayout({ top: 300, height: 600 }, { phone: true });
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  await waitFor(() => expect(document.querySelector<HTMLElement>('[data-tour-hole]')!.style.height).toBe('620px'));
});

// AC-117 4.target with AC-91 item 4: a skeleton (AC-99, inert) is never lit. Scrolling to it would show the loaded page replacing it
// in the viewport, a layout shift; and while it shows, the page is loading, so the step waits past WAIT_MS instead of being skipped.
test('a step waits for its loaded element: an anchor in an inert skeleton is not lit and the step is not skipped (AC-117)', async () => {
  function Loading() {
    const [loaded, setLoaded] = useState(false);
    return (
      <>
        {ALL.filter((a) => a !== 'inbox').map((a) => <div key={a} data-tour={a} />)}
        {loaded ? <div key="real" data-tour="inbox" /> : <div key="skeleton" inert><div data-tour="inbox" /></div>}
        <button type="button" onClick={() => setLoaded(true)}>loaded</button>
      </>
    );
  }
  renderAt(<><Routes><Route path="*" element={<Loading />} /></Routes><Tour onDone={() => {}} /></>);
  await new Promise((r) => setTimeout(r, 1700)); // past WAIT_MS
  expect(document.querySelector('[data-tour-hole]')).toBeNull();
  expect(document.querySelector('.tour-card')!.getAttribute('data-tour-step')).toBe('inbox'); // still step 1
  fireEvent.click(screen.getByRole('button', { name: 'loaded' }));
  await waitFor(() => expect(document.querySelector('[data-tour-hole]')).not.toBeNull());
  expect(screen.getByText('Paso 1 de 7')).toBeTruthy();
});

test('Escape does what "Saltar" does (R-78)', async () => {
  const onDone = setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onDone).toHaveBeenCalledOnce();
});

// AC-117 4.keys
const key = (k: string, shiftKey = false) => fireEvent.keyDown(document.activeElement ?? document, { key: k, shiftKey });

test('Escape closes the tour and focus returns to «Ver tutorial» (AC-117)', async () => {
  const onDone = setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  key('Escape');
  expect(onDone).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ver tutorial' }));
});

test('→ goes to the next step and ← to the previous; ← does nothing on step 1; → on step 7 does what «Terminar» does (AC-117)', async () => {
  const onDone = setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  key('ArrowLeft');
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.getByText('Paso 1 de 7')).toBeTruthy();
  key('ArrowRight');
  await screen.findByRole('heading', { name: 'Nueva factura' });
  key('ArrowLeft');
  await screen.findByRole('heading', { name: 'Bandeja' });
  for (const title of ['Nueva factura', 'Ejecutar agente', 'Detalle de factura', 'Política', 'Beneficiarios', 'Periodo']) {
    key('ArrowRight');
    await screen.findByRole('heading', { name: title });
  }
  expect(onDone).not.toHaveBeenCalled();
  key('ArrowRight');
  expect(onDone).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ver tutorial' }));
});

test('each new step moves focus to the card heading (AC-117)', async () => {
  setup();
  const first = await screen.findByRole('heading', { name: 'Bandeja' });
  await waitFor(() => expect(document.activeElement).toBe(first));
  expect(first.getAttribute('tabindex')).toBe('-1');
  next();
  const second = await screen.findByRole('heading', { name: 'Nueva factura' });
  await waitFor(() => expect(document.activeElement).toBe(second));
});

test('Tab and Shift+Tab cycle inside the card only, from anywhere (AC-117 focus trap)', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  next();
  await screen.findByRole('heading', { name: 'Nueva factura' });
  const card = screen.getByRole('dialog');
  const stops = [...card.querySelectorAll<HTMLElement>('button, [tabindex="0"]')];
  expect(stops[0]!.classList.contains('tour-body')).toBe(true);
  expect(stops.slice(1).map((s) => s.textContent)).toEqual(['Saltar', 'Atrás', 'Siguiente']);
  stops.at(-1)!.focus();
  key('Tab');
  expect(document.activeElement).toBe(stops[0]);
  key('Tab', true);
  expect(document.activeElement).toBe(stops.at(-1));
  screen.getByRole('button', { name: 'to-en' }).focus(); // a click on the top bar left focus outside the card
  key('Tab');
  expect(document.activeElement).toBe(stops[0]);
  screen.getByRole('button', { name: 'Ver tutorial' }).focus();
  key('Tab', true);
  expect(document.activeElement).toBe(stops.at(-1));
});

// jsdom has no hit-testing: these are the CSS rules that do it (Chromium is measured by the gate's 4.keys row).
test('nothing under the dim can be clicked: the tour layer spans the screen and the lit area takes the pointer (AC-117)', async () => {
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  const css = readFileSync('web/styles.css', 'utf8');
  expect(css.match(/\n\.tour \{([^}]*)\}/)?.[1]).toMatch(/position: fixed; inset: 0/);
  expect(css).not.toMatch(/\.tour \{[^}]*pointer-events: none/);
  const spot = css.match(/\.tour-spotlight \{([^}]*)\}/)?.[1] ?? '';
  expect(spot).toMatch(/pointer-events: auto/);
  expect(Number(spot.match(/border-radius: (\d+)px/)?.[1])).toBeGreaterThanOrEqual(8); // 4.spot: rounded, 8 to 16 px
  expect(Number(spot.match(/border-radius: (\d+)px/)?.[1])).toBeLessThanOrEqual(16);
});

test('a language switch during a step keeps the same step, now in the new language (R-78)', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  next();
  await screen.findByRole('heading', { name: 'Nueva factura' });
  fireEvent.click(screen.getByRole('button', { name: 'to-en' }));
  expect(await screen.findByRole('heading', { name: 'New invoice' })).toBeTruthy();
  expect(screen.getByRole('dialog').textContent).toContain('2 of 7');
});

// jsdom has no stacking or hit-testing; Chromium was checked by hand (task 11d report). This guards the rule that does it.
test('while the tour is shown, the top bar sits above the dim layer and stays on screen (R-78)', async () => {
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  const css = readFileSync('web/styles.css', 'utf8');
  const rule = css.match(/body:has\(\.tour\) \.topbar \{([^}]*)\}/)?.[1] ?? '';
  expect(rule).toMatch(/position: sticky/);
  expect(Number(rule.match(/z-index: (\d+)/)?.[1])).toBeGreaterThan(Number(css.match(/\.tour \{[^}]*z-index: (\d+)/)?.[1]));
});

// AC-118 (R-183): the tour names no vendor, model or loop; the copy is docs/COPY.md «Guided tour», verbatim. AC-79 and AC-66 stay on /demo.
const INBOX = 'Aquí llegan todas tus facturas, cada una con lo que decidió Thesaurus. Empieza por las que necesitan tu respuesta.';
const INBOX_EN = 'All your invoices land here, each with what Thesaurus decided. Start with the ones that need your answer.';
const DETAIL = 'Abre una factura para ver qué leyó Thesaurus, cada regla que revisó y por qué decidió así. Si dudas, pregúntale ahí mismo.';
const DETAIL_EN = 'Open an invoice to see what Thesaurus read, every rule it checked and why it decided that way. If in doubt, ask it right there.';
const body = () => screen.getByRole('dialog').querySelector('.tour-body')!;
const paras = () => [...body().querySelectorAll('p')].map((p) => p.textContent);

test('the Detalle step is «Detalle de factura» and names no model, in es and en (AC-118)', async () => {
  setup();
  for (const title of ['Bandeja', 'Nueva factura', 'Ejecutar agente']) {
    await screen.findByRole('heading', { name: title });
    next();
  }
  await screen.findByRole('heading', { name: 'Detalle de factura' });
  expect(paras()).toEqual([DETAIL]);
  fireEvent.click(screen.getByRole('button', { name: 'to-en' }));
  await screen.findByRole('heading', { name: 'Invoice detail' });
  expect(paras()).toEqual([DETAIL_EN]);
});

test('step 1 is one paragraph with no loop line, in es and en (AC-118, R-105)', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  expect(paras()).toEqual([INBOX]);
  fireEvent.click(screen.getByRole('button', { name: 'to-en' }));
  await screen.findByRole('heading', { name: 'Inbox' });
  expect(paras()).toEqual([INBOX_EN]);
});

test('the card stacks header, a focusable scrolling body and the footer buttons (R-105)', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  const parts = [...screen.getByRole('dialog').children].map((c) => c.className || c.tagName);
  expect(parts).toEqual(['HEADER', 'tour-body', 'tour-actions']);
  expect(body().getAttribute('tabindex')).toBe('0'); // axe scrollable-region-focusable
  expect(screen.getByRole('dialog').querySelector('header')!.textContent).toBe('Paso 1 de 7Bandeja');
});

// jsdom has no layout: the body's scrollHeight / clientHeight are stubbed.
function stubBody(scrollHeight: number, clientHeight: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('tour-body') ? scrollHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('tour-body') ? clientHeight : 0;
  });
}
const CUE = 'Desliza para ver más';

test('the scroll cue shows while the body overflows and hides once scrolled to the end (R-105)', async () => {
  stubBody(400, 200);
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  expect(await screen.findByText(CUE)).toBeTruthy();
  body().scrollTop = 200;
  fireEvent.scroll(body());
  await waitFor(() => expect(screen.queryByText(CUE)).toBeNull());
  vi.restoreAllMocks();
});

test('no scroll cue when the text fits; the cue is English in en (R-105)', async () => {
  stubBody(200, 200);
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  expect(screen.queryByText(CUE)).toBeNull();
  vi.restoreAllMocks();
  stubBody(400, 200);
  fireEvent.click(screen.getByRole('button', { name: 'to-en' }));
  expect(await screen.findByText('Scroll for more')).toBeTruthy();
  vi.restoreAllMocks();
});

test('the card is capped below the top bar; at <= 480 px it is a bottom sheet, body text never shrunk (R-105)', async () => {
  const bar = document.body.appendChild(Object.assign(document.createElement('header'), { className: 'topbar' }));
  vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ bottom: 212 } as DOMRect);
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  expect(screen.getByRole('dialog').style.getPropertyValue('--tour-top')).toBe('212px');
  bar.remove();
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  const css = readFileSync('web/styles.css', 'utf8');
  const card = css.match(/\n\.tour-card \{([^}]*)\}/)?.[1] ?? '';
  expect(card).toMatch(/max-height: calc\(100dvh - var\(--tour-top, 0px\) - 3rem\)/);
  expect(card).toMatch(/display: flex/);
  expect(css).toMatch(/\.tour-body \{[^}]*overflow-y: auto/);
  const phone = css.match(/@media \(max-width: 480px\) \{\s*\.tour-card \{([^}]*)\}/)?.[1] ?? '';
  expect(phone).toMatch(/bottom: calc\(0\.75rem \+ env\(safe-area-inset-bottom\)\)/);
  expect(phone).toMatch(/left: 0\.75rem/);
  expect(phone).toMatch(/width: calc\(100vw - 1\.5rem\)/);
  expect(phone).toMatch(/padding: 1rem 1\.25rem/);
  expect(phone).toMatch(/max-height: calc\(\(100dvh - var\(--tour-top, 0px\)\) \/ 2 - 1rem\)/); // AC-115 (R-170): at most half the room under the bar
  expect(css).not.toMatch(/\.tour-body[^{]*\{[^}]*font-size/);
});

// AC-117 4.target / 4.cover. The lit area and the card are moved with `translate`, never top/left: a transform is not a layout shift,
// so following the target never counts against AC-91 item 4 (CLS). jsdom has no layout: the top bar (bottom 60), the step-1 target and the card are stubbed, and
// scrollBy moves the target. Desktop is jsdom's 1024 x 768; `phone` is 390 x 844 with the card pinned at top 500 by CSS.
function stubLayout(target: { top: number; height: number; left?: number; width?: number }, { phone = false } = {}) {
  let offset = 0;
  const vp = phone ? { w: 390, h: 844 } : { w: 1024, h: 768 };
  vi.stubGlobal('innerWidth', vp.w);
  vi.stubGlobal('innerHeight', vp.h);
  const card = phone ? { top: 500, width: 366, height: 330 } : { top: 0, width: 400, height: 200 };
  const bar = document.body.appendChild(Object.assign(document.createElement('header'), { className: 'topbar' }));
  const box = (top: number, left: number, width: number, height: number) => ({ top, left, width, height, bottom: top + height, right: left + width }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === bar) return box(0, 0, vp.w, 60);
    if (this.dataset.tour?.startsWith('inbox')) return box(target.top - offset, target.left ?? 16, target.width ?? 358, target.height);
    return box(0, 0, 0, 0);
  });
  const stub = (prop: 'offsetTop' | 'offsetWidth' | 'offsetHeight', v: number) =>
    vi.spyOn(HTMLElement.prototype, prop, 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('tour-card') ? v : 0; });
  stub('offsetTop', card.top);
  stub('offsetWidth', card.width);
  stub('offsetHeight', card.height);
  const scroll = vi.fn(({ top }: { top: number }) => void (offset += top));
  vi.stubGlobal('scrollBy', scroll);
  onTestFinished(() => { bar.remove(); });
  return { scroll, move: (dy: number) => void (offset += dy) };
}
const hole = () => document.querySelector<HTMLElement>('[data-tour-hole]')!;
const y = (e: HTMLElement) => e.style.translate.split(' ')[1];

test('before a step shows, the target is scrolled into view and the card goes below the lit area, 8 px from it (AC-117 4.target, 4.cover)', async () => {
  const { scroll, move } = stubLayout({ top: 900, height: 50, left: 40, width: 300 });
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  // the room runs from the bar + 8 (68) to the bottom - 16 (752); H (70 tall) and the card (200) 8 px under it are centred in it
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ top: 900 - (68 + (684 - 278) / 2 + 10), behavior: 'instant' }));
  await waitFor(() => expect(y(hole())).toBe('271px'));
  const card = screen.getByRole('dialog');
  expect([card.style.top, card.style.left, card.style.translate]).toEqual(['0px', '0px', `16px ${271 + 70 + 8}px`]);
  move(40); // the reader scrolls: H follows T, and the card follows H (R-144)
  fireEvent.scroll(window);
  await waitFor(() => expect(y(hole())).toBe('231px'));
  expect(y(card)).toBe(`${231 + 70 + 8}px`);
  expect(scroll).toHaveBeenCalledOnce(); // the tour scrolls once, before the step shows; it never fights the reader
});

test('a target replaced under the step (the skeleton table swapped for the loaded one) is scrolled into view again (AC-117 4.target)', async () => {
  const { scroll, move } = stubLayout({ top: 900, height: 50, left: 40, width: 300 });
  function Swap() {
    const [k, setK] = useState(0);
    return (
      <>
        {ALL.filter((a) => a !== 'inbox').map((a) => <div key={a} data-tour={a} />)}
        <div key={k} data-tour="inbox" />
        <button type="button" onClick={() => setK(k + 1)}>swap</button>
      </>
    );
  }
  renderAt(<><Routes><Route path="*" element={<Swap />} /></Routes><Tour onDone={() => {}} /></>);
  await waitFor(() => expect(scroll).toHaveBeenCalledOnce());
  move(-500); // the loaded page is taller: the new element sits 500 px lower
  fireEvent.click(screen.getByRole('button', { name: 'swap' }));
  await waitFor(() => expect(scroll).toHaveBeenLastCalledWith({ top: 500, behavior: 'instant' }));
  expect(document.querySelector('.tour-card')!.getAttribute('data-tour-step')).toBe('inbox');
});

test('at <= 480 px the card is pinned to the bottom and the target is scrolled to sit above it (AC-117, R-105)', async () => {
  const { scroll } = stubLayout({ top: 900, height: 100 }, { phone: true });
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  // the room runs from the bar + 8 (68) to the card's top - 8 (492); H (120 tall) is centred in it
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ top: 900 - (68 + (424 - 120) / 2 + 10), behavior: 'instant' }));
  await waitFor(() => expect(y(hole())).toBe('220px'));
  expect(screen.getByRole('dialog').style.translate).toBe(''); // the CSS bottom sheet
  expect(screen.getByRole('dialog').getAttribute('data-tour-step')).toBe('inbox-title'); // the element lit at this width (4.tourcover reads it)
});

// AC-42 Clarified (D42, R-144): the tour starts on landing while the first-login pass runs, and its spotlight is re-measured
// after each refresh of the screen data. jsdom has no layout: the row's box is stubbed, and a click stands in for a refresh.
test('with a pass running, step 1 shows at once; at step 4 a batch refresh re-measures the row\'s spotlight, with no scroll or resize', async () => {
  signedInAs('ana@empresa.co');
  markFirstRun('id:ana@empresa.co');
  mockApi({ 'POST /api/invoices/run': () => new Promise(() => {}) });
  let top = 100;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return ({ top: this.dataset.tour === 'invoice-row' ? top : 0, left: 40, width: 300, height: 50, bottom: top + 50, right: 340 }) as DOMRect;
  });
  function Bandeja() {
    const [chip, setChip] = useState(0);
    return (
      <>
        {ALL.filter((a) => a !== 'invoice-row').map((a) => <div key={a} data-tour={a} />)}
        <div data-tour="invoice-row">{chip ? `PAGAR ${chip}` : 'Pendiente'}</div>
        <button type="button" onClick={() => setChip(chip + 1)}>lote</button>
      </>
    );
  }
  renderAt(<FirstRunProvider><Routes><Route path="*" element={<Bandeja />} /></Routes><Tour onDone={() => {}} /></FirstRunProvider>);
  await screen.findByRole('heading', { name: 'Bandeja' });
  for (const title of ['Nueva factura', 'Ejecutar agente', 'Detalle de factura']) {
    next();
    await screen.findByRole('heading', { name: title });
  }
  const spot = () => document.querySelector<HTMLElement>('.tour-spotlight')!.style.translate.split(' ')[1];
  await waitFor(() => expect(spot()).toBe('90px'));
  fireEvent.click(screen.getByRole('button', { name: 'lote' })); // the chip changes in place; the box is the same
  await new Promise((r) => setTimeout(r, 20));
  expect(spot()).toBe('90px');
  top = 140; // had something moved the row, the next refresh puts the spotlight back on it
  fireEvent.click(screen.getByRole('button', { name: 'lote' }));
  await waitFor(() => expect(spot()).toBe('130px'));
});

// AC-115 (R-170): «Paso n de m» and m dots, decoration only.
test('step 3 shows «Paso 3 de 7» and 7 aria-hidden dots, the third one active (AC-115)', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  next();
  await screen.findByRole('heading', { name: 'Nueva factura' });
  next();
  await screen.findByRole('heading', { name: 'Ejecutar agente' });
  expect(screen.getByText('Paso 3 de 7')).toBeTruthy();
  const dots = document.querySelector('.tour-dots')!;
  expect(dots.getAttribute('aria-hidden')).toBe('true');
  expect([...dots.children].map((d) => d.classList.contains('on'))).toEqual([false, false, true, false, false, false, false]);
  expect(dots.querySelector('button, a, [tabindex]')).toBeNull();
  expect(document.querySelector('.tour-card')!.getAttribute('data-tour-step')).toBe('run-agent');
});

test('English: "Step 1 of 7" (AC-115)', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  fireEvent.click(screen.getByRole('button', { name: 'to-en' }));
  expect(await screen.findByText('Step 1 of 7')).toBeTruthy();
});

// AC-117 targets (R-182): each step lights one element that holds what its title names, present before the data loads.
// At <= 480 px (the bottom-sheet card) two of them do not fit above the card, so a smaller element that holds the named thing is lit.
test('at <= 480 px step 1 lights the «Facturas» title and step 4 the first row\'s invoice; elsewhere the AC-117 targets (R-182)', () => {
  const at = (w: number) => tourSteps.map((s) => anchor(s, w));
  expect(at(481)).toEqual(ALL);
  expect(at(480)).toEqual(ALL.map((a) => ({ inbox: 'inbox-title', 'invoice-row': 'invoice-open' })[a] ?? a));
});

const ROWS: Row[] = [
  { id: 'a1', outcome: 'PAGAR', headline: 'PAGAR · 160 USD a Northstar Group', received_at: '2026-10-16T10:00:00Z', amount_usd: 160, fields: { payee_name: 'Northstar Group' }, origin: 'portal' },
  { id: 'a2', outcome: 'FRENAR', headline: 'FRENAR · 90 USD a Forma Studio', received_at: '2026-10-15T10:00:00Z', amount_usd: 90, fields: { payee_name: 'Forma Studio' }, origin: 'app' },
];

test('Bandeja: step 1 is the «Facturas» header (title, search, filters), step 4 the first row (AC-117 targets 1 and 4)', () => {
  renderAt(<InvoiceTable rows={ROWS} directory={[]} outcome="" onOutcome={() => {}} />);
  const head = document.querySelector('[data-tour="inbox"]')!;
  expect(head.querySelector('h2')!.textContent).toBe('Facturas');
  expect(head.querySelectorAll('input[type="search"]')).toHaveLength(1);
  expect(head.querySelectorAll('select')).toHaveLength(3);
  expect(head.querySelector('table')).toBeNull();
  expect(document.querySelector('[data-tour="inbox-title"]')).toBe(head.querySelector('h2'));
  const first = document.querySelector('tbody tr')!;
  expect(document.querySelector('[data-tour="invoice-row"]')).toBe(first);
  const open = document.querySelector('[data-tour="invoice-open"]')!;
  expect(first.contains(open)).toBe(true);
  expect(open.querySelector('a')!.getAttribute('href')).toBe('/invoices/a1');
  expect(open.textContent).toContain('Portal');
});

test('Política and Beneficiarios: the h1 with its intro line, and nothing else (AC-117 targets 5 and 6)', () => {
  for (const [Page, title] of [[Policy, 'Política'], [Beneficiaries, 'Beneficiarios']] as const) {
    const { unmount } = renderAt(<Page />);
    const t = document.querySelector('[data-tour]')!;
    expect(t.children).toHaveLength(2);
    expect(t.querySelector('h1')!.textContent).toBe(title);
    expect(t.children[1]!.tagName).toBe('P');
    expect(document.querySelectorAll('[data-tour]')).toHaveLength(1);
    unmount();
  }
});

test('Periodo: the «Dinero del mes» block, before its data loads (AC-117 target 7)', () => {
  mockApi({ [`GET /api/screen/period?month=${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7)}`]: () => new Promise(() => {}) });
  renderAt(<Period />, { at: '/period' });
  const t = document.querySelector('[data-tour="period"]')!;
  expect(t.querySelector('h2')!.textContent).toBe('Dinero del mes');
  expect(t.querySelectorAll('dl dt')).toHaveLength(5);
  expect(t.querySelector('h1')).toBeNull();
  expect(document.querySelectorAll('[data-tour]')).toHaveLength(1);
});
