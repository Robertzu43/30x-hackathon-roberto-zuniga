import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import App, { pages } from './App';
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

test('routes come from web/pages/*.tsx: one page per screen, each with a path and a component', () => {
  expect(pages.map((p) => p.route.path).sort()).toEqual(
    ['/', '/approve/:token', '/beneficiaries', '/demo', '/invoices/:id', '/login', '/period', '/policy'].sort(),
  );
  for (const p of pages) expect(typeof p.default).toBe('function');
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
