import { fireEvent, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { RunProgress, useRunAgent } from './RunProgress';
import { mockApi, renderAt } from '../test/utils';

const b = (o = {}) => ({ PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null, ...o });

function Harness({ mode = 'pending' as 'pending' | 'reevaluate', onBatch = () => {} }) {
  const run = useRunAgent({ first: '/api/invoices/run', onBatch });
  return (
    <>
      <button disabled={run.running} onClick={run.start}>go</button>
      <RunProgress run={run} mode={mode} />
    </>
  );
}
const go = () => fireEvent.click(screen.getByRole('button', { name: 'go' }));

test('while running: button disabled and "Decidiendo facturas… n de m"; then the summed summary', async () => {
  let release: (v: unknown) => void = () => {};
  let calls = 0;
  const onBatch = vi.fn();
  mockApi({
    'POST /api/invoices/run': () => (calls++ === 0 ? b({ PAGAR: 2, FRENAR: 1, remaining: 2, cursor: 'a' }) : new Promise((r) => (release = r))),
  });
  renderAt(<Harness onBatch={onBatch} />);
  go();
  expect(await screen.findByText('Decidiendo facturas… 3 de 5')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'go' }) as HTMLButtonElement).disabled).toBe(true);
  release(b({ ESCALAR: 2 }));
  expect(await screen.findByText('2 PAGAR · 1 FRENAR · 2 ESCALAR')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'go' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText(/Decidiendo facturas/)).toBeNull();
  expect(onBatch).toHaveBeenCalledTimes(2);
});

test('pending mode with errors adds the R-57 line (AC-29)', async () => {
  mockApi({ 'POST /api/invoices/run': b({ PAGAR: 1, errors: 2 }) });
  renderAt(<Harness />);
  go();
  expect(await screen.findByText('No pude decidir 2 factura(s); siguen pendientes y las intentaré de nuevo en la próxima revisión automática (cada 5 minutos).')).toBeTruthy();
  expect(screen.getByText('1 PAGAR · 0 FRENAR · 0 ESCALAR')).toBeTruthy();
});

test('reevaluate mode with errors adds the AC-31 line', async () => {
  mockApi({ 'POST /api/invoices/run': b({ errors: 1 }) });
  renderAt(<Harness mode="reevaluate" />);
  go();
  expect(await screen.findByText('No pude reevaluar 1 factura(s); conservan su resultado anterior. Pulsa «Reevaluar pendientes» de nuevo.')).toBeTruthy();
});

test('no errors, no errors line', async () => {
  mockApi({ 'POST /api/invoices/run': b({ PAGAR: 1 }) });
  renderAt(<Harness />);
  go();
  await screen.findByText('1 PAGAR · 0 FRENAR · 0 ESCALAR');
  expect(screen.queryByText(/No pude/)).toBeNull();
});

test('a non-2xx shows the response error text as an alert', async () => {
  mockApi({ 'POST /api/invoices/run': new Response(JSON.stringify({ error: 'Demasiadas solicitudes' }), { status: 429 }) });
  renderAt(<Harness />);
  go();
  expect((await screen.findByRole('alert')).textContent).toBe('Demasiadas solicitudes');
});

test('English copy', async () => {
  localStorage.setItem('lang', 'en');
  mockApi({ 'POST /api/invoices/run': b({ PAGAR: 1, errors: 1 }) });
  renderAt(<Harness />);
  go();
  expect(await screen.findByText('I could not decide 1 invoice(s); they stay pending and I will try again at the next automatic check (every 5 minutes).')).toBeTruthy();
});

test('a failure after some decisions still shows the decisions that exist (R-57)', async () => {
  let n = 0;
  mockApi({
    'POST /api/invoices/run': () => (n++ === 0 ? b({ PAGAR: 4, remaining: 3, cursor: 'a' }) : new Response('{"error":"No pude ejecutar el agente ahora."}', { status: 503 })),
  });
  renderAt(<Harness />);
  go();
  expect((await screen.findByRole('alert')).textContent).toBe('No pude ejecutar el agente ahora.');
  expect(screen.getByText('4 PAGAR · 0 FRENAR · 0 ESCALAR')).toBeTruthy();
});
