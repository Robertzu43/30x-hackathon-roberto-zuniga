// The `facturas` Worker (D34, AC-83..AC-85, R-90.1): the vendor portal's pages and static files. It holds no secret and
// no Supabase access; it forwards only the slug, the text, the file and the connecting IP to the main Worker's PortalApi
// over the service binding MAIN. Every page is one HTML shell plus boot data, rendered by app.js as text, never as HTML.
import { en, es } from '../../src/i18n/features/portal';
import type { PortalApi } from '../../src/portal-api';

interface Env { ASSETS: Fetcher; MAIN: Service<PortalApi> }
type View = 'chat' | 'status' | 'not_found' | 'invalid' | 'rate_status' | 'unavailable';

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const MAX_BYTES = 10 * 1024 * 1024; // checked again by PortalApi; here it keeps big bodies off the binding
const SLUG = /^\/([a-z0-9][a-z0-9-]{2,39})\/?$/;
const STATUS = /^\/estado\/([^/]+)$/;
const ASSET = /^\/(app\.js|styles\.css|favicon\.svg|brand\/[a-z0-9-]+\.svg)$/;
const SEND_STATUS: Record<string, number> = { not_found: 404, file: 400, text: 400, rate_ip: 429, rate_company: 429 };

function secure(res: Response): Response {
  const r = new Response(res.body, res);
  r.headers.set('Content-Security-Policy', CSP);
  r.headers.set('X-Content-Type-Options', 'nosniff');
  r.headers.set('Referrer-Policy', 'no-referrer');
  return r;
}

const json = (body: object, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// The shell with its boot data as JSON in a non-executable script element; '<' is escaped so no value can close it.
async function page(env: Env, req: Request, status: number, view: View, data: object = {}): Promise<Response> {
  const shell = await (await env.ASSETS.fetch(new URL('/index.html', req.url))).text();
  const boot = JSON.stringify({ view, ...data, t: { es, en } }).replace(/</g, '\\u003c');
  return new Response(shell.replace('<!--boot-->', () => `<script type="application/json" id="boot">${boot}</script>`), // a function: '$' in the data is not a pattern
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function send(req: Request, env: Env, slug: string, ip: string): Promise<Response> {
  const form = await req.formData().catch(() => null);
  if (!form) return json({ ok: false, error: 'text' }, 400);
  const text = form.get('text');
  const file = form.get('file');
  if (file instanceof File && file.size > MAX_BYTES) return json({ ok: false, error: 'file' }, 400);
  const r = await env.MAIN.intake({ slug, ip, text: typeof text === 'string' ? text : undefined,
    file: file instanceof File ? { bytes: await file.arrayBuffer() } : undefined });
  return json(r, r.ok ? 200 : SEND_STATUS[r.error] ?? 503);
}

async function route(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);
  // The client IP as Cloudflare saw it; a client-sent X-Forwarded-For is never read (AC-85 item 3).
  const ip = req.headers.get('CF-Connecting-IP') ?? '';
  const slug = SLUG.exec(pathname)?.[1];
  if (req.method === 'POST') return slug ? send(req, env, slug, ip) : json({ ok: false, error: 'not_found' }, 404);
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD, POST' } });
  if (ASSET.test(pathname)) return env.ASSETS.fetch(req);
  const token = STATUS.exec(pathname)?.[1];
  if (token) {
    const s = await env.MAIN.status(token, ip);
    return s.ok ? page(env, req, 200, 'status', { status: s }) : page(env, req, s.error === 'rate_status' ? 429 : 404, s.error);
  }
  const company = slug ? await env.MAIN.company(slug) : null;
  return company ? page(env, req, 200, 'chat', { company: company.name }) : page(env, req, 404, 'not_found');
}

export default {
  async fetch(req, env): Promise<Response> {
    try {
      return secure(await route(req, env));
    } catch (e) {
      console.error('portal: request failed', e instanceof Error ? e.message : e); // never shown to the vendor
      return secure(req.method === 'POST' ? json({ ok: false, error: 'failed' }, 503) : await page(env, req, 503, 'unavailable'));
    }
  },
} satisfies ExportedHandler<Env>;
