import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import Tour from './components/Tour';
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
    </>,
  );
  return onDone;
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
