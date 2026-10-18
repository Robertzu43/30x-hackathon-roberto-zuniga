// Market FX (D28, AC-73, R-85): USD pairs through a provider chain. Providers quote units per USD; a row stores USD per
// unit, 1 / quote rounded to 8 significant digits, and the engine converts with exactly that stored value (R-85.2).
// Only src/agent/record.ts writes these rows (AC-38), and only rows built here from a provider response.

export interface Rate { day: string; currency: string; usd_per_unit: number; source: string; fetched_at: string }
export interface FxProvider { name: string; fetchRates(currencies: string[]): Promise<Rate[]> }

// The daily cron's currencies (AC-73), plus every currency pinned in a company's latest policy.
export const CRON_CURRENCIES = ['COP', 'MXN', 'BRL', 'ARS', 'EUR'];
const SANITY = 0.25; // R-85.4: a value further than this from the newest stored rate is a provider glitch
const UA = { 'user-agent': 'thesaurus-fx/1.0' }; // Yahoo answers 429 to a request without one

export const usdPerUnit = (quote: unknown): number | null =>
  typeof quote === 'number' && Number.isFinite(quote) && quote > 0 ? Number((1 / quote).toPrecision(8)) : null;

function row(currency: string, quote: unknown, source: string): Rate | null {
  const usd_per_unit = usdPerUnit(quote);
  const fetched_at = new Date().toISOString();
  return usd_per_unit === null ? null : { day: fetched_at.slice(0, 10), currency, usd_per_unit, source, fetched_at };
}
const ok = (r: Rate | null): r is Rate => r !== null;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function getJson(f: typeof fetch, url: string): Promise<unknown> {
  const res = await f(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// One request per currency: one bad answer (429, garbage) loses only that currency.
const yahoo = (f: typeof fetch): FxProvider => ({
  name: 'yahoo',
  fetchRates: async (currencies) => (await Promise.all(currencies.map(async (c) => {
    try {
      const j = await getJson(f, `https://query1.finance.yahoo.com/v8/finance/chart/USD${c}=X?range=1d&interval=1d`) as
        { chart?: { result?: Array<{ meta?: { regularMarketPrice?: unknown } }> } };
      return row(c, j.chart?.result?.[0]?.meta?.regularMarketPrice, 'Yahoo Finance');
    } catch (e) {
      console.error('fx: yahoo', c, message(e));
      return null;
    }
  }))).filter(ok),
});

// One request for every currency.
const erApi = (f: typeof fetch): FxProvider => ({
  name: 'er-api',
  async fetchRates(currencies) {
    const j = await getJson(f, 'https://open.er-api.com/v6/latest/USD') as { rates?: Record<string, unknown> };
    return currencies.map((c) => row(c, j.rates?.[c], 'open.er-api.com')).filter(ok);
  },
});

// FX_PROVIDER first, then the other. An unknown name is a config typo, not a rate: log it, keep FX working (R-85.8).
export function providers(name: string | undefined, f: typeof fetch): FxProvider[] {
  if (name === 'er-api') return [erApi(f), yahoo(f)];
  if (name !== undefined && name !== 'yahoo') console.error('fx: unknown FX_PROVIDER, using yahoo then er-api:', name);
  return [yahoo(f), erApi(f)];
}

// Each currency once, through the chain until a provider gives a finite value > 0 within 25 % of the newest stored rate
// (newest: currency -> stored usd_per_unit). Never throws: whatever no provider gave is logged and left out.
export async function fetchChain(chain: FxProvider[], currencies: string[], newest: Record<string, number>): Promise<Rate[]> {
  let left = [...new Set(currencies)].filter((c) => /^[A-Z]{3}$/.test(c) && c !== 'USD');
  const out: Rate[] = [];
  for (const p of chain) {
    if (!left.length) break;
    const got = await p.fetchRates(left).catch((e: unknown) => { console.error('fx:', p.name, message(e)); return []; });
    const kept = got.filter((r) => {
      const prev = newest[r.currency];
      const sane = left.includes(r.currency) && (prev === undefined || Math.abs(r.usd_per_unit - prev) <= SANITY * prev);
      if (!sane) console.error('fx: discarded', p.name, r.currency, r.usd_per_unit, 'stored', prev);
      return sane;
    });
    out.push(...kept);
    left = left.filter((c) => !kept.some((r) => r.currency === c));
  }
  if (left.length) console.error('fx: no provider gave a usable rate for', left.join(','));
  return out;
}
