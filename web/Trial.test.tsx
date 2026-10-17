// AC-92, AC-94 (R-119, R-120): the trial door, the returning door and the leave-trial warning. Supabase Auth is faked.
import type { Session } from '@supabase/supabase-js';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import App from './App';
import Demo from './pages/Demo';
import Login from './pages/Login';
import { useSession } from './auth';
import LeaveTrialWarning, { useLeaveGuard } from './components/LeaveTrialWarning';
import Timeline from './components/Timeline';
import type { StoredDecision } from '../src/agent/trace';
import TrialButton from './components/TrialButton';
import { currentSession } from './test/supabase';
import { DEMO_EMAIL, fakeAuth, mockApi, renderAt, signedInAs } from './test/utils';
import { guardLeave, isTrial } from './trial';

// The shared fake has no anonymous sign-in: an anonymous session is the fake one with no email and is_anonymous.
const anonymous = () => {
  signedInAs('');
  Object.assign(currentSession()!.user, { id: '3f9a1c2b-0000-4000-8000-000000000000', email: '', is_anonymous: true });
  return currentSession()!;
};
const auth = fakeAuth as typeof fakeAuth & { signInAnonymously: ReturnType<typeof vi.fn> };
const emit = (event: string, s: Session) => fakeAuth.onAuthStateChange.mock.calls.forEach(([cb]) => cb(event, s));
beforeEach(() => {
  auth.signInAnonymously = vi.fn(async () => {
    const s = anonymous();
    emit('SIGNED_IN', s);
    return { data: { session: s, user: s.user }, error: null };
  });
});

const RUN = 'POST /api/invoices/run';
const runCalls = (f: ReturnType<typeof mockApi>) => f.mock.calls.filter(([u, i]) => u === '/api/invoices/run' && i?.method === 'POST');
const door = (at = '/login') =>
  renderAt(
    <Routes>
      <Route path={at} element={<TrialButton />} />
      <Route path="/" element={<p>Bandeja abierta</p>} />
    </Routes>,
    { at },
  );

test('isTrial: only an anonymous session is an unsaved trial', () => {
  expect(isTrial(anonymous().user)).toBe(true);
  expect(isTrial({ ...anonymous().user, is_anonymous: false })).toBe(false);
  expect(isTrial(undefined)).toBe(false);
});

test('guardLeave: an unsaved trial is warned first; anyone else leaves at once', () => {
  const leave = vi.fn();
  const warn = vi.fn();
  guardLeave(anonymous().user, leave, warn);
  expect(warn).toHaveBeenCalledWith(leave);
  expect(leave).not.toHaveBeenCalled();
  guardLeave(undefined, leave, warn);
  expect(leave).toHaveBeenCalledOnce();
});

test('one click signs in anonymously once, in the page language, runs the first-login pass, then opens Bandeja (AC-92)', async () => {
  const f = mockApi({
    [RUN]: () => (runCalls(f).length === 1
      ? { PAGAR: 5, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 24, cursor: 'c1' }
      : { PAGAR: 20, FRENAR: 3, ESCALAR: 1, errors: 0, remaining: 0, cursor: null }),
  });
  door();
  expect(screen.getByText('Tu propia copia de Andina Labs, privada, sin correo ni contraseña.')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Probar con mi propia empresa' });
  expect(button.className).toBe('primary');
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button.getAttribute('aria-busy')).toBe('true'); // AC-91 item 4: busy at once
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(await screen.findByText('Bandeja abierta')).toBeTruthy();
  expect(auth.signInAnonymously).toHaveBeenCalledOnce();
  expect(auth.signInAnonymously).toHaveBeenCalledWith({ options: { data: { lang: 'es' } } });
  expect(runCalls(f)).toHaveLength(2);
});

test('the run shows «Decidiendo tus facturas pendientes… n de m» while it decides (AC-92, AC-40)', async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  mockApi({ [RUN]: async () => (await held, { PAGAR: 2, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null }) });
  door();
  fireEvent.click(screen.getByRole('button', { name: 'Probar con mi propia empresa' }));
  expect(await screen.findByRole('button', { name: 'Decidiendo tus facturas pendientes… 0 de …' })).toBeTruthy();
  release();
  expect(await screen.findByText('Bandeja abierta')).toBeTruthy();
});

test('in English: the English door, and the language stored on the user is en (AC-92, AC-41)', async () => {
  localStorage.setItem('lang', 'en');
  mockApi({ [RUN]: { PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null } });
  door('/demo');
  expect(screen.getByText('Your own private copy of Andina Labs, no email or password needed.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Try it with my own company' }));
  expect(await screen.findByText('Bandeja abierta')).toBeTruthy();
  expect(auth.signInAnonymously).toHaveBeenCalledWith({ options: { data: { lang: 'en' } } });
});

test.each([
  ['refused (rate limit)', async () => ({ data: { session: null, user: null }, error: new Error('Request rate limit reached') })],
  ['network down', async () => { throw new TypeError('Failed to fetch'); }],
])('a %s sign-in shows the failure in place with «Entrar como Andina Labs»; no run (AC-92)', async (_, impl) => {
  auth.signInAnonymously = vi.fn(impl);
  const f = mockApi({ [RUN]: { PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null } });
  door();
  fireEvent.click(screen.getByRole('button', { name: 'Probar con mi propia empresa' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'No pude crear tu empresa de prueba ahora. Intenta de nuevo en unos minutos, o entra como Andina Labs.',
  );
  expect(runCalls(f)).toHaveLength(0);
  expect((screen.getByRole('button', { name: 'Probar con mi propia empresa' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Entrar como Andina Labs' }));
  expect(await screen.findByText('Bandeja abierta')).toBeTruthy();
  expect(fakeAuth.signInWithPassword).toHaveBeenCalledWith({ email: DEMO_EMAIL, password: 'andina-demo-2026' });
  expect(sessionStorage.getItem('demo-tour')).toBe('1'); // R-62: the shared demo's tour marker
});

test('a failed «Entrar como Andina Labs» from the failure state says so, and stays (AC-92)', async () => {
  auth.signInAnonymously = vi.fn(async () => ({ data: { session: null, user: null }, error: new Error('x') }));
  fakeAuth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: new Error('down') });
  door();
  fireEvent.click(screen.getByRole('button', { name: 'Probar con mi propia empresa' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Entrar como Andina Labs' }));
  expect(await screen.findByText('No pude entrar a la demo. Intenta de nuevo en unos minutos.')).toBeTruthy();
  expect(sessionStorage.getItem('demo-tour')).toBeNull();
});

test('while an anonymous session exists the door reads «Volver a mi empresa de prueba» and opens Bandeja, never a second trial (AC-94)', async () => {
  anonymous();
  door('/demo');
  const back = await screen.findByRole('button', { name: 'Volver a mi empresa de prueba' });
  expect(back.className).toBe('primary');
  expect(screen.queryByRole('button', { name: 'Probar con mi propia empresa' })).toBeNull();
  fireEvent.click(back);
  expect(await screen.findByText('Bandeja abierta')).toBeTruthy();
  expect(auth.signInAnonymously).not.toHaveBeenCalled();
});

test('a trial user landing on Bandeja gets the guided tour (AC-92, AC-42)', async () => {
  anonymous();
  mockApi({ 'GET /api/screen/inbox?lang=es': { invoices: [], last_run: null, portal: null, beneficiaries: [], dashboard: null } }); // AC-98
  renderAt(<App />);
  expect(await screen.findByRole('dialog')).toBeTruthy();
});

// A screen with one leaving action, as the mounts use it: like «Cerrar sesión», it shows once signed in.
function Leaver({ onLeave }: { onLeave: () => void }) {
  const { guard, warning } = useLeaveGuard();
  if (!useSession().session) return null;
  return (
    <>
      <button type="button" onClick={() => guard(onLeave)}>Cerrar sesión</button>
      {warning}
    </>
  );
}
const COMPANY = { 'GET /api/company': { id: 'c1', name: 'Empresa de prueba 7', approver_email: null, lang: 'es', is_demo: false, is_trial: true } };

test('a leaving action by an unsaved trial shows the warning in place, naming the company (AC-94, R-119)', async () => {
  anonymous();
  mockApi(COMPANY);
  const leave = vi.fn();
  renderAt(<Leaver onLeave={leave} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
  const dialog = await screen.findByRole('alertdialog');
  await waitFor(() => expect(dialog.textContent).toContain(
    'Si sales sin guardar tu acceso, no podrás volver a «Empresa de prueba 7». ¿Guardas tu acceso primero?'));
  expect(leave).not.toHaveBeenCalled();
  const saveButton = within(dialog).getByRole('button', { name: 'Guardar mi acceso' });
  expect(saveButton.className).toBe('primary');
  fireEvent.click(saveButton); // AC-95: the warning's primary opens «Guardar mi acceso» in its place
  expect(await screen.findByRole('dialog', { name: 'Guardar mi acceso' })).toBeTruthy();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(leave).not.toHaveBeenCalled();
});

test('«Salir de todos modos» goes ahead (AC-94)', async () => {
  anonymous();
  mockApi(COMPANY);
  const leave = vi.fn();
  renderAt(<Leaver onLeave={leave} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Salir de todos modos' }));
  expect(leave).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

test.each([
  ['Cancelar', (d: HTMLElement) => fireEvent.click(within(d).getByRole('button', { name: 'Cancelar' }))],
  ['Escape', (d: HTMLElement) => fireEvent.keyDown(d, { key: 'Escape' })],
])('%s keeps the session (AC-94)', async (_, dismiss) => {
  anonymous();
  mockApi(COMPANY);
  const leave = vi.fn();
  renderAt(<Leaver onLeave={leave} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
  dismiss(await screen.findByRole('alertdialog'));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(leave).not.toHaveBeenCalled();
  expect(fakeAuth.signOut).not.toHaveBeenCalled();
});

test('a user with saved access (or no trial) leaves with no warning (AC-94)', async () => {
  signedInAs('ana@empresa.co');
  const leave = vi.fn();
  renderAt(<Leaver onLeave={leave} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
  expect(leave).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

test('the warning never shows a blank company: before the name loads it says «tu empresa de prueba»; in English it is English', async () => {
  localStorage.setItem('lang', 'en');
  renderAt(<LeaveTrialWarning company={null} onSave={() => {}} onLeave={() => {}} onCancel={() => {}} />);
  expect(screen.getByRole('alertdialog').textContent).toContain(
    'If you leave without saving your access, you can\'t come back to "your trial company". Save your access first?');
  expect(primaries()).toEqual(['Save my access']);
});

// The mounts (AC-92, AC-94, AC-40 and AC-45 Clarified; R-119, R-120): the door is THE primary on /login and /demo.
const OVERVIEW = { invoices: [], period: { autonomy: { n: 0, m: 0 }, autonomy_pct: null, violations: 0, explained_pct: 100 } };
const page = (at: '/login' | '/demo') =>
  renderAt(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="/" element={<p>Bandeja abierta</p>} />
    </Routes>,
    { at },
  );
const primaries = () => [...document.querySelectorAll('button.primary')].map((b) => b.textContent);

test.each([
  ['/login', 'Enviar código'],
  ['/demo', 'Entrar como Andina Labs'],
] as const)('on %s the door is the one primary and «%s» is secondary (AC-92, R-120)', (at, secondary) => {
  mockApi({ 'GET /api/demo/overview': OVERVIEW });
  page(at);
  expect(primaries()).toEqual(['Probar con mi propia empresa']);
  expect(screen.getByRole('button', { name: secondary }).className).not.toContain('primary');
  expect(screen.getByText('Tu propia copia de Andina Labs, privada, sin correo ni contraseña.')).toBeTruthy();
});

test('the door on /demo starts the trial and opens Bandeja (AC-92)', async () => {
  mockApi({ 'GET /api/demo/overview': OVERVIEW, [RUN]: { PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null } });
  page('/demo');
  fireEvent.click(screen.getByRole('button', { name: 'Probar con mi propia empresa' }));
  expect(await screen.findByText('Bandeja abierta')).toBeTruthy();
  expect(auth.signInAnonymously).toHaveBeenCalledOnce();
});

test('on the code step the user chose email: «Entrar» is the one primary (AC-40 unchanged)', async () => {
  mockApi();
  page('/login');
  fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'ana@empresa.co' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
  await screen.findByLabelText('Código de 6 dígitos');
  expect(primaries()).toEqual(['Entrar']);
});

test.each([
  ['/login', '«Enviar código»', () => {
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'ana@empresa.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
  }, () => fakeAuth.signInWithOtp],
  ['/demo', '«Entrar como Andina Labs»', () => fireEvent.click(screen.getByRole('button', { name: 'Entrar como Andina Labs' })), () => fakeAuth.signInWithPassword],
] as const)('on %s an unsaved trial gets «Volver…» as the primary, and %s warns first (AC-94, R-119)', async (at, _, act, signIn) => {
  anonymous();
  mockApi({ ...COMPANY, 'GET /api/demo/overview': OVERVIEW });
  page(at);
  await screen.findByRole('button', { name: 'Volver a mi empresa de prueba' }); // the session loads after the first paint
  expect(primaries()).toEqual(['Volver a mi empresa de prueba']);
  act();
  const dialog = await screen.findByRole('alertdialog');
  expect(signIn()).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Salir de todos modos' }));
  await waitFor(() => expect(signIn()).toHaveBeenCalledOnce());
});

// R-116: the timeline names a guest «Invitado <8 hex>» / "Guest <8 hex>", never the stored invitado:<hex>.
test.each([
  ['es', 'Invitado 3f9a1c2b en el tablero'],
  ['en', 'Guest 3f9a1c2b on the dashboard'],
])('the timeline names a guest\'s answer in %s (AC-37 Clarified, R-116)', (lang, shown) => {
  localStorage.setItem('lang', lang);
  renderAt(<Timeline decisions={[{ id: 'd2', seq: 2, outcome: 'PAGAR', actor: 'human', actor_email: 'invitado:3f9a1c2b', channel: 'dashboard',
    checks: [], headline_es: null, headline_en: null, question_es: null, question_en: null, policy_version: 1, amount_usd: 4200, payment: null, note: null, created_at: '2026-10-17T15:00:00Z' } as StoredDecision]} />);
  const row = screen.getByRole('listitem');
  expect(row.textContent).toContain(shown);
  expect(row.textContent).not.toContain('invitado:');
});
