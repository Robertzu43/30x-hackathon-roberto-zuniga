import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { routes } from './App';
import { FIRST_RUN } from './firstRun';
import { useT } from './i18n';
import Login from './pages/Login';
import { currentSession } from './test/supabase';
import { enterApp } from './transition';
import { DEMO_EMAIL, fakeAuth, mockApi, renderAt, signedInAs } from './test/utils';

// AC-109: the real enterApp runs (jsdom has no View Transitions, so the swap is instant); the spy proves the door uses it.
vi.mock('./transition', async (load) => {
  const real = await load<typeof import('./transition')>();
  return { ...real, enterApp: vi.fn(real.enterApp) };
});
beforeEach(() => { vi.mocked(enterApp).mockClear(); }); // braces: a returned function would run as teardown

function setup() {
  const fetchMock = mockApi({ 'POST /api/invoices/run': { PAGAR: 3, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null } });
  renderAt(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<p>bandeja</p>} />
    </Routes>,
    { at: '/login' },
  );
  return fetchMock;
}
function Lang() {
  return <p>{`bandeja ${useT().lang}`}</p>;
}
const runCalls = (f: ReturnType<typeof mockApi>) => f.mock.calls.filter(([u, i]) => u === '/api/invoices/run' && i?.method === 'POST');

async function sendEmail(email = 'ana@empresa.co') {
  fireEvent.change(screen.getByLabelText('Correo'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
  return screen.findByLabelText('Código de 6 dígitos');
}
const enterCode = (code: string) => {
  fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
};

test('/login is public and full-bleed', () => expect(routes.find((r) => r.path === '/login')).toMatchObject({ public: true, fullBleed: true }));

test('offers "Español | English", an email field and "Enviar código" (AC-40)', () => {
  setup();
  expect(screen.getByRole('button', { name: 'Español' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'English' })).toBeTruthy();
  expect(screen.getByLabelText('Correo')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Enviar código' })).toBeTruthy();
});

test('the email asks Supabase for a code and reaches the 6-digit code state', async () => {
  setup();
  const code = await sendEmail();
  expect(fakeAuth.signInWithOtp).toHaveBeenCalledWith({ email: 'ana@empresa.co', options: { shouldCreateUser: true } });
  expect(screen.getByText('Te enviamos un código de 6 dígitos a ana@empresa.co.')).toBeTruthy();
  expect([code.getAttribute('inputmode'), code.getAttribute('maxlength'), code.getAttribute('pattern')]).toEqual(['numeric', '6', '\\d{6}']);
});

test('a failed send says so and stays on the email step', async () => {
  fakeAuth.signInWithOtp.mockResolvedValueOnce({ data: {}, error: new Error('rate limited') });
  setup();
  fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'ana@empresa.co' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
  expect(await screen.findByText('No pudimos enviar el código. Revisa el correo e intenta de nuevo.')).toBeTruthy();
  expect(screen.queryByLabelText('Código de 6 dígitos')).toBeNull();
});

test('a wrong code shows "Código incorrecto o vencido" and runs nothing', async () => {
  fakeAuth.verifyOtp.mockResolvedValueOnce({ data: {}, error: new Error('Token has expired or is invalid') });
  const fetchMock = setup();
  await sendEmail();
  enterCode('000000');
  expect(await screen.findByText('Código incorrecto o vencido')).toBeTruthy();
  expect(runCalls(fetchMock)).toHaveLength(0);
  expect(screen.queryByText('bandeja')).toBeNull();
});

test('a valid code opens Bandeja at once and leaves the first-run flag; the login screen runs nothing (AC-40 Amended, AC-107)', async () => {
  const fetchMock = setup();
  await sendEmail();
  enterCode('123456');
  expect(await screen.findByText('bandeja')).toBeTruthy();
  expect(fakeAuth.verifyOtp).toHaveBeenCalledWith({ email: 'ana@empresa.co', token: '123456', type: 'email' });
  expect(enterApp).toHaveBeenCalledOnce(); // the hand-over into Bandeja (AC-109)
  expect(runCalls(fetchMock)).toHaveLength(0); // the shell runs the pass after landing (web/firstRun.tsx)
  expect(sessionStorage.getItem(FIRST_RUN)).toBe('id:ana@empresa.co'); // the flag names whose pass it is
});

test('«Entrar» is disabled, aria-busy and reads «Entrando…» while the code is checked (AC-107, AC-91 item 4)', async () => {
  let release: (v: { data: unknown; error: Error | null }) => void = () => {};
  fakeAuth.verifyOtp.mockImplementationOnce(() => new Promise((r) => (release = r)));
  setup();
  await sendEmail();
  enterCode('123456');
  const busy = screen.getByRole('button', { name: 'Entrando…' }) as HTMLButtonElement;
  expect([busy.disabled, busy.getAttribute('aria-busy')]).toEqual([true, 'true']);
  await waitFor(() => expect(fakeAuth.verifyOtp).toHaveBeenCalledOnce());
  release({ data: {}, error: new Error('Token has expired or is invalid') });
  expect(await screen.findByText('Código incorrecto o vencido')).toBeTruthy();
});

// AC-107: nothing but the sign-in call blocks the landing, not the language write, not the pass.
const returning = async () => { // a returning user whose saved language is es
  signedInAs('ana@empresa.co', { lang: 'es' });
  fakeAuth.onAuthStateChange.mock.calls.forEach(([cb]) => cb('SIGNED_IN', currentSession()));
  return { data: { session: currentSession() }, error: null };
};
test.each([
  ['the code door', async () => {
    fakeAuth.verifyOtp.mockImplementationOnce(returning);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@empresa.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  }],
  ['the password door', async () => {
    fakeAuth.signInWithPassword.mockImplementationOnce(returning);
    withPassword('ana@empresa.co', 'secreta-123', ['Sign in with password', 'Email', 'Password', 'Sign in']);
  }],
])('%s lands on Bandeja while the language write and the pass never answer, in the language just picked (AC-107, AC-41)', async (_, enter) => {
  fakeAuth.updateUser.mockImplementationOnce(() => new Promise(() => {}));
  const f = mockApi({ 'POST /api/invoices/run': () => new Promise(() => {}) });
  renderAt(<Routes><Route path="/login" element={<Login />} /><Route path="/" element={<Lang />} /></Routes>, { at: '/login' });
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  await enter();
  expect(await screen.findByText('bandeja en')).toBeTruthy();
  await new Promise((r) => setTimeout(r, 20)); // the saved language arriving with the session does not win over the click
  expect(screen.getByText('bandeja en')).toBeTruthy();
  expect(fakeAuth.updateUser).toHaveBeenCalledWith({ data: { lang: 'en' } });
  expect(runCalls(f)).toHaveLength(0);
});

test('"English" switches the screen without reload and is remembered (AC-41)', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(await screen.findByRole('button', { name: 'Send code' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem('lang')).toBe('en');
});

test('after sign-in the language picked on the login screen is stored on the user (AC-41)', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@empresa.co' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
  fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(fakeAuth.updateUser).toHaveBeenCalledWith({ data: { lang: 'en' } }));
  expect(fakeAuth.updateUser).toHaveBeenCalledTimes(1);
});

test('signing in without touching the language toggle writes no language to the user (AC-41)', async () => {
  setup();
  await sendEmail();
  enterCode('123456');
  expect(await screen.findByText('bandeja')).toBeTruthy();
  expect(fakeAuth.updateUser).not.toHaveBeenCalled();
});

// Task 32b (AC-80, AC-81): the logo is the heading; the brand name is not stacked twice.
test('the heading is the Thesaurus logo, shown once', () => {
  sessionStorage.setItem('logo-intro:login', '1'); // the intro has played (AC-108): the static logo is under test
  setup();
  const h1 = screen.getByRole('heading', { level: 1, name: 'Thesaurus' });
  expect(h1.querySelector('img')?.getAttribute('src')).toBe('/brand/thesaurus-logo.svg');
  expect(screen.getAllByRole('img', { name: 'Thesaurus' })).toHaveLength(1);
  expect(screen.queryByText('Thesaurus')).toBeNull(); // no second, text-only wordmark
});

// AC-95: «Entrar con contraseña» (secondary) opens the same workspace with no OTP; AC-40's code flow is unchanged.
const withPassword = (email: string, password: string, [open, emailLabel, passwordLabel, enter] = ['Entrar con contraseña', 'Correo', 'Contraseña', 'Entrar']) => {
  fireEvent.click(screen.getByRole('button', { name: open }));
  fireEvent.change(screen.getByLabelText(emailLabel), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(passwordLabel), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: enter }));
};
const refused = (message: string, extra: object) => fakeAuth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: Object.assign(new Error(message), extra) });
const primaries = () => [...document.querySelectorAll('button.primary')].map((b) => b.textContent);

test('«Entrar con contraseña» is secondary; it opens an email + password form whose «Entrar» is the one primary (AC-95, R-120)', () => {
  setup();
  const open = screen.getByRole('button', { name: 'Entrar con contraseña' });
  expect(open.className).not.toContain('primary');
  expect(primaries()).toEqual(['Probar con mi propia empresa']);
  fireEvent.click(open);
  expect(screen.getByLabelText('Contraseña')).toBeTruthy();
  expect(primaries()).toEqual(['Entrar']);
  expect(screen.queryByRole('button', { name: 'Enviar código' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  expect(screen.getByRole('button', { name: 'Enviar código' })).toBeTruthy();
});

test('email + password signs in with no code and opens Bandeja at once, leaving the pass to the shell (AC-95, AC-107)', async () => {
  const fetchMock = setup();
  withPassword(' ana@empresa.co ', 'secreta-123');
  expect(await screen.findByText('bandeja')).toBeTruthy();
  expect(fakeAuth.signInWithPassword).toHaveBeenCalledWith({ email: 'ana@empresa.co', password: 'secreta-123' });
  expect(enterApp).toHaveBeenCalledOnce(); // the hand-over into Bandeja (AC-109)
  expect(fakeAuth.signInWithOtp).not.toHaveBeenCalled();
  expect(runCalls(fetchMock)).toHaveLength(0);
  expect(sessionStorage.getItem(FIRST_RUN)).toBe('id:ana@empresa.co'); // the flag names whose pass it is
});

test.each([
  ['wrong credentials', () => refused('Invalid login credentials', { code: 'invalid_credentials', status: 400 }), 'Correo o contraseña incorrectos.'],
  ['a network failure', () => fakeAuth.signInWithPassword.mockRejectedValueOnce(new TypeError('Failed to fetch')), 'No pude entrar ahora; intenta de nuevo.'],
])('%s shows its message and stays on the form (AC-95)', async (_, arrange, message) => {
  arrange();
  const fetchMock = setup();
  withPassword('ana@empresa.co', 'secreta-123');
  expect((await screen.findByRole('alert')).textContent).toBe(message);
  expect(runCalls(fetchMock)).toHaveLength(0);
  expect((screen.getByRole('button', { name: 'Entrar' }) as HTMLButtonElement).disabled).toBe(false);
});

test.each([
  ['es', 'Correo', 'Contraseña', 'Entrar con contraseña', 'Entrar', 'La contraseña debe tener al menos 8 caracteres.'],
  ['en', 'Email', 'Password', 'Sign in with password', 'Sign in', 'The password needs at least 8 characters.'],
])('%s: a 7-character password is refused in place with 0 signInWithPassword calls (AC-95, R-134)', async (l, email, password, open, enter, message) => {
  localStorage.setItem('lang', l);
  const fetchMock = setup();
  withPassword('ana@empresa.co', '1234567', [open, email, password, enter]);
  expect((await screen.findByRole('alert')).textContent).toBe(message);
  expect(fakeAuth.signInWithPassword).not.toHaveBeenCalled();
  expect(runCalls(fetchMock)).toHaveLength(0);
  fireEvent.change(screen.getByLabelText(password), { target: { value: '12345678' } });
  fireEvent.click(screen.getByRole('button', { name: enter }));
  await waitFor(() => expect(fakeAuth.signInWithPassword).toHaveBeenCalledOnce()); // 8 is enough
});

test('in English: "Sign in with password" and "Wrong email or password." (AC-95)', async () => {
  localStorage.setItem('lang', 'en');
  refused('Invalid login credentials', { code: 'invalid_credentials', status: 400 });
  setup();
  withPassword('ana@empresa.co', 'secreta-123', ['Sign in with password', 'Email', 'Password', 'Sign in']);
  expect((await screen.findByRole('alert')).textContent).toBe('Wrong email or password.');
});

test('the password has a show/hide toggle here too', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Entrar con contraseña' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
  expect((screen.getByLabelText('Contraseña') as HTMLInputElement).type).toBe('text');
});

test('an unsaved trial signing in with a password for another account is warned first (AC-94, R-119)', async () => {
  signedInAs('', { tour_seen: true });
  Object.assign(currentSession()!.user, { id: '3f9a1c2b-0000-4000-8000-000000000000', email: '', is_anonymous: true });
  mockApi({ 'GET /api/company': { id: 'c1', name: 'Empresa de prueba 7', approver_email: null, lang: 'es', is_demo: false, is_trial: true } });
  renderAt(<Routes><Route path="/login" element={<Login />} /><Route path="/" element={<p>bandeja</p>} /></Routes>, { at: '/login' });
  await screen.findByRole('button', { name: 'Volver a mi empresa de prueba' });
  withPassword('ana@empresa.co', 'secreta-123');
  const warning = await screen.findByRole('alertdialog');
  expect(fakeAuth.signInWithPassword).not.toHaveBeenCalled();
  fireEvent.click(within(warning).getByRole('button', { name: 'Salir de todos modos' }));
  await waitFor(() => expect(fakeAuth.signInWithPassword).toHaveBeenCalledOnce());
});

// R-150 lever 2 (AC-107, AC-98): the door puts Bandeja's one request in flight as the sign-in resolves (here `/` is a stub, so
// only the door can have asked); lever 3: the Inbox chunk is fetched once /login is usable and on a door's hover or focus.
const inboxCalls = (f: ReturnType<typeof mockApi>) => f.mock.calls.filter(([u]) => String(u).startsWith('/api/screen/inbox')).map(([u]) => u);
test.each([
  ['the code door', async () => { await sendEmail(); enterCode('123456'); }],
  ['the password door', async () => withPassword('ana@empresa.co', 'secreta-123')],
])('%s asks for Bandeja\'s data once, when the sign-in resolves, not before (R-150 lever 2)', async (_, enter) => {
  const f = setup();
  await new Promise((r) => setTimeout(r, 20));
  expect(inboxCalls(f)).toEqual([]);
  await enter();
  expect(await screen.findByText('bandeja')).toBeTruthy();
  await waitFor(() => expect(inboxCalls(f)).toEqual(['/api/screen/inbox?lang=es']));
});

test('a returning user whose saved language differs: the door asks in that language, the one Bandeja will show (R-150, AC-41)', async () => {
  fakeAuth.verifyOtp.mockImplementationOnce(async () => {
    signedInAs('ana@empresa.co', { lang: 'en' });
    fakeAuth.onAuthStateChange.mock.calls.forEach(([cb]) => cb('SIGNED_IN', currentSession()));
    return { data: { session: currentSession() }, error: null };
  });
  const f = mockApi({ 'POST /api/invoices/run': () => new Promise(() => {}) });
  renderAt(<Routes><Route path="/login" element={<Login />} /><Route path="/" element={<Lang />} /></Routes>, { at: '/login' });
  await sendEmail();
  enterCode('123456');
  expect(await screen.findByText('bandeja en')).toBeTruthy();
  await waitFor(() => expect(inboxCalls(f)).toEqual(['/api/screen/inbox?lang=en']));
});

test('a deep link sign-in lands on its page and asks nothing for Bandeja (R-62, R-150)', async () => {
  const f = mockApi();
  renderAt(<Routes><Route path="/login" element={<Login />} /><Route path="/policy" element={<p>política</p>} /></Routes>,
    { at: { pathname: '/login', state: { from: '/policy' } } as unknown as string });
  await sendEmail();
  enterCode('123456');
  expect(await screen.findByText('política')).toBeTruthy();
  await new Promise((r) => setTimeout(r, 20));
  expect(inboxCalls(f)).toEqual([]);
});

test('RequireAuth sends the root URL here with from "/": the door still asks for Bandeja once (R-150 lever 2)', async () => {
  const f = mockApi();
  renderAt(<Routes><Route path="/login" element={<Login />} /><Route path="/" element={<p>bandeja</p>} /></Routes>,
    { at: { pathname: '/login', state: { from: '/' } } as unknown as string });
  await sendEmail();
  enterCode('123456');
  expect(await screen.findByText('bandeja')).toBeTruthy();
  await waitFor(() => expect(inboxCalls(f)).toEqual(['/api/screen/inbox?lang=es']));
});

test('once usable /login fetches the Inbox chunk, signing nobody in; a door\'s hover or focus fetches it too (R-150 lever 3)', async () => {
  const load = vi.spyOn(routes[0]!, 'load');
  const f = setup();
  await waitFor(() => expect(load).toHaveBeenCalled());
  expect([fakeAuth.verifyOtp, fakeAuth.signInWithPassword, fakeAuth.signInWithOtp].map((s) => s.mock.calls.length)).toEqual([0, 0, 0]);
  expect(inboxCalls(f)).toEqual([]);
  load.mockClear();
  fireEvent.pointerOver(screen.getByRole('button', { name: 'Probar con mi propia empresa' }));
  expect(load).toHaveBeenCalledOnce();
  load.mockClear();
  fireEvent.focusIn(screen.getByRole('button', { name: 'Entrar con contraseña' }));
  expect(load).toHaveBeenCalledOnce();
});

test('the shared demo user signing in here keeps the tab\'s language (R-78) and asks in it (R-150)', async () => {
  fakeAuth.signInWithPassword.mockImplementationOnce(async () => {
    signedInAs(DEMO_EMAIL, { lang: 'en' });
    fakeAuth.onAuthStateChange.mock.calls.forEach(([cb]) => cb('SIGNED_IN', currentSession()));
    return { data: { session: currentSession() }, error: null };
  });
  const f = mockApi({ 'POST /api/invoices/run': () => new Promise(() => {}) });
  renderAt(<Routes><Route path="/login" element={<Login />} /><Route path="/" element={<Lang />} /></Routes>, { at: '/login' });
  await waitFor(() => expect(fakeAuth.onAuthStateChange).toHaveBeenCalled()); // the page knows the demo email (/api/config) before anyone types
  await new Promise((r) => setTimeout(r, 0));
  withPassword(DEMO_EMAIL, 'andina-demo-2026');
  expect(await screen.findByText('bandeja es')).toBeTruthy();
  await waitFor(() => expect(inboxCalls(f)).toEqual(['/api/screen/inbox?lang=es']));
});
