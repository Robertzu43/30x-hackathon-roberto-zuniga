import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { thisMonth } from './api';
import App, { routes } from './App';
import { currentSession } from './test/supabase';
import { DEMO_EMAIL, fakeAuth, mockApi, renderAt, signedInAs } from './test/utils';

const SEEN = { tour_seen: true };

// findBy* can resolve in the gap between the commit that shows the signed-in top bar and the passive effects of that
// commit (tour start, stored lang). A click landing in that gap is overwritten by those effects, so let them run first.
const signedInTopBar = async (name = 'Ver tutorial') => {
  const button = await screen.findByRole('button', { name });
  await act(async () => {});
  return button;
};

// The real Bandeja mounts on /: answer what it loads (AC-98, one screen request) so it never lands on its error state mid-test.
const EMPTY = { invoices: [], last_run: null, portal: null, beneficiaries: [], dashboard: null };
const INBOX = { 'GET /api/screen/inbox?lang=es': EMPTY, 'GET /api/screen/inbox?lang=en': EMPTY };
beforeEach(() => mockApi(INBOX));

test('one route per screen, each loading its page on navigation (AC-99), plus the /beneficiaries/:id placeholder for Task 50', async () => {
  expect(routes.map((r) => r.path).sort()).toEqual(
    ['/', '/approve/:token', '/beneficiaries', '/beneficiaries/:id', '/demo', '/invoices/:id', '/login', '/period', '/policy'].sort(),
  );
  for (const r of routes) expect(typeof (await r.load()).default).toBe('function');
});

test('every page file under web/pages has a route', async () => {
  const shown = await Promise.all(routes.map(async (r) => (await r.load()).default));
  for (const [file, load] of Object.entries(import.meta.glob(['./pages/*.tsx', '!./pages/*.test.tsx'])))
    expect(shown, file).toContain(((await load()) as { default: unknown }).default);
});

// AC-100: hovering or focusing a nav link fetches that page's chunk and its screen data before the click.
test.each([
  ['Periodo', 'mouseEnter', () => `/api/screen/period?month=${thisMonth()}`],
  ['Política', 'focus', () => '/api/screen/policy'],
  ['Beneficiarios', 'mouseEnter', () => '/api/screen/beneficiaries'],
])('hovering or focusing «%s» prefetches its chunk and its screen data', async (name, how, path) => {
  signedInAs('ana@empresa.co', SEEN);
  const fetchMock = mockApi(INBOX);
  renderAt(<App />);
  const link = within(await screen.findByRole('navigation', { name: 'Secciones' })).getByRole('link', { name });
  const route = routes.find((r) => r.path === link.getAttribute('href'))!;
  const load = vi.spyOn(route, 'load');
  fireEvent[how as 'mouseEnter' | 'focus'](link);
  expect(load).toHaveBeenCalled();
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === path())).toBe(true));
});

test('a nav hover over a screen this tab already holds sends no second request', async () => {
  signedInAs('ana@empresa.co', SEEN);
  const fetchMock = mockApi({ ...INBOX, 'GET /api/screen/policy': { versions: [], company: null, fx: { rates: [] } } });
  renderAt(<App />);
  const link = within(await screen.findByRole('navigation', { name: 'Secciones' })).getByRole('link', { name: 'Política' });
  fireEvent.mouseEnter(link);
  await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u === '/api/screen/policy')).toHaveLength(1));
  fireEvent.mouseEnter(link);
  await new Promise((r) => setTimeout(r, 20));
  expect(fetchMock.mock.calls.filter(([u]) => u === '/api/screen/policy')).toHaveLength(1);
});

test('/beneficiaries/:id waits for Task 50: it opens Beneficiarios', async () => {
  signedInAs('ana@empresa.co', SEEN);
  mockApi({ ...INBOX, 'GET /api/screen/beneficiaries': { beneficiaries: [] } });
  renderAt(<App />, { at: '/beneficiaries/b1' });
  expect(await screen.findByRole('heading', { name: 'Beneficiarios', level: 1 })).toBeTruthy();
});

// AC-100: the cache never shows one user's screen to the next one signed in on this tab.
test('another user signed in on this tab never sees the screen cached for the last one', async () => {
  signedInAs('ana@empresa.co', SEEN);
  mockApi({ ...INBOX, 'GET /api/screen/beneficiaries': { beneficiaries: [{ id: 'b1', name: 'Laura Méndez', country: null, currency: null, bank_account: null, route: null, category: null, agreement: null }] } });
  const first = renderAt(<App />, { at: '/beneficiaries' });
  await screen.findByText('Laura Méndez');
  first.unmount();
  signedInAs('bea@otra.co', SEEN);
  mockApi({ ...INBOX, 'GET /api/screen/beneficiaries': () => new Promise(() => {}) });
  renderAt(<App />, { at: '/beneficiaries' });
  await screen.findByRole('heading', { name: 'Beneficiarios', level: 1 });
  expect(screen.queryByText('Laura Méndez')).toBeNull();
});

test('a signed-out visitor of a private page lands on /login', async () => {
  renderAt(<App />, { at: '/policy' });
  expect(await screen.findByRole('button', { name: 'Enviar código' })).toBeTruthy();
});

test('an unknown path goes to Bandeja', async () => {
  signedInAs('ana@empresa.co', SEEN);
  renderAt(<App />, { at: '/nope' });
  expect(await screen.findByRole('heading', { name: 'Bandeja' })).toBeTruthy();
});

test.each(['/demo', '/approve/abc'])('%s is public: it renders without a session', async (at) => {
  renderAt(<App />, { at });
  expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Enviar código' })).toBeNull();
});

test('the nav lists the pages that declare nav, in their order', async () => {
  signedInAs('ana@empresa.co', SEEN);
  renderAt(<App />);
  const nav = await screen.findByRole('navigation', { name: 'Secciones' });
  expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Bandeja', 'Política', 'Beneficiarios', 'Periodo']);
});

test('a first login starts the tour; "Saltar" stores tour_seen on the user (AC-42)', async () => {
  signedInAs('ana@empresa.co');
  renderAt(<App />);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Saltar' }));
  await waitFor(() => expect(fakeAuth.updateUser).toHaveBeenCalledWith({ data: { tour_seen: true } }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a user who has seen the tour does not get it again; "Ver tutorial" restarts it', async () => {
  signedInAs('ana@empresa.co', SEEN);
  renderAt(<App />);
  fireEvent.click(await signedInTopBar());
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Bandeja', level: 2 })).toBeTruthy();
});

test('a seen user is not shown the tour on load', async () => {
  signedInAs('ana@empresa.co', SEEN);
  renderAt(<App />);
  await screen.findByRole('button', { name: 'Ver tutorial' });
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByRole('dialog')).toBeNull();
});

// R-62: the shared demo user gets the tour once per click on "Entrar como Andina Labs", never on reload or deep link.
const enterAsDemo = async () => {
  mockApi({ ...INBOX, 'GET /api/demo/overview': new Response('{}', { status: 503 }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Entrar como Andina Labs' }));
};
const reloadAt = (at: string) => {
  cleanup();
  renderAt(<App />, { at });
};

test('"Entrar como Andina Labs" starts the tour on Bandeja; skipping it stores nothing (R-17, R-62)', async () => {
  renderAt(<App />, { at: '/demo' });
  await enterAsDemo();
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: 'Bandeja', level: 2 })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Saltar' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(fakeAuth.updateUser).not.toHaveBeenCalledWith({ data: { tour_seen: true } });
});

test.each(['/policy', '/period', '/'])('a demo user reloading or deep-linking %s stays there with no tour (R-62)', async (at) => {
  signedInAs(DEMO_EMAIL, SEEN);
  renderAt(<App />, { at });
  await signedInTopBar();
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByRole('dialog')).toBeNull();
  if (at === '/policy') expect(screen.getByRole('heading', { name: 'Política', level: 1 })).toBeTruthy();
  if (at === '/period') expect(screen.getByRole('heading', { name: 'Periodo', level: 1 })).toBeTruthy();
});

test('after the click, a reload never restarts the tour; "Ver tutorial" and a new click do (R-62)', async () => {
  renderAt(<App />, { at: '/demo' });
  await enterAsDemo();
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Saltar' }));
  reloadAt('/policy');
  await signedInTopBar();
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Política', level: 1 })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ver tutorial' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Saltar' }));
  reloadAt('/demo');
  await enterAsDemo(); // already signed in as the demo user: the same user id signs in again
  expect(await screen.findByRole('dialog')).toBeTruthy();
});

test('a signed-out deep link survives sign-in: the code lands on the page asked for', async () => {
  mockApi({ ...INBOX, 'POST /api/invoices/run': { PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null } });
  // A returning user (tour already seen): verifyOtp signs in with the stored metadata.
  fakeAuth.verifyOtp.mockImplementationOnce(async ({ email }) => {
    signedInAs(email, SEEN);
    await fakeAuth.updateUser({ data: {} }); // emits the new session to the app
    return { data: {}, error: null };
  });
  renderAt(<App />, { at: '/period' });
  fireEvent.change(await screen.findByLabelText('Correo'), { target: { value: 'ana@empresa.co' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
  fireEvent.change(await screen.findByLabelText('Código de 6 dígitos'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  expect(await screen.findByRole('heading', { name: 'Periodo', level: 1 })).toBeTruthy();
});

test('the top bar language switch changes the UI without reload and stores it on the user (AC-41)', async () => {
  signedInAs('ana@empresa.co', { ...SEEN, lang: 'es' });
  renderAt(<App />);
  await signedInTopBar();
  fireEvent.click(screen.getByRole('button', { name: 'en' }));
  expect(await screen.findByRole('button', { name: 'Show tutorial' })).toBeTruthy();
  await waitFor(() => expect(fakeAuth.updateUser).toHaveBeenCalledWith({ data: { lang: 'en' } }));
});

test('the top bar shows who is signed in, and sign-out returns to /login', async () => {
  signedInAs('ana@empresa.co', SEEN);
  renderAt(<App />);
  expect(await screen.findByText('ana@empresa.co')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
  expect(await screen.findByRole('button', { name: 'Enviar código' })).toBeTruthy();
  expect(fakeAuth.signOut).toHaveBeenCalledOnce();
});

test('the tour keeps its place across routes: Siguiente from Bandeja reaches Política on /policy', async () => {
  signedInAs('ana@empresa.co', SEEN);
  renderAt(<App />);
  fireEvent.click(await signedInTopBar());
  await screen.findByRole('heading', { name: 'Bandeja', level: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  await screen.findByRole('heading', { name: 'Nueva factura', level: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  await screen.findByRole('heading', { name: 'Ejecutar agente', level: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  // The mocked invoice list is empty, so Bandeja has no invoice-row anchor and that step is skipped.
  expect(await screen.findByRole('heading', { name: 'Política', level: 2 }, { timeout: 8000 })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Política', level: 1 })).toBeTruthy();
}, 10000);

test('signing out then signing in as someone else opens Bandeja, not the page the first user left (AC-40)', async () => {
  mockApi({ ...INBOX, 'GET /api/screen/policy': { versions: [], company: { id: 'c', name: 'A', approver_email: 'a@a.co', lang: 'es', is_demo: false }, fx: { rates: [] } }, 'POST /api/invoices/run': { PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null } });
  signedInAs('ana@empresa.co', SEEN);
  renderAt(<App />, { at: '/policy' });
  await screen.findByRole('heading', { name: 'Política', level: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
  fireEvent.change(await screen.findByLabelText('Correo'), { target: { value: 'bea@otra.co' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
  fakeAuth.verifyOtp.mockImplementationOnce(async ({ email }) => {
    signedInAs(email, SEEN);
    await fakeAuth.updateUser({ data: {} });
    return { data: {}, error: null };
  });
  fireEvent.change(await screen.findByLabelText('Código de 6 dígitos'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  expect(await screen.findByRole('heading', { name: 'Bandeja', level: 1 })).toBeTruthy();
});

// R-78: the shared demo user's language lives only in this tab's session; /demo opens in Spanish; the tour never blocks the top bar.
const demoWithStoredLang = (lang: string) =>
  fakeAuth.signInWithPassword.mockImplementationOnce(async ({ email }) => {
    signedInAs(email, { lang }); // an earlier judge's choice, stored on the shared user
    await fakeAuth.updateUser({ data: {} });
    return { data: {}, error: null };
  });

test('the demo user top-bar language changes this tab only: nothing is written on the user or for other tabs (R-78)', async () => {
  signedInAs(DEMO_EMAIL, SEEN);
  renderAt(<App />);
  await signedInTopBar();
  fireEvent.click(screen.getByRole('button', { name: 'en' }));
  expect(await screen.findByRole('button', { name: 'Show tutorial' })).toBeTruthy();
  await act(async () => {});
  expect(fakeAuth.updateUser).not.toHaveBeenCalled();
  expect(localStorage.getItem('lang')).toBeNull();
  expect(sessionStorage.getItem('lang')).toBe('en');
});

test('/demo opens in Spanish whatever an earlier judge chose, and "Entrar" opens a Spanish dashboard and tour (R-78)', async () => {
  localStorage.setItem('lang', 'en');
  demoWithStoredLang('en');
  renderAt(<App />, { at: '/demo' });
  await enterAsDemo();
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: 'Bandeja', level: 2 })).toBeTruthy();
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Ver tutorial' })).toBeTruthy();
});

test('/demo switched to English: "Sign in as Andina Labs" opens an English dashboard and tour (R-78)', async () => {
  demoWithStoredLang('es');
  renderAt(<App />, { at: '/demo' });
  mockApi({ ...INBOX, 'GET /api/demo/overview': new Response('{}', { status: 503 }) });
  fireEvent.click(await screen.findByRole('button', { name: 'English' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in as Andina Labs' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: 'Inbox', level: 2 })).toBeTruthy();
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Show tutorial' })).toBeTruthy();
  expect(fakeAuth.updateUser).not.toHaveBeenCalledWith({ data: { lang: 'en' } });
});

test('during a tour step the top-bar language switch keeps the step; Escape does what "Saltar" does (R-78)', async () => {
  signedInAs('ana@empresa.co', SEEN);
  renderAt(<App />);
  fireEvent.click(await signedInTopBar());
  await screen.findByRole('heading', { name: 'Bandeja', level: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  await screen.findByRole('heading', { name: 'Nueva factura', level: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'en' }));
  expect(await screen.findByRole('heading', { name: 'New invoice', level: 2 })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(fakeAuth.updateUser).toHaveBeenCalledWith({ data: { tour_seen: true } }));
});

// R-98 (AC-28 Clarified): a language switch re-fetches the screen on view, so the record comes back in that language.
test('switching the language re-fetches the screen on view with the new X-Lang', async () => {
  signedInAs('ana@empresa.co', SEEN);
  const fetchMock = mockApi(INBOX);
  renderAt(<App />);
  await signedInTopBar();
  const langsOf = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/screen/inbox')).map(([u, i]) => `${u} ${new Headers(i!.headers).get('X-Lang')}`);
  await waitFor(() => expect(langsOf()).toEqual(['/api/screen/inbox?lang=es es']));
  fireEvent.click(screen.getByRole('button', { name: 'en' }));
  await waitFor(() => expect(langsOf()).toEqual(['/api/screen/inbox?lang=es es', '/api/screen/inbox?lang=en en']));
});

// AC-94 (R-137): a stored session that takes a while to restore must not bounce a deep link to Bandeja.
test('with a stored session that resolves late, /policy shows Política and the address never changes (AC-94, R-137)', async () => {
  signedInAs('ana@empresa.co', SEEN);
  const stored = currentSession();
  fakeAuth.onAuthStateChange.mockImplementation((cb) => {
    setTimeout(() => cb('INITIAL_SESSION', stored), 150);
    return { data: { subscription: { unsubscribe: () => true } } };
  });
  mockApi({ ...INBOX, 'GET /api/screen/policy': { versions: [], company: null, fx: { rates: [] } } });
  const Where = () => <output data-testid="where">{useLocation().pathname}</output>;
  const seen: string[] = [];
  const watch = setInterval(() => seen.push(document.querySelector('[data-testid=where]')?.textContent ?? ''), 10);
  renderAt(<><App /><Where /></>, { at: '/policy' });
  expect(await screen.findByRole('heading', { name: 'Política', level: 1 })).toBeTruthy();
  clearInterval(watch);
  expect(seen.length).toBeGreaterThan(5); // the restore really was pending while we watched
  expect(new Set(seen)).toEqual(new Set(['/policy']));
});

// AC-94 (R-137, D41 door QA UX-07): a trial user who never finished the tour reopens a bookmark; the tour must not carry them to Bandeja.
test('a deep link with a stored session and an unfinished tour stays on Política: the tour does not auto-start there (AC-94, R-137)', async () => {
  signedInAs('ana@empresa.co'); // tour_seen not set
  mockApi({ ...INBOX, 'GET /api/screen/policy': { versions: [], company: null, fx: { rates: [] } } });
  const Where = () => <output data-testid="where">{useLocation().pathname}</output>;
  renderAt(<><App /><Where /></>, { at: '/policy' });
  expect(await screen.findByRole('heading', { name: 'Política', level: 1 })).toBeTruthy();
  await new Promise((r) => setTimeout(r, 300)); // the tour would have navigated by now
  expect(document.querySelector('.tour')).toBeNull();
  expect(screen.getByTestId('where').textContent).toBe('/policy');
  fireEvent.click(await signedInTopBar('Ver tutorial')); // asked for on purpose, it still starts
  await waitFor(() => expect(document.querySelector('.tour')).not.toBeNull());
});
