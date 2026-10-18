// The first-login pass belongs to the app shell (AC-107, AC-40 and AC-92 Amended): started by the entry's tab flag, it survives
// navigation, resumes after a reload while the flag is set, runs once per tab, and clears the flag when it ends.
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { expect, test } from 'vitest';
import { FIRST_RUN, FirstRunProvider, markFirstRun, useFirstRun } from './firstRun';
import { DEMO_EMAIL, fakeAuth, mockApi, renderAt, signedInAs } from './test/utils';

const ANA = 'id:ana@empresa.co'; // the flag holds the id of the user whose entry set it

const batch = (o = {}) => ({ PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null, ...o });
const runCalls = (f: ReturnType<typeof mockApi>) => f.mock.calls.filter(([u, i]) => u === '/api/invoices/run' && i?.method === 'POST');
const bearers = (f: ReturnType<typeof mockApi>) => runCalls(f).map(([, i]) => new Headers(i?.headers).get('Authorization'));

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
  markFirstRun(ANA);
  let release: (v: unknown) => void = () => {};
  const f = mockApi({ 'POST /api/invoices/run': () => (runCalls(f).length === 1 ? batch({ PAGAR: 5, remaining: 24, cursor: 'c1' }) : new Promise((r) => (release = r))) });
  app();
  expect(await screen.findByText('running 5 de 29 · lotes 1')).toBeTruthy();
  expect(sessionStorage.getItem(FIRST_RUN)).toBe(ANA);
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

test('a flag with no session runs nothing, and signed out the flag is cleared (R-175)', async () => {
  markFirstRun(ANA);
  const f = mockApi({ 'POST /api/invoices/run': batch() });
  app();
  await new Promise((r) => setTimeout(r, 50));
  expect(runCalls(f)).toHaveLength(0);
  expect(sessionStorage.getItem(FIRST_RUN)).toBeNull();
});

test('moving to another screen neither stops nor restarts the pass', async () => {
  signedInAs('ana@empresa.co');
  markFirstRun(ANA);
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
  markFirstRun(ANA);
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
  markFirstRun(ANA);
  mockApi({ 'POST /api/invoices/run': new Response(JSON.stringify({ error: 'El agente no está disponible ahora.' }), { status: 500 }) });
  app();
  expect(await screen.findByText('done 0 El agente no está disponible ahora. · lotes 0')).toBeTruthy();
  expect(sessionStorage.getItem(FIRST_RUN)).toBeNull();
});

test('another user signing in mid-pass («Entrar como Andina Labs») stops it: no call carries their session and they see no pass (AC-107, R-119)', async () => {
  signedInAs('anon-trial@x');
  markFirstRun('id:anon-trial@x');
  let release: (v: unknown) => void = () => {};
  const f = mockApi({ 'POST /api/invoices/run': () => (runCalls(f).length === 1 ? new Promise((r) => (release = r)) : batch()) });
  app();
  await screen.findByText('running 0 de … · lotes 0');
  await act(async () => void (await fakeAuth.signInWithPassword({ email: DEMO_EMAIL, password: 'x' })));
  expect(screen.getByText('idle · lotes 0')).toBeTruthy(); // the trial's «n de m» is not the demo user's
  release(batch({ PAGAR: 1, remaining: 5, cursor: 'c1' }));
  await new Promise((r) => setTimeout(r, 50));
  fireEvent.click(screen.getByRole('link', { name: 'Política' })); // a move re-checks the flag: it is not the demo user's
  await new Promise((r) => setTimeout(r, 50));
  expect(bearers(f)).toEqual(['Bearer jwt:anon-trial@x']);
  expect(screen.getByText('idle · lotes 0')).toBeTruthy();
});

test('sign-out mid-pass, then another person enters: the first pass makes no more calls and the newcomer gets their own pass', async () => {
  signedInAs('ana@empresa.co');
  markFirstRun(ANA);
  let release: (v: unknown) => void = () => {};
  const f = mockApi({ 'POST /api/invoices/run': () => (runCalls(f).length === 1 ? new Promise((r) => (release = r)) : batch({ ESCALAR: 3 })) });
  app();
  await screen.findByText('running 0 de … · lotes 0');
  await act(async () => void (await fakeAuth.signOut()));
  await act(async () => void (await fakeAuth.signInWithPassword({ email: 'luis@empresa.co', password: 'x' })));
  markFirstRun('id:luis@empresa.co'); // Luis's entry
  release(batch({ PAGAR: 1, remaining: 5, cursor: 'c1' }));
  expect(await screen.findByText('done 0 · lotes 1')).toBeTruthy(); // Luis's pass: one call, nothing of Ana's
  expect(bearers(f)).toEqual(['Bearer jwt:ana@empresa.co', 'Bearer jwt:luis@empresa.co']);
  expect(runCalls(f)[1]![1]?.body).toBeUndefined(); // Luis's first call carries no cursor of Ana's company
  expect(sessionStorage.getItem(FIRST_RUN)).toBeNull();
});

// R-175 (AC-107 Clarified): a reload during the pass resumes it from the tab's flag.
test('a reload mid-call: the call the page cut off does not clear the flag, and the reloaded tab starts exactly one POST', async () => {
  signedInAs('ana@empresa.co');
  markFirstRun(ANA);
  let cut: (e: Error) => void = () => {};
  const f = mockApi({ 'POST /api/invoices/run': () => new Promise((_, no) => (cut = no)) });
  const first = app();
  await waitFor(() => expect(runCalls(f)).toHaveLength(1));
  window.dispatchEvent(new Event('pagehide')); // the reload: the page leaves, then the browser aborts its fetch
  cut(new TypeError('Failed to fetch'));
  await new Promise((r) => setTimeout(r, 20));
  expect(sessionStorage.getItem(FIRST_RUN)).toBe(ANA);
  first.unmount();
  const g = mockApi({ 'POST /api/invoices/run': batch({ PAGAR: 4 }) });
  app();
  expect(await screen.findByText('done 4 · lotes 1')).toBeTruthy();
  expect(runCalls(g)).toHaveLength(1);
  expect(sessionStorage.getItem(FIRST_RUN)).toBeNull();
});

test('the demo user never gets a pass, even with a flag set (AC-107)', async () => {
  signedInAs(DEMO_EMAIL);
  markFirstRun(`id:${DEMO_EMAIL}`);
  const f = mockApi({ 'POST /api/invoices/run': batch() });
  app();
  await new Promise((r) => setTimeout(r, 50));
  expect(runCalls(f)).toHaveLength(0);
  expect(screen.getByText('idle · lotes 0')).toBeTruthy();
});

test('sign-out clears the flag (R-175)', async () => {
  signedInAs('ana@empresa.co');
  markFirstRun(ANA);
  mockApi({ 'POST /api/invoices/run': () => new Promise(() => {}) });
  app();
  await screen.findByText('running 0 de … · lotes 0');
  await act(async () => void (await fakeAuth.signOut()));
  expect(sessionStorage.getItem(FIRST_RUN)).toBeNull();
});

test('a "busy" answer (503) is waited out and retried, not shown; the pass goes on (R-175)', async () => {
  signedInAs('ana@empresa.co');
  markFirstRun(ANA);
  const busy = () => new Response(JSON.stringify({ error: 'ocupado' }), { status: 503 });
  const f = mockApi({ 'POST /api/invoices/run': () => (runCalls(f).length === 1 ? busy() : batch({ PAGAR: 3 })) });
  app();
  await waitFor(() => expect(runCalls(f)).toHaveLength(1));
  await new Promise((r) => setTimeout(r, 1500));
  expect(runCalls(f)).toHaveLength(1); // about 2 s before the retry
  expect(screen.getByText('running 0 de … · lotes 0')).toBeTruthy(); // the busy answer is not shown
  expect(await screen.findByText('done 3 · lotes 1', undefined, { timeout: 2000 })).toBeTruthy();
  expect(runCalls(f)).toHaveLength(2);
  expect(sessionStorage.getItem(FIRST_RUN)).toBeNull();
});

test('outside the provider the pass is idle', () => {
  renderAt(<Probe />);
  expect(screen.getByText('idle · lotes 0')).toBeTruthy();
});
