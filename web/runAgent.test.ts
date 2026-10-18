import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError, api } from './api';
import { runUntilDone } from './runAgent';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: { post: vi.fn() } }));
const post = vi.mocked(api.post);
const batch = (o: Partial<Record<string, unknown>> = {}) => ({ PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null, ...o });

beforeEach(() => post.mockReset());

test('three batches then a null cursor: sums the counts and reports progress n of m', async () => {
  post
    .mockResolvedValueOnce(batch({ PAGAR: 5, FRENAR: 2, ESCALAR: 1, remaining: 21, cursor: 'a' }))
    .mockResolvedValueOnce(batch({ PAGAR: 6, ESCALAR: 2, errors: 1, remaining: 11, cursor: 'b' }))
    .mockResolvedValueOnce(batch({ PAGAR: 7, FRENAR: 4, remaining: 0, cursor: null }));
  const onProgress = vi.fn();
  const onBatch = vi.fn();
  const r = await runUntilDone({ first: '/api/invoices/run', onProgress, onBatch });
  // Sum of the three fixture batches (5+6+7, 2+4, 1+2). Not the 29-invoice dataset (15 PAGAR, 3 FRENAR, 11 ESCALAR).
  expect(r).toEqual({ PAGAR: 18, FRENAR: 6, ESCALAR: 3, errors: 1, calls: 3 });
  expect(onProgress.mock.calls.map(([p]) => p)).toEqual([
    { n: 8, m: 29, done: false },
    { n: 17, m: 28, done: false },
    { n: 28, m: 28, done: true },
  ]);
  expect(onBatch).toHaveBeenCalledTimes(3);
  expect(onBatch.mock.calls[0]![0]).toMatchObject({ PAGAR: 5, cursor: 'a' });
});

test('the first call sends no body; every continuation sends {cursor}', async () => {
  post.mockResolvedValueOnce(batch({ remaining: 2, cursor: 'a' })).mockResolvedValueOnce(batch({ remaining: 1, cursor: 'b' })).mockResolvedValueOnce(batch());
  await runUntilDone({ first: '/api/policy/reevaluate' });
  expect(post.mock.calls).toEqual([['/api/policy/reevaluate'], ['/api/policy/reevaluate', { cursor: 'a' }], ['/api/policy/reevaluate', { cursor: 'b' }]]);
});

test('reset-like use: first and next are different endpoints', async () => {
  post.mockResolvedValueOnce(batch({ remaining: 3, cursor: 'a' })).mockResolvedValueOnce(batch());
  await runUntilDone({ first: '/api/demo/reset', next: '/api/invoices/run' });
  expect(post.mock.calls).toEqual([['/api/demo/reset'], ['/api/invoices/run', { cursor: 'a' }]]);
});

test('stops when a call returns the cursor it was sent (no progress)', async () => {
  post.mockResolvedValue(batch({ PAGAR: 1, remaining: 4, cursor: 'a' }));
  const onProgress = vi.fn();
  const r = await runUntilDone({ first: '/api/invoices/run', onProgress });
  expect(r.calls).toBe(2);
  expect(r.PAGAR).toBe(2);
  expect(onProgress.mock.calls.at(-1)![0].done).toBe(true);
});

test('stops on a non-2xx and returns the response text, keeping the counts so far', async () => {
  post.mockResolvedValueOnce(batch({ PAGAR: 3, remaining: 5, cursor: 'a' })).mockRejectedValueOnce(new ApiError('Cursor no válido', 400));
  expect(await runUntilDone({ first: '/api/invoices/run' })).toEqual({ PAGAR: 3, FRENAR: 0, ESCALAR: 0, errors: 0, calls: 2, error: 'Cursor no válido' });
});

test('a first call that fails returns its error and no counts', async () => {
  post.mockRejectedValueOnce(new ApiError('No pude reiniciar la demo; intenta de nuevo.', 503));
  const r = await runUntilDone({ first: '/api/demo/reset', next: '/api/invoices/run' });
  expect(r).toMatchObject({ calls: 1, PAGAR: 0, error: 'No pude reiniciar la demo; intenta de nuevo.' });
});

test('stops after 20 calls even if cursors keep changing', async () => {
  let i = 0;
  post.mockImplementation(async () => batch({ ESCALAR: 1, remaining: 99, cursor: `c${i++}` }));
  const r = await runUntilDone({ first: '/api/policy/reevaluate' });
  expect([r.calls, r.ESCALAR, post.mock.calls.length]).toEqual([20, 20, 20]);
});

// R-175: a "busy" answer (503: the company's run is still going) is retried after `busyWait` ms, up to 3 times, then fails.
test('busyWait: a 503 is retried up to 3 times, then the run stops with its text', async () => {
  for (let i = 0; i < 4; i++) post.mockRejectedValueOnce(new ApiError('ocupado', 503));
  const r = await runUntilDone({ first: '/api/invoices/run', busyWait: 1 });
  expect(post.mock.calls).toHaveLength(4);
  expect([r.calls, r.error]).toEqual([1, 'ocupado']);
});

test('busyWait: a busy continuation is retried with the same cursor', async () => {
  post.mockResolvedValueOnce(batch({ PAGAR: 1, remaining: 1, cursor: 'a' })).mockRejectedValueOnce(new ApiError('ocupado', 503)).mockResolvedValueOnce(batch({ PAGAR: 1 }));
  const r = await runUntilDone({ first: '/api/invoices/run', busyWait: 1 });
  expect(post.mock.calls).toEqual([['/api/invoices/run'], ['/api/invoices/run', { cursor: 'a' }], ['/api/invoices/run', { cursor: 'a' }]]);
  expect(r).toEqual({ PAGAR: 2, FRENAR: 0, ESCALAR: 0, errors: 0, calls: 2 });
});

test('without busyWait a 503 stops the run at once', async () => {
  post.mockRejectedValueOnce(new ApiError('ocupado', 503));
  expect(await runUntilDone({ first: '/api/invoices/run' })).toMatchObject({ calls: 1, error: 'ocupado' });
  expect(post).toHaveBeenCalledTimes(1);
});

test('busyWait: a sign-out during the wait ends the run, the retry is never sent', async () => {
  post.mockRejectedValueOnce(new ApiError('ocupado', 503));
  const stop = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
  await runUntilDone({ first: '/api/invoices/run', busyWait: 1, stop });
  expect(post).toHaveBeenCalledTimes(1);
});
