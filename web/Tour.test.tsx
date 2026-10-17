import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Tour from './components/Tour';
import { FirstRunProvider, markFirstRun } from './firstRun';
import { useT } from './i18n';
import { tourSteps } from './tour-steps';
import { mockApi, renderAt, signedInAs } from './test/utils';

const ALL = ['inbox', 'new-invoice', 'run-agent', 'invoice-row', 'policy', 'beneficiaries', 'period'];

// Mocked DOM: every route renders the anchors in `present`, and prints where we are.
function setup(present = ALL) {
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
  for (const title of ['Bandeja', 'Nueva factura', 'Ejecutar agente', 'Detalle de decisión', 'Política']) {
    await screen.findByRole('heading', { name: title });
    next();
  }
  expect(await screen.findByRole('heading', { name: 'Beneficiarios' })).toBeTruthy();
  expect(screen.getByText('at:/beneficiaries')).toBeTruthy();
  next();
  expect(await screen.findByRole('heading', { name: 'Periodo y escalado' })).toBeTruthy();
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

test('the spotlight sits on the target and dims the rest of the page', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 100, left: 40, width: 300, height: 50 } as DOMRect);
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  const spot = document.querySelector<HTMLElement>('.tour-spotlight')!;
  await waitFor(() => expect(spot.style.top).toBe('92px'));
  expect([spot.style.left, spot.style.width, spot.style.height]).toEqual(['32px', '316px', '66px']);
  expect(spot.style.boxShadow).toContain('9999px');
});

test('Escape does what "Saltar" does (R-78)', async () => {
  const onDone = setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onDone).toHaveBeenCalledOnce();
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

// AC-79: step 1 says where the AI acts and where code decides; the Detalle step names «Leído por IA» and the chat.
const WHERE = 'Dónde actúa la IA: lee cada factura (Amazon Nova Lite en AWS Bedrock) y responde tus preguntas sobre el registro («Pregúntale a Thesaurus»). Dónde decide el código: las 13 reglas, la tabla de consecuencias y la tasa de cambio del día; solo el código puede escribir PAGAR.';

test('the Detalle step names «Leído por IA» and «Pregúntale a Thesaurus», in es and en (AC-79)', async () => {
  setup();
  for (const title of ['Bandeja', 'Nueva factura', 'Ejecutar agente']) {
    await screen.findByRole('heading', { name: title });
    next();
  }
  await screen.findByRole('heading', { name: 'Detalle de decisión' });
  expect(screen.getByRole('dialog').textContent).toMatch(/«Leído por IA».*«Pregúntale a Thesaurus»/);
  fireEvent.click(screen.getByRole('button', { name: 'to-en' }));
  await screen.findByRole('heading', { name: 'Decision detail' });
  expect(screen.getByRole('dialog').textContent).toMatch(/"Read by AI".*"Ask Thesaurus"/);
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await screen.findByRole('heading', { name: 'Inbox' });
  expect(screen.getByRole('dialog').textContent).toContain('Where code decides: the 13 rules');
});

// R-105: step 1 is exactly AC-79's sentence, then the loop. Nothing else (no opener, no 5-minute sentence).
const WHERE_EN = 'Where the AI acts: it reads each invoice (Amazon Nova Lite on AWS Bedrock) and answers your questions about the record ("Ask Thesaurus"). Where code decides: the 13 rules, the consequence table and the day\'s exchange rate; only code can write PAY.';
const LOOP = 'Con cada factura, Thesaurus percibe → lee → consulta sus herramientas → decide → actúa → rinde cuentas.';
const LOOP_EN = 'With every invoice, Thesaurus perceives → reads → consults its tools → decides → acts → accounts for it.';
const body = () => screen.getByRole('dialog').querySelector('.tour-body')!;
const paras = () => [...body().querySelectorAll('p')].map((p) => p.textContent);

test('step 1 is two paragraphs, AC-79\'s sentence then the loop, in es and en (R-105, AC-79, AC-66)', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  expect(paras()).toEqual([WHERE, LOOP]);
  fireEvent.click(screen.getByRole('button', { name: 'to-en' }));
  await screen.findByRole('heading', { name: 'Inbox' });
  expect(paras()).toEqual([WHERE_EN, LOOP_EN]);
});

test('the card stacks header, a focusable scrolling body and the footer buttons (R-105)', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  const parts = [...screen.getByRole('dialog').children].map((c) => c.className || c.tagName);
  expect(parts).toEqual(['HEADER', 'tour-body', 'tour-actions']);
  expect(body().getAttribute('tabindex')).toBe('0'); // axe scrollable-region-focusable
  expect(screen.getByRole('dialog').querySelector('header')!.textContent).toBe('1 de 7Bandeja');
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
  expect(phone).toMatch(/max-height: calc\(100dvh - var\(--tour-top, 0px\) - 1\.5rem\)/);
  expect(css).not.toMatch(/\.tour-body[^{]*\{[^}]*font-size/);
});

// UX-03: at 390 the bottom-sheet card covered step 1's highlighted block. jsdom has no layout: the target, the top bar
// (bottom 60) and the card (top 420, full width) are stubbed; scrollBy is spied.
function stubLayout(target: { top: number; height: number; left?: number; width?: number }, cardLeft = 12) {
  const bar = document.body.appendChild(Object.assign(document.createElement('header'), { className: 'topbar' }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const box = (top: number, left: number, width: number, height: number) => ({ top, left, width, height, bottom: top + height, right: left + width }) as DOMRect;
    if (this === bar) return box(0, 0, 390, 60);
    if (this.dataset.tour === 'inbox') return box(target.top, target.left ?? 16, target.width ?? 358, target.height);
    if (this.classList.contains('tour-card')) return box(420, cardLeft, 366, 400);
    return box(0, 0, 0, 0);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('tour-card') ? 420 : 0; });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('tour-card') ? 400 : 0; });
  const scroll = vi.fn();
  vi.stubGlobal('scrollBy', scroll);
  return { scroll, done: () => bar.remove() };
}

test('a block taller than the room above the card scrolls its start under the top bar, and the spotlight stops above the card (UX-03)', async () => {
  const { scroll, done } = stubLayout({ top: 300, height: 600 });
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  await waitFor(() => expect(scroll).toHaveBeenCalledWith(0, 300 - 68)); // room: 60 + 8 to 420 - 8
  const spot = document.querySelector<HTMLElement>('.tour-spotlight')!;
  expect(spot.style.top).toBe('292px');
  expect(spot.style.height).toBe(`${412 - 292}px`); // never under the card
  done();
});

test('a block that fits is centred in the room between the top bar and the card, unclipped (UX-03)', async () => {
  const { scroll, done } = stubLayout({ top: 500, height: 100 });
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  await waitFor(() => expect(scroll).toHaveBeenCalledWith(0, 500 - (68 + (344 - 100) / 2)));
  expect(document.querySelector<HTMLElement>('.tour-spotlight')!.style.height).toBe('116px');
  done();
});

test('a block beside the card (wide screens) is left where it is (UX-03)', async () => {
  const { scroll, done } = stubLayout({ top: 500, height: 100, left: 16, width: 300 }, 400);
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  await new Promise((r) => setTimeout(r, 50));
  expect(scroll).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLElement>('.tour-spotlight')!.style.height).toBe('116px');
  done();
});

// UX-03 (AC-91 item 4): the spotlight is re-measured in the same frame as the scroll, so it never paints at the old
// place and then jumps (the gate measured CLS 0.27 at 360 when it waited for the scroll event).
test('after scrolling the block into the room, the spotlight already sits on its new place, without a scroll event', async () => {
  let offset = 0;
  const { done } = stubLayout({ top: 300, height: 600 });
  const box = HTMLElement.prototype.getBoundingClientRect as unknown as { getMockImplementation(): (this: HTMLElement) => DOMRect };
  const base = box.getMockImplementation();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const r = base.call(this);
    return this.dataset.tour === 'inbox' ? ({ ...r, top: r.top - offset, bottom: r.bottom - offset }) as DOMRect : r;
  });
  vi.stubGlobal('scrollY', 0);
  vi.stubGlobal('scrollBy', (_x: number, y: number) => { offset += y; vi.stubGlobal('scrollY', offset); });
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  await waitFor(() => expect(document.querySelector<HTMLElement>('.tour-spotlight')!.style.top).toBe('60px')); // 68 - PAD
  expect(offset).toBe(232); // one scroll, then it stops
  done();
});

// AC-42 Clarified (D42, R-144): the tour starts on landing while the first-login pass runs, and its spotlight is re-measured
// after each refresh of the screen data. jsdom has no layout: the row's box is stubbed, and a click stands in for a refresh.
test('with a pass running, step 1 shows at once; at step 4 a batch refresh re-measures the row\'s spotlight, with no scroll or resize', async () => {
  signedInAs('ana@empresa.co');
  markFirstRun();
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
  for (const title of ['Nueva factura', 'Ejecutar agente', 'Detalle de decisión']) {
    next();
    await screen.findByRole('heading', { name: title });
  }
  const spot = () => document.querySelector<HTMLElement>('.tour-spotlight')!.style.top;
  await waitFor(() => expect(spot()).toBe('92px'));
  fireEvent.click(screen.getByRole('button', { name: 'lote' })); // the chip changes in place; the box is the same
  await new Promise((r) => setTimeout(r, 20));
  expect(spot()).toBe('92px');
  top = 140; // had something moved the row, the next refresh puts the spotlight back on it
  fireEvent.click(screen.getByRole('button', { name: 'lote' }));
  await waitFor(() => expect(spot()).toBe('132px'));
});
