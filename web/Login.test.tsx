import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import Login, { route } from './pages/Login';
import { fakeAuth, mockApi, renderAt } from './test/utils';

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

test('/login is public and full-bleed', () => expect(route).toEqual({ path: '/login', public: true, fullBleed: true }));

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

test('a valid code decides pending invoices once, then opens Bandeja (AC-40)', async () => {
  const fetchMock = setup();
  await sendEmail();
  enterCode('123456');
  expect(await screen.findByText('bandeja')).toBeTruthy();
  expect(fakeAuth.verifyOtp).toHaveBeenCalledWith({ email: 'ana@empresa.co', token: '123456', type: 'email' });
  expect(runCalls(fetchMock)).toHaveLength(1);
});

test('Bandeja still opens when the agent run fails (the 5-minute cron decides them later)', async () => {
  mockApi({ 'POST /api/invoices/run': new Response('{"error":"x"}', { status: 500 }) });
  renderAt(<Routes><Route path="/login" element={<Login />} /><Route path="/" element={<p>bandeja</p>} /></Routes>, { at: '/login' });
  await sendEmail();
  enterCode('123456');
  expect(await screen.findByText('bandeja')).toBeTruthy();
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

test('while the first run is going, the screen counts the invoices decided so far, then opens Bandeja when the cursor is null', async () => {
  let finish: (v: unknown) => void = () => {};
  const bodies: unknown[] = [];
  mockApi({
    'POST /api/invoices/run': (init: RequestInit) => {
      bodies.push(init.body);
      return bodies.length === 1
        ? { PAGAR: 5, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 24, cursor: 'c1' }
        : new Promise((r) => (finish = r));
    },
  });
  renderAt(<Routes><Route path="/login" element={<Login />} /><Route path="/" element={<p>bandeja</p>} /></Routes>, { at: '/login' });
  await sendEmail();
  enterCode('123456');
  expect(await screen.findByText('Decidiendo tus facturas pendientes… 5 de 29')).toBeTruthy();
  expect(screen.queryByText('bandeja')).toBeNull();
  finish({ PAGAR: 24, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null });
  expect(await screen.findByText('bandeja')).toBeTruthy();
  expect(bodies).toEqual([undefined, '{"cursor":"c1"}']);
});

test('an error in the middle of the loop still opens Bandeja', async () => {
  let n = 0;
  mockApi({
    'POST /api/invoices/run': () => (n++ === 0 ? { PAGAR: 1, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 3, cursor: 'c1' } : new Response('{"error":"x"}', { status: 503 })),
  });
  renderAt(<Routes><Route path="/login" element={<Login />} /><Route path="/" element={<p>bandeja</p>} /></Routes>, { at: '/login' });
  await sendEmail();
  enterCode('123456');
  expect(await screen.findByText('bandeja')).toBeTruthy();
});
