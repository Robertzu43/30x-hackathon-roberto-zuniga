import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import App, { pages } from './App';
import { DEMO_EMAIL, fakeAuth, renderAt, signedInAs } from './test/utils';

const SEEN = { tour_seen: true };

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
  fireEvent.click(await screen.findByRole('button', { name: 'Ver tutorial' }));
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

test('the demo user always gets the tour and skipping it stores nothing (R-17)', async () => {
  signedInAs(DEMO_EMAIL, SEEN);
  renderAt(<App />);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Saltar' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(fakeAuth.updateUser).not.toHaveBeenCalledWith({ data: { tour_seen: true } });
});

test('the top bar language switch changes the UI without reload and stores it on the user (AC-41)', async () => {
  signedInAs('ana@empresa.co', { ...SEEN, lang: 'es' });
  renderAt(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'en' }));
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
  fireEvent.click(await screen.findByRole('button', { name: 'Ver tutorial' }));
  await screen.findByRole('heading', { name: 'Bandeja', level: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  // Placeholder pages have no new-invoice / run-agent / invoice-row anchors yet, so those steps are skipped.
  expect(await screen.findByRole('heading', { name: 'Política', level: 2 }, { timeout: 8000 })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Política', level: 1 })).toBeTruthy();
}, 10000);
