// AC-99, AC-91 item 4: a page chunk on its way, and a page chunk that never comes (offline, or gone after a deploy).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { tab } from './api';
import App from './App';
import { mockApi, renderAt, signedInAs } from './test/utils';

// The two pages' chunks fail to load, as a dropped network or a removed hashed file makes them.
vi.mock('./pages/Period', () => { throw new TypeError('Failed to fetch dynamically imported module'); });
vi.mock('./pages/Policy', () => { throw new TypeError('Failed to fetch dynamically imported module'); });

const EMPTY = { invoices: [], last_run: null, portal: null, beneficiaries: [], dashboard: null };
const signedIn = () => {
  signedInAs('ana@empresa.co', { tour_seen: true });
  mockApi({ 'GET /api/screen/inbox?lang=es': EMPTY, 'GET /api/screen/inbox?lang=en': EMPTY });
};
afterEach(() => vi.restoreAllMocks());

test('while a page chunk loads, the fallback is a screen-reader status that takes no space (no margin to collapse)', () => {
  mockApi();
  renderAt(<App />, { at: '/login' });
  const status = screen.getByRole('status');
  expect(status.textContent).toBe('Cargando…');
  expect(status.className).toBe('sr-only');
});

test('a page chunk that fails offline shows the designed message and keeps the top bar and the nav', async () => {
  signedIn();
  renderAt(<App />, { at: '/period' });
  expect(await screen.findByText('No pude abrir esta pantalla. Revisa tu conexión e intenta de nuevo.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Secciones' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeTruthy();
});

test('two failing chunks in a row never blank the page; another screen still opens', async () => {
  signedIn();
  renderAt(<App />, { at: '/period' });
  await screen.findByRole('button', { name: 'Reintentar' });
  const nav = screen.getByRole('navigation', { name: 'Secciones' });
  fireEvent.click(within(nav).getByRole('link', { name: 'Política' }));
  expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Secciones' })).toBeTruthy();
  fireEvent.click(within(nav).getByRole('link', { name: 'Bandeja' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Bandeja' })).toBeTruthy();
});

test('«Reintentar» reloads the tab only once the server answers', async () => {
  signedIn();
  const reload = vi.spyOn(tab, 'reload').mockImplementation(() => {});
  renderAt(<App />, { at: '/period' });
  const retry = await screen.findByRole('button', { name: 'Reintentar' });
  mockApi({ 'HEAD /': () => { throw new TypeError('Failed to fetch'); } });
  fireEvent.click(retry);
  await act(async () => {});
  expect(reload).not.toHaveBeenCalled();
  mockApi({ 'HEAD /': {} });
  fireEvent.click(retry);
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
});

test('the message in English', async () => {
  signedIn();
  sessionStorage.setItem('lang', 'en');
  renderAt(<App />, { at: '/period' });
  await act(async () => {});
  expect(await screen.findByText('I could not open this screen. Check your connection and try again.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});
