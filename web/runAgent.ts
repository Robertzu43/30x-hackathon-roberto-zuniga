/**
 * Budgeted agent runs (AC-70, R-56..R-60). One server call decides only what fits in one Worker invocation,
 * so the browser keeps calling with the returned `cursor` until it is null.
 *
 *   runUntilDone({ first, next?, onProgress?, onBatch? }) -> { PAGAR, FRENAR, ESCALAR, errors, calls, error? }
 *     first       endpoint of call 1, no body ('/api/invoices/run', '/api/policy/reevaluate', '/api/demo/reset')
 *     next        endpoint of every later call, body {cursor}; default = first (reset: '/api/invoices/run')
 *     onProgress  after each answered call: n = decided + errors so far, m = n + remaining, done = last call
 *     onBatch     after each answered call, with the raw answer (e.g. reload the list)
 *   Stops on a null cursor, on a repeated cursor, on any non-2xx (error = its text) or after 20 calls.
 *   Never throws: counts so far are always returned. UI wiring: useRunAgent in components/RunProgress.tsx.
 */
import { api } from './api';

export type Batch = { PAGAR: number; FRENAR: number; ESCALAR: number; errors: number; remaining: number; cursor: string | null };
export type Progress = { n: number; m: number; done: boolean };
export type RunResult = { PAGAR: number; FRENAR: number; ESCALAR: number; errors: number; calls: number; error?: string };

const MAX_CALLS = 20;

export async function runUntilDone(o: {
  first: string;
  next?: string;
  onProgress?: (p: Progress) => void;
  onBatch?: (b: Batch) => void;
}): Promise<RunResult> {
  const r: RunResult = { PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, calls: 0 };
  let sent: string | undefined;
  while (r.calls < MAX_CALLS) {
    const path = r.calls === 0 ? o.first : (o.next ?? o.first);
    let b: Batch;
    r.calls++;
    try {
      b = await (sent === undefined ? api.post<Batch>(path) : api.post<Batch>(path, { cursor: sent }));
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e);
      return r;
    }
    for (const k of ['PAGAR', 'FRENAR', 'ESCALAR', 'errors'] as const) r[k] += b[k];
    const n = r.PAGAR + r.FRENAR + r.ESCALAR + r.errors;
    const done = b.cursor === null || b.cursor === sent || r.calls === MAX_CALLS;
    o.onBatch?.(b);
    o.onProgress?.({ n, m: n + b.remaining, done });
    if (done) return r;
    sent = b.cursor!;
  }
  return r;
}
