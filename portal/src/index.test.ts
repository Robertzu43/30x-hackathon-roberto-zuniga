/// <reference types="vite/client" />
// The `facturas` Worker (AC-83, AC-84, AC-85 items 1-5) with a fake MAIN binding and fake static assets.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en, es } from '../../src/i18n/features/portal';
import toml from '../wrangler.toml?raw';
import worker from './index';

type Input = { slug: string; text?: string; file?: { bytes: ArrayBuffer }; ip: string };
const SHELL = '<!doctype html><html lang="es"><head><!--boot--><script type="module" src="/app.js"></script></head><body></body></html>';
const TOKEN = 'a'.repeat(43);
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const MAIN = {
  company: vi.fn(async (slug: string) => (slug === 'andina-labs' ? { name: 'Andina Labs Inc.' } : null)),
  intake: vi.fn<(i: Input) => Promise<object>>(async () => ({ ok: true, reply: { es: ['Estado: en revisión'], en: ['Status: under review'] }, status_path: `/estado/${TOKEN}` })),
  status: vi.fn(async (token: string): Promise<object> => (token === TOKEN
    ? { ok: true, company: 'Andina Labs Inc.', status: { es: 'en revisión', en: 'under review' }, read: { es: [], en: [] }, updated_at: '2026-10-17T15:00:00Z' }
    : { ok: false, error: 'invalid' })),
};
const ASSETS = { fetch: vi.fn(async (r: Request | URL | string) => {
  const path = new URL(r instanceof Request ? r.url : r).pathname;
  return path === '/index.html' ? new Response(SHELL) : path === '/app.js' ? new Response('// js', { headers: { 'Content-Type': 'text/javascript' } }) : new Response('nf', { status: 404 });
}) };
const env = { MAIN, ASSETS } as never;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://facturas.test${path}`, init) as never, env);
const IP = { 'CF-Connecting-IP': '203.0.113.7' };
const post = (form: Record<string, string | Blob>, headers: Record<string, string> = IP, path = '/andina-labs') => {
  const body = new FormData();
  for (const [k, v] of Object.entries(form)) body.append(k, v);
  return call(path, { method: 'POST', body, headers });
};
const boot = async (res: Response) => JSON.parse(/<script type="application\/json" id="boot">([\s\S]*?)<\/script>/.exec(await res.text())![1]!);
const secured = (res: Response) => {
  expect(res.headers.get('Content-Security-Policy')).toBe(CSP);
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
};

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('pages (AC-83, AC-84)', () => {
  it('a known slug: the chat page with the company name and both dictionaries, hardened and not cached', async () => {
    const res = await call('/andina-labs');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/html/);
    secured(res);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await boot(res)).toEqual({ view: 'chat', company: 'Andina Labs Inc.', t: { es, en } });
  });

  it('an unknown slug, the root and any other path: the 404 page, which names no company', async () => {
    for (const path of ['/no-existe', '/', '/a/b', '/index.html', '/andina-labs/x']) {
      const res = await call(path);
      expect(res.status, path).toBe(404);
      secured(res);
      expect(await boot(res), path).toEqual({ view: 'not_found', t: { es, en } });
    }
    expect(MAIN.company.mock.calls).toEqual([['no-existe']]);
  });

  it('the status page: 200 with the data, an altered token 404, the 61st view 429; no-store and no-referrer', async () => {
    let res = await call(`/estado/${TOKEN}`, { headers: IP });
    expect(res.status).toBe(200);
    secured(res);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect((await boot(res)).status).toMatchObject({ company: 'Andina Labs Inc.', status: { es: 'en revisión' } });
    expect(MAIN.status).toHaveBeenCalledWith(TOKEN, '203.0.113.7');
    res = await call(`/estado/${'b'.repeat(43)}`);
    expect([res.status, (await boot(res)).view]).toEqual([404, 'invalid']);
    MAIN.status.mockResolvedValueOnce({ ok: false, error: 'rate_status' });
    res = await call(`/estado/${TOKEN}`);
    expect([res.status, (await boot(res)).view]).toEqual([429, 'rate_status']);
  });

  it("a status token of company A on company B's slug path is a 404 and never reaches MAIN", async () => {
    const res = await call(`/p-0123456789ab/estado/${TOKEN}`);
    expect(res.status).toBe(404);
    expect((await boot(res)).view).toBe('not_found');
    expect(MAIN.status).not.toHaveBeenCalled();
  });

  it('the boot data cannot break out of its script element', async () => {
    MAIN.company.mockResolvedValueOnce({ name: '</script><script>alert(1)</script>' });
    const res = await call('/andina-labs');
    const html = await res.clone().text();
    expect(html).not.toContain('<script>alert(1)');
    expect((await boot(res)).company).toBe('</script><script>alert(1)</script>');
  });

  it.each(["Pagos $' SAS", 'Pagos $` SAS', 'Pagos $& SAS', 'Pagos $$ SAS'])('a payee or company name with a replacement pattern survives in the boot JSON: %s', async (name) => {
    MAIN.company.mockResolvedValueOnce({ name });
    expect((await boot(await call('/andina-labs'))).company).toBe(name);
    MAIN.status.mockResolvedValueOnce({ ok: true, company: name, status: { es: 'en revisión', en: 'under review' }, read: { es: [name], en: [name] }, updated_at: '2026-10-17T15:00:00Z' });
    expect((await boot(await call(`/estado/${TOKEN}`))).status).toMatchObject({ company: name, read: { es: [name], en: [name] } });
  });

  it('static assets pass through with the same headers; other methods are refused', async () => {
    const res = await call('/app.js');
    expect([res.status, await res.text()]).toEqual([200, '// js']);
    secured(res);
    const put = await call('/andina-labs', { method: 'PUT' });
    expect(put.status).toBe(405);
    secured(put);
  });

  it('MAIN failing: a friendly 503 page, never its error', async () => {
    MAIN.company.mockRejectedValueOnce(new Error('db password wrong'));
    const res = await call('/andina-labs');
    expect(res.status).toBe(503);
    expect(await res.clone().text()).not.toContain('db password');
    expect((await boot(res)).view).toBe('unavailable');
  });
});

describe('sending (AC-85 items 2, 3 and 5)', () => {
  it('passes only the slug, the text, the file and the connecting IP; every other field is ignored', async () => {
    const res = await post({ text: 'factura', file: new File(['%PDF-1.7'], 'f.pdf', { type: 'application/pdf' }),
      company_id: 'B', invoice_id: 'x', beneficiary: 'Impostor', bank_account: '9999', amount: '9000', outcome: 'PAGAR', lang: 'en' });
    expect(res.status).toBe(200);
    secured(res);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: true, status_path: `/estado/${TOKEN}` });
    const input = MAIN.intake.mock.calls[0]![0];
    expect(Object.keys(input).sort()).toEqual(['file', 'ip', 'slug', 'text']);
    expect(input).toMatchObject({ slug: 'andina-labs', text: 'factura', ip: '203.0.113.7' });
    expect(new TextDecoder().decode(input.file!.bytes)).toBe('%PDF-1.7');
  });

  it('a forged X-Forwarded-For changes nothing: the IP key is CF-Connecting-IP', async () => {
    await post({ text: 'a' }, { ...IP, 'X-Forwarded-For': '1.2.3.4' });
    await post({ text: 'b' }, { ...IP, 'X-Forwarded-For': '5.6.7.8, 9.9.9.9' });
    expect(MAIN.intake.mock.calls.map((c) => c[0].ip)).toEqual(['203.0.113.7', '203.0.113.7']);
  });

  it('an 11 MB file is refused before the binding', async () => {
    const res = await post({ file: new File([new Uint8Array(11 * 1024 * 1024)], 'big.pdf') });
    expect([res.status, await res.json()]).toEqual([400, { ok: false, error: 'file' }]);
    expect(MAIN.intake).not.toHaveBeenCalled();
  });

  it.each([['not_found', 404], ['file', 400], ['text', 400], ['rate_ip', 429], ['rate_company', 429]])('%s answers %i', async (error, status) => {
    MAIN.intake.mockResolvedValueOnce({ ok: false, error });
    const res = await post({ text: 'x' });
    expect([res.status, await res.json()]).toEqual([status, { ok: false, error }]);
  });

  it('a body that is not a form is a text error; MAIN failing is a 503 «failed»', async () => {
    let res = await call('/andina-labs', { method: 'POST', body: '{"text":"x"}', headers: { 'Content-Type': 'application/json' } });
    expect([res.status, await res.json()]).toEqual([400, { ok: false, error: 'text' }]);
    MAIN.intake.mockRejectedValueOnce(new Error('boom'));
    res = await post({ text: 'x' });
    expect([res.status, await res.json()]).toEqual([503, { ok: false, error: 'failed' }]);
  });

  it('a POST to anything but a slug is a 404', async () => {
    expect((await post({ text: 'x' }, IP, `/estado/${TOKEN}`)).status).toBe(404);
    expect(MAIN.intake).not.toHaveBeenCalled();
  });
});

describe('portal/wrangler.toml (AC-85 item 1)', () => {
  it('holds only static assets and the MAIN service binding to PortalApi: no vars, no secrets, no Supabase', () => {
    const code = toml.replace(/#.*$/gm, '');
    expect(code).toMatch(/^name = "facturas"$/m);
    expect(code).toMatch(/\[\[services\]\]\s+binding = "MAIN"\s+service = "30x-hackathon"\s+entrypoint = "PortalApi"/);
    expect(code).toMatch(/\[assets\]/);
    expect(code).not.toMatch(/\[vars\]|SUPABASE|KEY|SECRET|supabase\.co/i);
    expect([...code.matchAll(/^\[+([\w.]+)\]+$/gm)].map((m) => m[1])).toEqual(['assets', 'services']);
  });
});
