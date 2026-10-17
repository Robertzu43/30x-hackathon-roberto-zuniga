/// <reference types="vite/client" />
// AC-73, R-85: the provider chain over recorded responses of both endpoints (17 Oct 2026). Never the real network (R-94).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import erApi from './__fixtures__/fx/er-api.json?raw';
import ARS from './__fixtures__/fx/yahoo-ARS.json?raw';
import BRL from './__fixtures__/fx/yahoo-BRL.json?raw';
import COP from './__fixtures__/fx/yahoo-COP.json?raw';
import EUR from './__fixtures__/fx/yahoo-EUR.json?raw';
import MXN from './__fixtures__/fx/yahoo-MXN.json?raw';
import { fetchChain, providers, usdPerUnit } from './fx';

const YAHOO: Record<string, string> = { COP, MXN, BRL, ARS, EUR };
const NOW = '2026-10-17T15:00:00.000Z';
const json = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
// The fake network: Yahoo answers from its recorded chart per currency, er-api from its recorded latest/USD.
function net(over: { yahoo?: (ccy: string) => Response; er?: () => Response } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const y = /finance\/chart\/USD([A-Z]{3})=X\?range=1d&interval=1d$/.exec(url);
    if (y) return over.yahoo?.(y[1]!) ?? json(YAHOO[y[1]!]);
    if (url === 'https://open.er-api.com/v6/latest/USD') return over.er?.() ?? json(erApi);
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('usd_per_unit (R-85.2)', () => {
  it('is 1 / units-per-USD rounded to 8 significant digits', () => {
    expect(usdPerUnit(3170.68)).toBe(0.00031538976);
    expect(usdPerUnit(0.8895)).toBe(1.1242271);
  });
  it.each([0, -1, NaN, Infinity, '3170', null, undefined])('%j is no rate', (q) => expect(usdPerUnit(q)).toBeNull());
});

describe('provider chain (AC-73)', () => {
  it('Yahoo ok -> rows with source Yahoo Finance, today (UTC) and fetched_at now; er-api never called', async () => {
    const f = net();
    const rows = await fetchChain(providers('yahoo', f), ['COP', 'MXN', 'BRL', 'ARS', 'EUR'], {});
    expect(rows).toEqual([
      { day: '2026-10-17', currency: 'COP', usd_per_unit: 0.00031538976, source: 'Yahoo Finance', fetched_at: NOW },
      { day: '2026-10-17', currency: 'MXN', usd_per_unit: 0.054115482, source: 'Yahoo Finance', fetched_at: NOW },
      { day: '2026-10-17', currency: 'BRL', usd_per_unit: 0.19726589, source: 'Yahoo Finance', fetched_at: NOW },
      { day: '2026-10-17', currency: 'ARS', usd_per_unit: 0.00065897858, source: 'Yahoo Finance', fetched_at: NOW },
      { day: '2026-10-17', currency: 'EUR', usd_per_unit: 1.1242271, source: 'Yahoo Finance', fetched_at: NOW },
    ]);
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual(['COP', 'MXN', 'BRL', 'ARS', 'EUR']
      .map((c) => `https://query1.finance.yahoo.com/v8/finance/chart/USD${c}=X?range=1d&interval=1d`));
  });

  it.each([
    ['a 429', () => new Response('Too Many Requests', { status: 429 })],
    ['garbage', () => new Response('<html>nope</html>')],
    ['a zero price', () => json({ chart: { result: [{ meta: { regularMarketPrice: 0 } }] } })],
  ])('Yahoo %s -> the rate comes from er-api with source open.er-api.com', async (_, yahoo) => {
    const f = net({ yahoo });
    expect(await fetchChain(providers('yahoo', f), ['COP'], {}))
      .toEqual([{ day: '2026-10-17', currency: 'COP', usd_per_unit: 0.00031419109, source: 'open.er-api.com', fetched_at: NOW }]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('only the currencies Yahoo could not give go to er-api', async () => {
    const f = net({ yahoo: (c) => (c === 'ARS' ? json({}) : json(YAHOO[c])) });
    const rows = await fetchChain(providers('yahoo', f), ['COP', 'ARS'], {});
    expect(rows.map((r) => [r.currency, r.source])).toEqual([['COP', 'Yahoo Finance'], ['ARS', 'open.er-api.com']]);
  });

  it('both failing -> no row, no throw, the error is logged', async () => {
    const f = net({ yahoo: () => { throw new TypeError('network down'); }, er: () => new Response('down', { status: 503 }) });
    await expect(fetchChain(providers('yahoo', f), ['COP', 'MXN'], {})).resolves.toEqual([]);
    expect(vi.mocked(console.error).mock.calls.some((c) => String(c.join(' ')).includes('COP,MXN'))).toBe(true);
  });

  it('a value more than 25 % off the newest stored rate is discarded and the next provider tried (R-85.4)', async () => {
    const stored = 0.00031538976 / 1.3; // Yahoo is 30 % above it; er-api too, so nothing is stored
    expect(await fetchChain(providers('yahoo', net()), ['COP'], { COP: stored })).toEqual([]);
    // Yahoo inflated 1000x, er-api sane: er-api's rate is stored
    const f = net({ yahoo: () => json({ chart: { result: [{ meta: { regularMarketPrice: 3170680 } }] } }) });
    expect((await fetchChain(providers('yahoo', f), ['COP'], { COP: 0.0003 })).map((r) => r.source)).toEqual(['open.er-api.com']);
  });

  it('within 25 % of the stored rate is kept', async () => {
    expect(await fetchChain(providers('yahoo', net()), ['COP'], { COP: 0.00031538976 / 1.2 })).toHaveLength(1);
  });

  it('FX_PROVIDER=er-api tries er-api first; Yahoo is never called when er-api answers', async () => {
    const f = net();
    const rows = await fetchChain(providers('er-api', f), ['COP', 'EUR'], {});
    expect(rows.map((r) => [r.currency, r.source])).toEqual([['COP', 'open.er-api.com'], ['EUR', 'open.er-api.com']]);
    expect(f).toHaveBeenCalledOnce();
  });

  it('an unknown FX_PROVIDER logs an error and uses the default chain (R-85.8)', async () => {
    expect(providers('bloomberg', net()).map((p) => p.name)).toEqual(['yahoo', 'er-api']);
    expect(providers(undefined, net()).map((p) => p.name)).toEqual(['yahoo', 'er-api']);
    expect(console.error).toHaveBeenCalledOnce();
  });

  it('asks nothing for USD, duplicates or a malformed code (no URL built from it)', async () => {
    const f = net();
    expect(await fetchChain(providers('yahoo', f), ['USD', 'COP', 'COP', 'co/p', ''], {})).toHaveLength(1);
    expect(f).toHaveBeenCalledOnce();
  });
});
