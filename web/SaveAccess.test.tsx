// AC-95: «Guardar mi acceso» attaches an email and a password to the same anonymous user (supabase updateUser, R-118),
// and AC-94's trial top bar that opens it. Supabase Auth is faked; nothing here calls real Auth.
import type { Session } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, type Mock } from 'vitest';
import App from './App';
import SaveAccess from './components/SaveAccess';
import { currentSession } from './test/supabase';
import { fakeAuth, mockApi, renderAt, signedInAs } from './test/utils';

const COMPANY = { id: 'c1', name: 'Empresa de prueba 7', approver_email: null, lang: 'es', is_demo: false, is_trial: true };
const EMAIL = 'qa-trial-5b1e@example.com';
const PASSWORD = 'secreta-123';

// An unsaved trial: the fake session with no email and is_anonymous (it has seen the tour, so no tour dialog in the way).
const anonymous = () => {
  signedInAs('', { tour_seen: true });
  Object.assign(currentSession()!.user, { id: '3f9a1c2b-0000-4000-8000-000000000000', email: '', is_anonymous: true });
};
const emit = (event: string, s: Session) => fakeAuth.onAuthStateChange.mock.calls.forEach(([cb]) => cb(event, s));
const updateUser = fakeAuth.updateUser as unknown as Mock;
const lang = updateUser.getMockImplementation()!; // the shared fake's own: { data } only (lang, tour_seen)
afterEach(() => updateUser.mockImplementation(lang));
// What GoTrue answers to updateUser({ email, password }) on an anonymous user with autoconfirm on (the E1 probe).
const saves = () => updateUser.mockImplementation(async ({ email }: { email: string }) => {
  const s = currentSession()!;
  Object.assign(s.user, { email, is_anonymous: false, email_confirmed_at: '2026-10-17T19:00:00Z' });
  emit('USER_UPDATED', { ...s });
  return { data: { user: s.user }, error: null };
});
const refuses = (error: unknown) => updateUser.mockImplementation(async () => ({ data: { user: null }, error }));
const authError = (message: string, code: string, status: number) => Object.assign(new Error(message), { code, status });

beforeEach(() => mockApi({ 'GET /api/company': COMPANY, 'GET /api/invoices': [], 'GET /api/agent/last-run': null }));

const dialog = () => screen.findByRole('dialog', { name: 'Guardar mi acceso' });
const fill = (d: HTMLElement, email: string, password: string) => {
  fireEvent.change(within(d).getByLabelText('Correo'), { target: { value: email } });
  fireEvent.change(within(d).getByLabelText('Contraseña'), { target: { value: password } });
  fireEvent.click(within(d).getByRole('button', { name: 'Guardar mi acceso' }));
};
const openFromTopBar = async () => {
  anonymous();
  renderAt(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Guardar mi acceso' }));
  return dialog();
};
const topBar = () => document.querySelector<HTMLElement>('header.topbar')!;

test('the trial top bar shows the company, «Acceso sin guardar» and «Guardar mi acceso»; never a blank, null or undefined (AC-94)', async () => {
  anonymous();
  renderAt(<App />);
  await waitFor(() => expect(topBar().textContent).toContain('Empresa de prueba 7'));
  expect(topBar().textContent).toContain('Acceso sin guardar');
  expect(within(topBar()).getByText('Empresa de prueba 7').hasAttribute('data-user')).toBe(true); // R-131: the name is data, not copy
  expect(within(topBar()).getByRole('button', { name: 'Guardar mi acceso' })).toBeTruthy();
  expect(topBar().textContent).not.toMatch(/null|undefined/);
  for (const span of topBar().querySelectorAll('span')) expect(span.textContent!.trim()).not.toBe('');
});

test('a reload keeps the trial: the stored anonymous session opens the same workspace with no sign-in (AC-94)', async () => {
  anonymous(); // supabase-js keeps the session in localStorage; the fake hands it back on subscribe like a reload does
  renderAt(<App />, { at: '/policy' });
  expect(await screen.findByRole('heading', { name: 'Política', level: 1 })).toBeTruthy();
  expect(topBar().textContent).toContain('Acceso sin guardar');
  expect(fakeAuth.signInWithOtp).not.toHaveBeenCalled();
});

test('saving attaches the email and the password to the same user, says so, and the top bar then shows the email (AC-95)', async () => {
  saves();
  const d = await openFromTopBar();
  fill(d, ` ${EMAIL} `, PASSWORD);
  const submit = within(d).getByRole('button', { name: 'Guardando…' });
  expect(submit.getAttribute('aria-busy')).toBe('true'); // AC-91 item 4: busy at once
  expect((await within(d).findByRole('status')).textContent).toBe(
    `Listo: ya puedes entrar desde cualquier dispositivo con ${EMAIL} y tu contraseña.`);
  expect(updateUser).toHaveBeenCalledOnce();
  expect(updateUser).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD });
  await waitFor(() => expect(topBar().textContent).toContain(EMAIL));
  expect(topBar().textContent).not.toContain('Acceso sin guardar');
  expect(within(topBar()).queryByRole('button', { name: 'Guardar mi acceso' })).toBeNull();
  fireEvent.click(within(d).getByRole('button', { name: 'Cerrar' }));
  expect(screen.queryByRole('dialog', { name: 'Guardar mi acceso' })).toBeNull();
});

test('a password under 8 characters is refused before any call (AC-95)', async () => {
  const d = await openFromTopBar();
  fill(d, EMAIL, '1234567');
  expect((await within(d).findByRole('alert')).textContent).toBe('La contraseña debe tener al menos 8 caracteres.');
  expect(updateUser).not.toHaveBeenCalled();
});

test.each([
  ['an email that already has an account', () => refuses(authError('A user with this email address has already been registered', 'email_exists', 422)),
    'Ese correo ya tiene una cuenta en Thesaurus. Usa otro correo, o entra con ese correo desde la pantalla de inicio.'],
  ['a password Auth calls weak', () => refuses(authError('Password should be at least 8 characters.', 'weak_password', 422)),
    'La contraseña debe tener al menos 8 caracteres.'],
  ['a network failure (thrown)', () => updateUser.mockImplementation(async () => { throw new TypeError('Failed to fetch'); }),
    'No pude guardar tu acceso ahora; intenta de nuevo.'],
  ['a network failure (returned)', () => refuses(Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 })),
    'No pude guardar tu acceso ahora; intenta de nuevo.'],
])('%s shows its message in place, and the form stays to try again (AC-95)', async (_, arrange, message) => {
  arrange();
  const d = await openFromTopBar();
  fill(d, EMAIL, PASSWORD);
  expect((await within(d).findByRole('alert')).textContent).toBe(message);
  const submit = within(d).getByRole('button', { name: 'Guardar mi acceso' }) as HTMLButtonElement;
  expect(submit.disabled).toBe(false);
  expect(topBar().textContent).toContain('Acceso sin guardar');
});

test('in English: the form, the success and the errors are English (AC-95)', async () => {
  localStorage.setItem('lang', 'en');
  refuses(authError('A user with this email address has already been registered', 'email_exists', 422));
  anonymous();
  renderAt(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Save my access' }));
  const d = await screen.findByRole('dialog', { name: 'Save my access' });
  fireEvent.change(within(d).getByLabelText('Email'), { target: { value: EMAIL } });
  fireEvent.change(within(d).getByLabelText('Password'), { target: { value: 'short' } });
  fireEvent.click(within(d).getByRole('button', { name: 'Save my access' }));
  expect((await within(d).findByRole('alert')).textContent).toBe('The password needs at least 8 characters.');
  fireEvent.change(within(d).getByLabelText('Password'), { target: { value: PASSWORD } });
  fireEvent.click(within(d).getByRole('button', { name: 'Save my access' }));
  await waitFor(() => expect(within(d).getByRole('alert').textContent).toBe(
    'That email already has a Thesaurus account. Use another email, or sign in with it from the start screen.'));
  saves();
  fireEvent.click(within(d).getByRole('button', { name: 'Save my access' }));
  expect((await within(d).findByRole('status')).textContent).toBe(`Done: you can now sign in from any device with ${EMAIL} and your password.`);
});

test('the password has a show/hide toggle (AC-95)', async () => {
  renderAt(<SaveAccess onClose={() => {}} />);
  const password = screen.getByLabelText('Contraseña') as HTMLInputElement;
  expect(password.type).toBe('password');
  const toggle = screen.getByRole('button', { name: 'Mostrar contraseña' });
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(toggle);
  expect(password.type).toBe('text');
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
});

test.each([
  ['Cancelar', (d: HTMLElement) => fireEvent.click(within(d).getByRole('button', { name: 'Cancelar' }))],
  ['Escape', (d: HTMLElement) => fireEvent.keyDown(d, { key: 'Escape' })],
])('%s closes the dialog and changes nothing (AC-95)', async (_, dismiss) => {
  const d = await openFromTopBar();
  dismiss(d);
  expect(screen.queryByRole('dialog', { name: 'Guardar mi acceso' })).toBeNull();
  expect(updateUser).not.toHaveBeenCalled();
});

test('«Cerrar sesión» by an unsaved trial warns; its «Guardar mi acceso» opens the dialog; once saved, sign-out needs no warning (AC-94, R-119)', async () => {
  saves();
  anonymous();
  renderAt(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
  const warning = await screen.findByRole('alertdialog');
  await waitFor(() => expect(warning.textContent).toContain('no podrás volver a «Empresa de prueba 7»'));
  expect(fakeAuth.signOut).not.toHaveBeenCalled();
  const save = within(warning).getByRole('button', { name: 'Guardar mi acceso' });
  expect(save.className).toBe('primary');
  fireEvent.click(save);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  fill(await dialog(), EMAIL, PASSWORD);
  await waitFor(() => expect(topBar().textContent).toContain(EMAIL));
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
  await waitFor(() => expect(fakeAuth.signOut).toHaveBeenCalledOnce());
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

test('«Salir de todos modos» from the top bar signs the trial out and lands on /login (AC-94)', async () => {
  anonymous();
  renderAt(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
  await act(async () => {});
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Salir de todos modos' }));
  await waitFor(() => expect(fakeAuth.signOut).toHaveBeenCalledOnce());
  expect(await screen.findByRole('button', { name: 'Probar con mi propia empresa' })).toBeTruthy();
});

test('a user with an email signs out at once, with the email in the top bar (AC-94 unchanged for customers)', async () => {
  signedInAs('ana@empresa.co', { tour_seen: true });
  renderAt(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
  await waitFor(() => expect(fakeAuth.signOut).toHaveBeenCalledOnce());
  expect(screen.queryByRole('alertdialog')).toBeNull();
});
