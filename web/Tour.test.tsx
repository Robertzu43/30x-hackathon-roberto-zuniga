import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import Tour from './components/Tour';
import { useT } from './i18n';
import { tourSteps } from './tour-steps';
import { renderAt } from './test/utils';

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

test('step 1 (Bandeja) in es presents the agent, its six-stage loop and the 5-minute cron (AC-66)', async () => {
  setup();
  expect(await screen.findByRole('heading', { name: 'Bandeja' })).toBeTruthy();
  const dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain('percibe → lee → consulta sus herramientas → decide → actúa → rinde cuentas');
  expect(dialog.textContent).toContain('cada 5 minutos');
  expect(dialog.textContent).toContain('1 de 7');
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

test('step 1 (Bandeja) carries the AI/code sentence, after the six stages (AC-79, AC-66)', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  const text = screen.getByRole('dialog').textContent!;
  expect(text).toContain(WHERE);
  expect(text).toContain('percibe → lee → consulta sus herramientas → decide → actúa → rinde cuentas');
});

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

// AC-91 items 1 and 5 (UX pass 1): at 360 px the step 1 card grew under the top bar. The AI/code sentence stays verbatim
// (AC-79 puts it in step 1); everything else in step 1 is the loop and the 5-minute check, in at most 35 words.
const WHERE_EN = 'Where the AI acts: it reads each invoice (Amazon Nova Lite on AWS Bedrock) and answers your questions about the record ("Ask Thesaurus"). Where code decides: the 13 rules, the consequence table and the day\'s exchange rate; only code can write PAY.';
const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;

test('step 1 is the loop, the 5-minute check and the AI/code sentence, with at most 35 other words, in es and en', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  const body = () => screen.getByRole('dialog').querySelector('p:not(.muted)')!.textContent!;
  expect(body()).toContain('cada 5 minutos');
  expect(words(body().replace(WHERE, ''))).toBeLessThanOrEqual(35);
  fireEvent.click(screen.getByRole('button', { name: 'to-en' }));
  await screen.findByRole('heading', { name: 'Inbox' });
  expect(body()).toContain(WHERE_EN);
  expect(body()).toContain('perceives → reads → consults its tools → decides → acts → accounts for it');
  expect(body()).toContain('every 5 minutes');
  expect(words(body().replace(WHERE_EN, ''))).toBeLessThanOrEqual(35);
});

test('the card is capped below the top bar; only its text scrolls, so the counter, title and buttons stay on screen', async () => {
  const bar = document.body.appendChild(Object.assign(document.createElement('header'), { className: 'topbar' }));
  vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ bottom: 212 } as DOMRect);
  setup();
  await screen.findByRole('heading', { name: 'Bandeja' });
  expect(screen.getByRole('dialog').style.getPropertyValue('--tour-top')).toBe('212px');
  expect(screen.getByRole('dialog').querySelector('p:not(.muted)')!.getAttribute('tabindex')).toBe('0'); // axe scrollable-region-focusable
  bar.remove();
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  const css = readFileSync('web/styles.css', 'utf8');
  const card = css.match(/\n\.tour-card \{([^}]*)\}/)?.[1] ?? '';
  expect(card).toMatch(/max-height: calc\(100dvh - var\(--tour-top, 0px\) - 3rem\)/); // 1rem gap above, 2rem bottom offset
  expect(card).toMatch(/display: flex/);
  expect(css).toMatch(/\.tour-card > p:not\(\.muted\) \{[^}]*overflow-y: auto/);
});
