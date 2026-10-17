import { expect, test } from 'vitest';
import { api, ApiError, config } from './api';
import { mockApi, signedInAs } from './test/utils';

test('attaches the session JWT as a bearer token', async () => {
  signedInAs('ana@empresa.co');
  const fetchMock = mockApi({ 'GET /api/invoices': [{ id: '1' }] });
  expect(await api.get('/api/invoices')).toEqual([{ id: '1' }]);
  const init = fetchMock.mock.calls.at(-1)![1]!;
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt:ana@empresa.co');
});

test('sends no Authorization header without a session (public pages)', async () => {
  const fetchMock = mockApi({ 'GET /api/demo/overview': { rows: [] } });
  await api.get('/api/demo/overview');
  expect(new Headers(fetchMock.mock.calls.at(-1)![1]!.headers).has('Authorization')).toBe(false);
});

test('post sends JSON; put too', async () => {
  const fetchMock = mockApi({ 'POST /api/invoices/run': { decided: 0 }, 'PUT /api/company': { ok: true } });
  await api.post('/api/invoices/run', { a: 1 });
  let init = fetchMock.mock.calls.at(-1)![1]!;
  expect(init.body).toBe('{"a":1}');
  expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  await api.put('/api/company', { name: 'X' });
  init = fetchMock.mock.calls.at(-1)![1]!;
  expect([init.method, init.body]).toEqual(['PUT', '{"name":"X"}']);
});

test('post passes FormData through untouched (file upload)', async () => {
  const fetchMock = mockApi({ 'POST /api/invoices': { id: '9' } });
  const form = new FormData();
  await api.post('/api/invoices', form);
  const init = fetchMock.mock.calls.at(-1)![1]!;
  expect(init.body).toBe(form);
  expect(new Headers(init.headers).has('Content-Type')).toBe(false);
});

test('a non-2xx answer throws ApiError with the JSON error and the status', async () => {
  mockApi({ 'POST /api/approve/t': new Response(JSON.stringify({ error: 'Este enlace ya se usó' }), { status: 409 }) });
  const e = await api.post('/api/approve/t').catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  expect(e).toMatchObject({ message: 'Este enlace ya se usó', status: 409 });
});

test('config exposes the demo email', async () => expect((await config()).demo_email).toBe('demo@andina-labs.example'));
