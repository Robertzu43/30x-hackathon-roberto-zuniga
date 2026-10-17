// AC-35, AC-36, R-55: the public approval page. GET only shows; the one "Confirmar" button POSTs the shown seq.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import Approve from './pages/Approve';
import { mockApi, renderAt } from './test/utils';

const TOKEN = 'tok.abc';
const URL_ = `/api/approve/${TOKEN}`;
const view = (action: 'approve' | 'reject' = 'approve') => ({
  action,
  expires_at: '2026-10-19T12:00:00.000Z',
  invoice: { id: 'inv-9', source: 'pdf', received_at: '2026-10-16T10:00:00.000Z', fields: { payee_name: 'Nube Sur LLC', amount: 4200, currency: 'USD', invoice_number: 'NS-118' } },
  decision: {
    id: 'd-2', seq: 2, outcome: 'ESCALAR', amount_usd: 4200, policy_version: 1,
    headline_es: 'ESCALAR · 4.200 USD a Nube Sur LLC: supera el umbral de aprobación de 2.500 USD',
    headline_en: 'ESCALATE · 4,200 USD to Nube Sur LLC: above the approval threshold of 2,500 USD',
    question_es: '¿Apruebas pagar 4.200 USD a Nube Sur LLC?', question_en: 'Do you approve paying 4,200 USD to Nube Sur LLC?',
    checks: [
      { id: 'umbral_aprobacion', verdict: 'no_cumple', actual: '4200', threshold: '2500', values: { limit_usd: 2500 } },
      { id: 'limite_pago', verdict: 'cumple', actual: '4200', threshold: '5000', values: {} },
    ],
  },
});
const err = (status: number, error: string) => new Response(JSON.stringify({ error, message: 'x' }), { status });
const show = () => renderAt(<Approve />, { at: `/approve/${TOKEN}`, route: '/approve/:token' });
const posts = (f: ReturnType<typeof mockApi>) => f.mock.calls.filter(([, init]) => init?.method === 'POST');

test('GET alone shows the summary, the broken rule and one Confirmar button, and POSTs nothing (AC-35)', async () => {
  const f = mockApi({ [`GET ${URL_}`]: view() });
  show();
  expect(await screen.findByText(view().decision.headline_es)).toBeTruthy();
  expect(screen.getByText(view().decision.question_es)).toBeTruthy();
  expect(screen.getByText('Nube Sur LLC')).toBeTruthy();
  expect(screen.getByText('supera el umbral de aprobación de 2.500 USD')).toBeTruthy();
  expect(screen.getByText(/solo lo que una persona puede desbloquear/)).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Confirmar' })).toHaveLength(1);
  await new Promise((r) => setTimeout(r, 50));
  expect(posts(f)).toHaveLength(0);
});

test('Confirmar POSTs {seq} of the shown decision once and shows the resulting decision (R-55)', async () => {
  const f = mockApi({
    [`GET ${URL_}`]: view(),
    [`POST ${URL_}`]: { decision: { seq: 3, outcome: 'PAGAR', headline_es: 'PAGAR · 4.200 USD a Nube Sur LLC, aprobado por ana@andina.example', headline_en: 'PAY' } },
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));
  expect(await screen.findByText('PAGAR · 4.200 USD a Nube Sur LLC, aprobado por ana@andina.example')).toBeTruthy();
  expect(posts(f)).toHaveLength(1);
  expect(JSON.parse(String(posts(f)[0]![1]!.body))).toEqual({ seq: 2 });
  expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull();
});

test('a reject link says the invoice will be stopped', async () => {
  mockApi({ [`GET ${URL_}`]: view('reject') });
  show();
  expect(await screen.findByText(/la factura queda frenada y no se paga/)).toBeTruthy();
});

test('a spent pair: the POST answers 409 token_used and the page reads "Este enlace ya se usó" (AC-36)', async () => {
  mockApi({ [`GET ${URL_}`]: view(), [`POST ${URL_}`]: err(409, 'token_used') });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Este enlace ya se usó');
});

test.each([
  [404, 'invalid_token', 'Este enlace no es válido o venció'],
  [409, 'already_decided', 'Esta factura ya fue decidida'],
  [409, 'changed', 'Esta factura cambió desde que abriste el enlace; ábrelo de nuevo.'],
  [409, 'token_used', 'Este enlace ya se usó'],
])('GET %i %s shows "%s" and no button', async (status, code, text) => {
  mockApi({ [`GET ${URL_}`]: err(status, code) });
  show();
  expect((await screen.findByRole('alert')).textContent).toBe(text);
  expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull();
});

test('English: the page reads in the chosen language', async () => {
  localStorage.setItem('lang', 'en');
  mockApi({ [`GET ${URL_}`]: view() });
  show();
  expect(await screen.findByText(view().decision.headline_en)).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy());
});

// UX-17: a link that cannot be answered is no dead end under «Aprobar este pago»: its own heading and a next step in words.
test.each([
  ['es', 'No puedo mostrar este pago', 'Si todavía hay que responderlo, pídele a tu equipo de pagos un enlace nuevo.'],
  ['en', "I can't show this payment", 'If it still needs an answer, ask your payments team for a new link.'],
])('an invalid link (%s) gets its own heading and a next step, not the approve title', async (lang, title, next) => {
  localStorage.setItem('lang', lang);
  mockApi({ [`GET ${URL_}`]: err(404, 'invalid_token') });
  show();
  expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
  expect(screen.getByText(next)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /Aprobar este pago|Approve this payment/ })).toBeNull();
});

test('a failure after the link was shown keeps the approve heading: the summary is still on screen', async () => {
  mockApi({ [`GET ${URL_}`]: view(), [`POST ${URL_}`]: err(409, 'token_used') });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('heading', { level: 1, name: 'Aprobar este pago' })).toBeTruthy();
});

// AC-99 (R-109): while the link loads, its summary is drawn in the loaded markup with placeholders, hidden.
test('while loading, the summary is a skeleton with the loaded markup', () => {
  mockApi({ [`GET ${URL_}`]: () => new Promise(() => {}) });
  const { container } = show();
  const skeleton = container.querySelector('.approve .skeleton') as HTMLElement;
  expect(skeleton.getAttribute('aria-hidden')).toBe('true');
  expect(skeleton.hasAttribute('inert')).toBe(true);
  expect(skeleton.querySelector('dl.approve-read')).toBeTruthy();
  expect(skeleton.querySelector('ul.approve-broken')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Cargando…');
});

test('the skeleton is gone once the link answers, and on a dead link', async () => {
  mockApi({ [`GET ${URL_}`]: view() });
  const ok = show();
  await screen.findByRole('button', { name: 'Confirmar' });
  expect(ok.container.querySelector('.skeleton')).toBeNull();
  ok.unmount();
  mockApi({ [`GET ${URL_}`]: err(404, 'not_found') });
  const dead = show();
  await screen.findByRole('alert');
  expect(dead.container.querySelector('.skeleton')).toBeNull();
});
