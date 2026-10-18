import { expect, test, vi } from 'vitest';
import { api, ApiError, cacheOwner, cached, config, load, prefetch, reloadOnce } from './api';
import { mockApi, signedInAs } from './test/utils';
import { send } from './withField';

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

// R-98 (AC-28 Clarified): every call carries the tab's language, so the API renders the record in it.
test('sends the tab language as X-Lang on every call', async () => {
  const fetchMock = mockApi({ 'GET /api/invoices': [], 'POST /api/invoices/run': {} });
  sessionStorage.setItem('lang', 'en');
  await api.get('/api/invoices');
  expect(new Headers(fetchMock.mock.calls.at(-1)![1]!.headers).get('X-Lang')).toBe('en');
  sessionStorage.setItem('lang', 'es');
  await api.post('/api/invoices/run');
  expect(new Headers(fetchMock.mock.calls.at(-1)![1]!.headers).get('X-Lang')).toBe('es');
});

// R-98: the second client (withField.send, used by Policy and Beneficiaries) carries the tab language too.
test('withField send carries the tab language as X-Lang for es and en', async () => {
  const fetchMock = mockApi({ 'PUT /api/policy': {}, 'POST /api/beneficiaries': {} });
  sessionStorage.setItem('lang', 'en');
  await send('PUT', '/api/policy', {});
  expect(new Headers(fetchMock.mock.calls.at(-1)![1]!.headers).get('X-Lang')).toBe('en');
  sessionStorage.setItem('lang', 'es');
  await send('POST', '/api/beneficiaries', {});
  expect(new Headers(fetchMock.mock.calls.at(-1)![1]!.headers).get('X-Lang')).toBe('es');
});

// AC-100: the per-tab screen cache. A screen GET is remembered for this tab; any write from this tab drops it.
test('load remembers a screen answer for this tab; a prefetch and the screen share one request', async () => {
  signedInAs('ana@empresa.co');
  const fetchMock = mockApi({ 'GET /api/screen/policy': { versions: [] } });
  prefetch('/api/screen/policy');
  expect(await load('/api/screen/policy')).toEqual({ versions: [] });
  expect(fetchMock.mock.calls.filter(([u]) => u === '/api/screen/policy')).toHaveLength(1);
  expect(cached('/api/screen/policy')).toEqual({ versions: [] });
  prefetch('/api/screen/policy'); // already here: no second request
  expect(fetchMock.mock.calls.filter(([u]) => u === '/api/screen/policy')).toHaveLength(1);
});

// AC-98 Clarified (R-177): the click after a hover opens the screen on the prefetch's request, in flight or finished.
test('hover then click calls fetch once, even when the prefetch finished first', async () => {
  signedInAs('ana@empresa.co');
  const fetchMock = mockApi({ 'GET /api/screen/beneficiaries': { beneficiaries: [] } });
  const gets = () => fetchMock.mock.calls.filter(([u]) => u === '/api/screen/beneficiaries').length;
  prefetch('/api/screen/beneficiaries');
  await vi.waitFor(() => expect(cached('/api/screen/beneficiaries')).toBeDefined()); // the prefetch is done
  expect(await load('/api/screen/beneficiaries')).toEqual({ beneficiaries: [] }); // the click: the screen's load
  expect(gets()).toBe(1);
  await load('/api/screen/beneficiaries'); // a later visit revalidates (AC-100)
  expect(gets()).toBe(2);
});

test('a click alone calls fetch once', async () => {
  signedInAs('ana@empresa.co');
  const fetchMock = mockApi({ 'GET /api/screen/policy': { versions: [] } });
  await load('/api/screen/policy');
  expect(fetchMock.mock.calls.filter(([u]) => u === '/api/screen/policy')).toHaveLength(1);
});

test.each([
  ['api.post', () => api.post('/api/invoices/run')],
  ['api.put', () => api.put('/api/company', {})],
  ['withField send', () => send('POST', '/api/beneficiaries', {})],
  ['a failed write', () => api.post('/api/nope').catch(() => {})],
])('%s drops the cache (AC-100)', async (_, write) => {
  mockApi({ 'GET /api/screen/beneficiaries': { beneficiaries: [] }, 'POST /api/invoices/run': {}, 'PUT /api/company': {}, 'POST /api/beneficiaries': {} });
  await load('/api/screen/beneficiaries');
  await write();
  expect(cached('/api/screen/beneficiaries')).toBeUndefined();
});

test('an answer that left before a write is never cached after it', async () => {
  let release: (r: Response) => void = () => {};
  mockApi({ 'GET /api/screen/period?month=2026-10': () => new Promise<Response>((r) => (release = r)), 'POST /api/invoices/run': {} });
  const late = load('/api/screen/period?month=2026-10');
  await new Promise((r) => setTimeout(r, 0));
  await api.post('/api/invoices/run');
  release(new Response(JSON.stringify({ period: 'old' })));
  await late;
  expect(cached('/api/screen/period?month=2026-10')).toBeUndefined();
});

test('another signed-in user drops the cache; the same user keeps it', async () => {
  mockApi({ 'GET /api/screen/policy': { versions: [] } });
  cacheOwner('id:ana');
  await load('/api/screen/policy');
  cacheOwner('id:ana');
  expect(cached('/api/screen/policy')).toBeDefined();
  cacheOwner('id:luis');
  expect(cached('/api/screen/policy')).toBeUndefined();
});

test('the cache is per language: an answer in es is not shown to an en tab', async () => {
  mockApi({ 'GET /api/invoices/inv-1': { headline: 'PAGAR · …' } });
  sessionStorage.setItem('lang', 'es');
  await load('/api/invoices/inv-1');
  sessionStorage.setItem('lang', 'en');
  expect(cached('/api/invoices/inv-1')).toBeUndefined();
});

// AC-99: a deploy removes the page chunks an open tab may still ask for; the tab reloads once to get the new ones, never in a loop.
test('a missing chunk reloads the tab once; a second miss within 10 s does not reload again', async () => {
  mockApi({ 'HEAD /': {} });
  const reload = vi.fn();
  await reloadOnce(reload);
  expect(reload).toHaveBeenCalledTimes(1);
  await reloadOnce(reload);
  expect(reload).toHaveBeenCalledTimes(1);
  sessionStorage.setItem('chunk-reload', String(Date.now() - 11_000));
  await reloadOnce(reload);
  expect(reload).toHaveBeenCalledTimes(2);
});

// AC-91 item 4: with no network a reload lands on the browser's own error page; the page keeps its designed message instead.
// Offline (navigator.onLine false) and a network that drops while the browser still says online both fail the probe.
test('a missing chunk with the server out of reach never reloads the tab; once it answers, the first miss gets its reload', async () => {
  mockApi({ 'HEAD /': () => { throw new TypeError('Failed to fetch'); } });
  const reload = vi.fn();
  await reloadOnce(reload);
  expect(reload).not.toHaveBeenCalled();
  mockApi({ 'HEAD /': {} });
  await reloadOnce(reload);
  expect(reload).toHaveBeenCalledTimes(1);
});

// AC-100 «dropped after any write»: a screen GET that leaves while a write is in flight may carry the pre-write data.
test.each([
  ['api.post', () => api.post('/api/invoices/run')],
  ['withField send', () => send('POST', '/api/beneficiaries', {})],
])('a screen GET started during a %s is not kept once the write settles, whichever answers first', async (_, write) => {
  for (const getFirst of [true, false]) {
    let finishWrite: ((r: Response) => void) | undefined;
    let finishGet: ((r: Response) => void) | undefined;
    const writeReply = () => new Promise<Response>((r) => (finishWrite = r));
    mockApi({ 'GET /api/screen/period?month=2026-10': () => new Promise<Response>((r) => (finishGet = r)), 'POST /api/invoices/run': writeReply, 'POST /api/beneficiaries': writeReply });
    const writing = write();
    await vi.waitFor(() => expect(finishWrite).toBeDefined());
    prefetch('/api/screen/period?month=2026-10'); // the hover on «Periodo» while the write runs
    await vi.waitFor(() => expect(finishGet).toBeDefined());
    const old = () => finishGet!(new Response(JSON.stringify({ period: 'before the write' })));
    const done = () => finishWrite!(new Response('{}'));
    if (getFirst) old();
    done();
    if (!getFirst) old();
    await writing;
    await new Promise((r) => setTimeout(r, 0));
    expect(cached('/api/screen/period?month=2026-10'), getFirst ? 'GET answered first' : 'write answered first').toBeUndefined();
  }
});

// R-150 lever 4 (AC-107): one retry, about 300 ms later, on a 5xx from a screen GET or the demo overview; never a POST.
const status = (n: number) => new Response(JSON.stringify({ error: `fallo ${n}` }), { status: n });
test.each(['/api/screen/inbox?lang=es', '/api/demo/overview'])('a 5xx on GET %s is retried once, about 300 ms later', async (path) => {
  signedInAs('ana@empresa.co');
  let n = 0;
  const at: number[] = [];
  const f = mockApi({ [`GET ${path}`]: () => (at.push(Date.now()), ++n === 1 ? status(503) : { ok: n }) });
  expect(await api.get(path)).toEqual({ ok: 2 });
  expect(f.mock.calls.filter(([u]) => u === path)).toHaveLength(2);
  expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(250);
});

test('a second 5xx throws the ApiError of the second answer; there is no third request', async () => {
  let n = 0;
  const f = mockApi({ 'GET /api/screen/inbox?lang=es': () => status(++n === 1 ? 503 : 500) });
  const e = await api.get('/api/screen/inbox?lang=es').catch((x: unknown) => x);
  expect([e instanceof ApiError, (e as ApiError).status, (e as ApiError).message]).toEqual([true, 500, 'fallo 500']);
  expect(f.mock.calls.filter(([u]) => u === '/api/screen/inbox?lang=es')).toHaveLength(2);
});

test.each([
  ['POST', '/api/invoices/run', 503],
  ['GET', '/api/screen/inbox?lang=es', 404],
  ['GET', '/api/company', 503], // R-150 names Bandeja's request and the demo overview only
  ['GET', '/api/screen/policy', 500],
])('%s %s answering %i is not retried', async (method, path, code) => {
  const f = mockApi({ [`${method} ${path}`]: () => status(code) });
  await expect(method === 'POST' ? api.post(path) : api.get(path)).rejects.toBeInstanceOf(ApiError);
  expect(f.mock.calls.filter(([u]) => u === path)).toHaveLength(1);
});
