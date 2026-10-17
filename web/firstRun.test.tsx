// The first-login pass belongs to the app shell (AC-107, AC-40 and AC-92 Amended): started by the entry's tab flag, it survives
// navigation, resumes after a reload while the flag is set, runs once per tab, and clears the flag when it ends.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { expect, test } from 'vitest';
import { FIRST_RUN, FirstRunProvider, markFirstRun, useFirstRun } from './firstRun';
import { mockApi, renderAt, signedInAs } from './test/utils';

const batch = (o = {}) => ({ PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null, ...o });
const runCalls = (f: ReturnType<typeof mockApi>) => f.mock.calls.filter(([u, i]) => u === '/api/invoices/run' && i?.method === 'POST');

function Probe() {
  const p = useFirstRun();
  const state = p.running ? `running ${p.progress?.n ?? 0} de ${p.progress?.m ?? '…'}` : p.result ? `done ${p.result.PAGAR} ${p.result.error ?? ''}` : 'idle';
  return <p>{`${state.trim()} · lotes ${p.batches}`}</p>;
}
const app = (at = '/') =>
  renderAt(
    <StrictMode>
      <FirstRunProvider>
        <Routes>
          <Route path="/" element={<><Probe /><Link to="/policy">Política</Link></>} />
          <Route path="/policy" element={<><Probe /><Link to="/">Bandeja</Link></>} />
        </Routes>
      </FirstRunProvider>
    </StrictMode>,
    { at },
  );

test('the flag starts one pass for the signed-in user; it shows n de m, counts batches and clears the flag at the end', async () => {
  signedInAs('ana@empresa.co');
  markFirstRun();
  let release: (v: unknown) => void = () => {};
  const f = mockApi({ 'POST /api/invoices/run': () => (runCalls(f).length === 1 ? batch({ PAGAR: 5, remaining: 24, cursor: 'c1' }) : new Promise((r) => (release = r))) });
  app();
  expect(await screen.findByText('running 5 de 29 · lotes 1')).toBeTruthy();
  expect(sessionStorage.getItem(FIRST_RUN)).toBe('1');
  release(batch({ PAGAR: 24 }));
  expect(await screen.findByText('done 29 · lotes 2')).toBeTruthy();
  expect(sessionStorage.getItem(FIRST_RUN)).toBeNull();
  expect(runCalls(f)).toHaveLength(2); // StrictMode's double effect started no second loop
});

test('no flag, no pass', async () => {
  signedInAs('ana@empresa.co');
  const f = mockApi({ 'POST /api/invoices/run': batch() });
  app();
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.getByText('idle · lotes 0')).toBeTruthy();
  expect(runCalls(f)).toHaveLength(0);
});

test('a flag with no session runs nothing', async () => {
  markFirstRun();
  const f = mockApi({ 'POST /api/invoices/run': batch() });
  app();
  await new Promise((r) => setTimeout(r, 50));
  expect(runCalls(f)).toHaveLength(0);
  expect(sessionStorage.getItem(FIRST_RUN)).toBe('1');
});

test('moving to another screen neither stops nor restarts the pass', async () => {
  signedInAs('ana@empresa.co');
  markFirstRun();
  let release: (v: unknown) => void = () => {};
  const f = mockApi({ 'POST /api/invoices/run': () => (runCalls(f).length === 1 ? batch({ PAGAR: 1, remaining: 2, cursor: 'c1' }) : new Promise((r) => (release = r))) });
  app();
  await screen.findByText('running 1 de 3 · lotes 1');
  fireEvent.click(screen.getByRole('link', { name: 'Política' }));
  expect(await screen.findByRole('link', { name: 'Bandeja' })).toBeTruthy();
  expect(screen.getByText('running 1 de 3 · lotes 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Bandeja' }));
  release(batch({ PAGAR: 2 }));
  expect(await screen.findByText('done 3 · lotes 2')).toBeTruthy();
  expect(runCalls(f)).toHaveLength(2);
});

test('a reload (a fresh mount) while the flag is set resumes the pass', async () => {
  signedInAs('ana@empresa.co');
  markFirstRun();
  const f = mockApi({ 'POST /api/invoices/run': () => new Promise(() => {}) }); // the tab closes before the first call answers
  const first = app();
  await waitFor(() => expect(runCalls(f)).toHaveLength(1));
  first.unmount();
  mockApi({ 'POST /api/invoices/run': batch({ FRENAR: 2 }) });
  app();
  expect(await screen.findByText('done 0 · lotes 1')).toBeTruthy();
  expect(sessionStorage.getItem(FIRST_RUN)).toBeNull();
});

test('a failed call stops the pass with the response text and clears the flag (the cron decides the rest)', async () => {
  signedInAs('ana@empresa.co');
  markFirstRun();
  mockApi({ 'POST /api/invoices/run': new Response(JSON.stringify({ error: 'El agente no está disponible ahora.' }), { status: 503 }) });
  app();
  expect(await screen.findByText('done 0 El agente no está disponible ahora. · lotes 0')).toBeTruthy();
  expect(sessionStorage.getItem(FIRST_RUN)).toBeNull();
});

test('outside the provider the pass is idle', () => {
  renderAt(<Probe />);
  expect(screen.getByText('idle · lotes 0')).toBeTruthy();
});
