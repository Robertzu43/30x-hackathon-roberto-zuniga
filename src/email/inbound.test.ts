/// <reference types="vite/client" />
// Email intake (AC-87, R-91) on the 10 .eml fixtures, with a fake db, a fake provider and a fake sendEmail: never the real
// Supabase, a real model or SES (R-94).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FULL_CONFIDENCE } from '../engine/__fixtures__/seed';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import type { InvoiceFields } from '../engine/types';
import type { Env } from '../env';
import { sendEmail } from '../lib/email';
import { extractFields } from '../lib/llm';
import type { Budget } from '../lib/supabase';
import { fakeDb } from '../agent/__fixtures__/fake-db';

type Row = Record<string, unknown>;
let db: ReturnType<typeof intakeDb>;
const budgets = new Set<Budget | undefined>();
vi.mock('../lib/admin', () => ({ adminClient: (_e: Env, b?: Budget) => { budgets.add(b); db.meter.budget = b; return db; } }));
vi.mock('../lib/email', async (orig) => ({ ...(await orig<typeof import('../lib/email')>()), sendEmail: vi.fn(async () => ({ sent: true })) }));
// The fake provider: a file reads as its own bytes' text; the number after «#» and a changed account come from that text.
vi.mock('../lib/llm', () => ({
  documentToText: vi.fn(async (_e: Env, i: { bytes: ArrayBuffer }) => new TextDecoder().decode(i.bytes)),
  extractFields: vi.fn(async (_e: Env, text: string | null) => ({ ...LAURA, invoice_number: /#(\d+)/.exec(text ?? '')?.[1] ?? null,
    bank_account: text?.includes('9999-0000-1111') ? 'Davivienda ahorros 9999-0000-1111' : LAURA.bank_account })),
}));
const { inbound } = await import('./inbound');

const SEED = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');
const DOMAIN = 'correo.thesaurus.example';
const env = { APP_URL: 'https://app.test', PORTAL_URL: 'https://facturas.test', INBOUND_EMAIL_DOMAIN: DOMAIN, APPROVAL_HMAC_SECRET: 's' } as unknown as Env;
const LAURA: InvoiceFields = { payee_name: 'Laura Méndez', amount: 2500, currency: 'USD', invoice_number: '1050', issue_date: '2026-10-17',
  due_date: '2026-12-01', concept: 'Retainer mensual', bank_account: 'Bancolombia ahorros 0012-3456-4821', confidence: FULL_CONFIDENCE };

// fake-db plus Storage and intake_hit as migration 000800 counts it: 10 an hour per key when p_ip is given, 100 a day per company.
function intakeDb() {
  const base = fakeDb({
    companies: [{ id: 'A', portal_slug: 'andina-labs', name: 'Andina Labs Inc.', is_demo: true, approver_email: 'aprobador@A.example' },
      { id: 'B', portal_slug: 'p-0123456789ab', name: 'Bogotá Diseño SAS', is_demo: false, approver_email: 'aprobador@B.example' }],
    policies: ['A', 'B'].map((c) => ({ company_id: c, version: 1, name: 'Política general', rules: SEED.rules })),
    beneficiaries: ['A', 'B'].flatMap((c) => SEED.beneficiaries.map((b: Row, n: number) => ({ ...b, id: `${c}b${n}`, company_id: c }))),
  });
  const rpc = base.rpc;
  const hits = new Map<string, number>();
  const hit = (key: string, cap: number) => { hits.set(key, (hits.get(key) ?? 0) + 1); return hits.get(key)! > cap; };
  const uploads: string[] = [];
  const from = base.from;
  return Object.assign(base, {
    hits, uploads,
    from: (table: string) => {
      const b = from(table);
      const insert = b.insert.bind(b);
      return Object.assign(b, { insert: (p: Row) => insert(table === 'invoices' ? { received_at: new Date().toISOString(), archived: false, ...p } : p) });
    },
    rpc: async (name: string, a: Row) => {
      if (name !== 'intake_hit') return rpc(name, a);
      base.rpcs.push({ name, args: a });
      if (a.p_ip !== null && hit(`ip:${a.p_ip}`, 10)) return { data: 'ip', error: null };
      return { data: hit(`company:${a.p_company}`, 100) ? 'company' : null, error: null };
    },
    storage: { from: () => ({ upload: async (path: string) => { base.meter.hit(); uploads.push(path); return { data: { path }, error: null }; } }) },
  });
}

const EML = import.meta.glob<string>('./__fixtures__/*.eml', { query: '?raw', import: 'default', eager: true });
const fixture = (name: string) => EML[`./__fixtures__/${name}.eml`]!;
// Cloudflare hands the handler the envelope recipient; the fixtures carry it in their To header.
async function deliver(raw: string, rcpt?: string) {
  const bytes = new TextEncoder().encode(raw);
  const to = rcpt ?? /^To: (.+)$/m.exec(new TextDecoder().decode(bytes.subarray(0, 4000)))![1]!.trim();
  const setReject = vi.fn();
  const message = { from: 'bounce@mendez.example', to, raw: new Response(bytes).body!, rawSize: bytes.byteLength, headers: new Headers(), setReject };
  await inbound(message as unknown as ForwardableEmailMessage, env);
  return setReject;
}
const invoices = () => db.tables.invoices!;
const replies = () => vi.mocked(sendEmail).mock.calls.map((c) => c[1]);
const LINK = /https:\/\/facturas\.test\/estado\/[A-Za-z0-9_-]{43}/g;
// A multipart email built in the test, for the cases no fixture covers.
const mime = (parts: Array<[name: string, type: string, body: string]>, head = '') =>
  `From: Laura Méndez <laura@mendez.example>\r\nTo: facturas+andina-labs@${DOMAIN}\r\nSubject: Facturas\r\n${head}MIME-Version: 1.0\r\n`
  + 'Content-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nAdjuntos\r\n'
  + parts.map(([n, t, body]) => `--b\r\nContent-Type: ${t}\r\nContent-Disposition: attachment; filename="${n}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${btoa(body)}\r\n`).join('')
  + '--b--\r\n';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-10-17T15:00:00Z');
  db = intakeDb();
  budgets.clear();
  vi.mocked(sendEmail).mockClear();
  vi.mocked(extractFields).mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('email intake: each fixture (AC-87)', () => {
  it('text only: one invoice with origin email, source email and the From as sender, decided by runAgent, one reply', async () => {
    const reject = await deliver(fixture('text-only'));
    expect(reject).not.toHaveBeenCalled();
    expect(invoices()).toEqual([expect.objectContaining({ company_id: 'A', origin: 'email', source: 'email', sender: 'laura@mendez.example',
      sender_note: null, file_path: null, raw_text: expect.stringContaining('Cuenta de cobro #1050') })]);
    expect(db.tables.decisions).toEqual([expect.objectContaining({ invoice_id: invoices()[0]!.id, outcome: 'PAGAR', actor: 'agent' })]);
    expect(db.tables.agent_runs).toEqual([expect.objectContaining({ company_id: 'A', trigger: 'ingest', via: 'email' })]);
    expect(replies()).toHaveLength(1);
    const [r] = replies();
    expect(r!.to).toBe('laura@mendez.example');
    expect(r!.text).toContain('Estado: aprobada para pago');
    expect(r!.text).toContain('Status: approved for payment');
    expect(new Set(r!.text.match(LINK))).toHaveProperty('size', 1); // the same link in the Spanish and the English part
    expect(r!.text.match(LINK)).toHaveLength(2);
    expect(r!.html.match(LINK)).toHaveLength(4); // per language, the link's href and its text
    expect(r!.html).toContain('<img src="https://app.test/brand/thesaurus-logo.png"'); // AC-80
  });

  it('the address form <slug>@domain resolves the same company', async () => {
    await deliver(fixture('text-only'), `andina-labs@${DOMAIN}`);
    expect(invoices()).toHaveLength(1);
  });

  it('one PDF: the file is the invoice (source pdf) and the body is not read', async () => {
    await deliver(fixture('one-pdf'));
    const [inv] = invoices();
    expect(inv).toMatchObject({ origin: 'email', source: 'pdf', sender: 'laura@mendez.example', file_path: `A/${inv!.id}.pdf`, sender_note: null });
    expect(db.uploads).toEqual([`A/${inv!.id}.pdf`]);
    expect(vi.mocked(extractFields).mock.calls.map((c) => c[1])).toEqual([expect.stringMatching(/^%PDF-1\.7 Cuenta de cobro #1051/)]);
    expect(replies()).toHaveLength(1);
  });

  it('one PNG: source image', async () => {
    await deliver(fixture('one-png'));
    expect(invoices().map((i) => [i.source, String(i.file_path).split('.')[1]])).toEqual([['image', 'png']]);
  });

  it('two PDFs: two invoices, one reply holding both statuses and both links; the sender is counted once', async () => {
    await deliver(fixture('two-pdfs'));
    expect(invoices().map((i) => i.source)).toEqual(['pdf', 'pdf']);
    expect(replies()).toHaveLength(1);
    expect(new Set(replies()[0]!.text.match(LINK))).toHaveProperty('size', 2);
    expect(replies()[0]!.text.match(/^Estado: /gm)).toHaveLength(2);
    expect(db.rpcs.filter((r) => r.name === 'intake_hit').map((r) => r.args)).toEqual([
      { p_kind: 'invoice', p_ip: 'email:laura@mendez.example', p_company: 'A' }, { p_kind: 'invoice', p_ip: null, p_company: 'A' }]);
  });

  it('only a .docx: the body becomes the invoice and the .docx is listed as ignored', async () => {
    await deliver(fixture('docx-only'));
    expect(invoices()).toEqual([expect.objectContaining({ source: 'email', file_path: null, raw_text: expect.stringContaining('#1055') })]);
    expect(db.uploads).toEqual([]);
    expect(replies()[0]!.text).toContain('cuenta-1055.docx');
  });

  it('an 11 MB PDF is ignored and listed; the body becomes the invoice', async () => {
    await deliver(fixture('big-pdf'));
    expect(db.uploads).toEqual([]);
    expect(invoices()).toEqual([expect.objectContaining({ source: 'email', raw_text: expect.stringContaining('#1056') })]);
    expect(replies()[0]!.text).toContain('cuenta-1056.pdf');
  });

  it('an unknown recipient is rejected with «Dirección desconocida» and nothing is stored or sent', async () => {
    const reject = await deliver(fixture('unknown-recipient'));
    expect(reject).toHaveBeenCalledWith('Dirección desconocida');
    expect(invoices()).toEqual([]);
    expect(db.rpcs).toEqual([]);
    expect(replies()).toEqual([]);
  });

  it('another domain, another local part or no INBOUND_EMAIL_DOMAIN is an unknown recipient', async () => {
    expect(await deliver(fixture('text-only'), 'facturas+andina-labs@otro.example')).toHaveBeenCalledWith('Dirección desconocida');
    expect(await deliver(fixture('text-only'), `pagos+andina-labs@${DOMAIN}`)).toHaveBeenCalledWith('Dirección desconocida');
    env.INBOUND_EMAIL_DOMAIN = '';
    try {
      expect(await deliver(fixture('text-only'), 'facturas+andina-labs@')).toHaveBeenCalledWith('Dirección desconocida');
    } finally { env.INBOUND_EMAIL_DOMAIN = DOMAIN; }
    expect(invoices()).toEqual([]);
  });

  it('an auto-reply is stored but never answered (loop guard)', async () => {
    await deliver(fixture('auto-reply'));
    expect(invoices()).toHaveLength(1);
    expect(replies()).toEqual([]);
  });

  it('an HTML-only body is read with its tags stripped', async () => {
    await deliver(fixture('html-only'));
    const raw = String(invoices()[0]!.raw_text);
    expect(raw).toContain('Cuenta de cobro');
    expect(raw).toContain('#1059');
    expect(raw).not.toMatch(/<|color:red/);
  });

  it('a spoofed sender with a changed account: ESCALAR «cuenta cambiada», no payment to the new account, the reply names no reason', async () => {
    await deliver(fixture('spoofed-account'));
    const [d] = db.tables.decisions!;
    expect(d).toMatchObject({ outcome: 'ESCALAR' });
    expect(d!.checks).toContainEqual(expect.objectContaining({ id: 'beneficiario_cuenta', verdict: 'no_cumple',
      values: expect.objectContaining({ reason: 'cuenta cambiada' }) }));
    expect(JSON.stringify(d!.payment ?? null)).not.toContain('9999');
    const r = replies()[0]!;
    expect(r.text).toContain('Estado: requiere aprobación de Andina Labs Inc.');
    expect(`${r.text}${r.html}`).not.toMatch(/cuenta cambiada|9999|4821|beneficiario_cuenta/);
  });
});

describe('email intake: rules (AC-87)', () => {
  it.each([
    ['Auto-Submitted: auto-generated\r\n'],
    ['Precedence: bulk\r\n'],
    ['Precedence: list\r\n'],
    ['Precedence: junk\r\n'],
  ])('no reply with %s', async (head) => {
    await deliver(fixture('text-only').replace('MIME-Version', `${head}MIME-Version`));
    expect(invoices()).toHaveLength(1);
    expect(replies()).toEqual([]);
  });

  it('Auto-Submitted: no is answered', async () => {
    await deliver(fixture('text-only').replace('MIME-Version', 'Auto-Submitted: no\r\nMIME-Version'));
    expect(replies()).toHaveLength(1);
  });

  it('no reply when the From is missing, invalid or on INBOUND_EMAIL_DOMAIN (loop guard)', async () => {
    await deliver(fixture('text-only').replace(/^From: .*\r\n/m, ''));
    await deliver(fixture('text-only').replace(/^From: .*$/m, 'From: Laura <laura-sin-arroba>'));
    await deliver(fixture('text-only').replace(/^From: .*$/m, `From: Thesaurus <facturas+andina-labs@${DOMAIN.toUpperCase()}>`));
    expect(invoices().map((i) => i.sender)).toEqual([null, null, `facturas+andina-labs@${DOMAIN}`]);
    expect(replies()).toEqual([]);
  });

  it('at most 3 invoices per email; the rest and any other type are listed (escaped) in the reply; embedded images are not invoices', async () => {
    const pdf = (n: number) => [`f${n}.pdf`, 'application/pdf', `%PDF-1.7 #${2000 + n} 2.500 USD`] as [string, string, string];
    await deliver(mime([['<b>x</b>.docx', 'application/octet-stream', 'PK'], pdf(1), pdf(2), pdf(3), pdf(4)]));
    expect(invoices()).toHaveLength(3);
    const r = replies()[0]!;
    expect(r.text).toContain('f4.pdf');
    expect(r.html).toContain('&lt;b&gt;x&lt;/b&gt;.docx');
    expect(r.html).not.toContain('<b>x</b>');
    const related = mime([]).replace('multipart/mixed', 'multipart/related').replace('--b--', '--b\r\nContent-Type: image/png\r\nContent-ID: <logo>\r\n'
      + `Content-Disposition: inline; filename="logo.png"\r\nContent-Transfer-Encoding: base64\r\n\r\n${btoa('\x89PNG firma')}\r\n--b--`);
    await deliver(related);
    expect(invoices().slice(3).map((i) => i.source)).toEqual(['email']);
  });

  it('nothing to read (no invoice attachment and an empty body): nothing stored, nothing sent', async () => {
    await deliver(mime([['a.docx', 'application/octet-stream', 'PK']]).replace('\r\n\r\nAdjuntos\r\n', '\r\n\r\n \r\n'));
    expect(invoices()).toEqual([]);
    expect(replies()).toEqual([]);
  });

  it('over 10 emails per sender per hour: nothing stored, nothing sent (no backscatter)', async () => {
    for (let n = 0; n < 10; n++) await deliver(fixture('text-only'));
    expect(replies()).toHaveLength(10);
    await deliver(fixture('two-pdfs'));
    expect(invoices()).toHaveLength(10);
    expect(replies()).toHaveLength(10);
  });

  it('over the shared company limit: nothing stored, nothing sent', async () => {
    db.hits.set('company:A', 100);
    await deliver(fixture('text-only'));
    expect(invoices()).toEqual([]);
    expect(replies()).toEqual([]);
  });

  it('one Budget per message for every read and the agent run', async () => {
    await deliver(fixture('two-pdfs'));
    expect(budgets.size).toBe(1);
    expect([...budgets][0]!.used).toBeGreaterThan(0);
  });
});

// R-56(b): one email's subrequests, the reply included, never pass the 40 of one invocation; a read counts its worst case.
describe('email intake: the subrequest budget (R-56, AC-70)', () => {
  const pdf = (n: number, extra = '') => [`f${n}.pdf`, 'application/pdf', `%PDF-1.7 #${3000 + n} 2.500 USD${extra}`] as [string, string, string];
  // Budget.used after the email, and after the last database call (the reply is the only subrequest after it).
  async function metered(raw: string) {
    let lastHit = 0;
    const hit = db.meter.hit;
    db.meter.hit = () => { hit(); lastHit = db.meter.budget!.used; };
    await deliver(raw);
    return { used: [...budgets][0]!.used, lastHit };
  }

  it('3 PDFs, non-demo company, changed accounts: every call and the reply fit in 40, the reply is counted', async () => {
    const m = await metered(mime([pdf(1, ' 9999-0000-1111'), pdf(2, ' 9999-0000-1111'), pdf(3, ' 9999-0000-1111')])
      .replace('facturas+andina-labs', 'facturas+p-0123456789ab'));
    expect(invoices().map((i) => i.company_id)).toEqual(['B', 'B', 'B']);
    expect(replies().filter((r) => r.to === 'laura@mendez.example')).toHaveLength(1); // the others: escalation mails to the approver
    expect(m.used).toBe(m.lastHit + 1);
    expect(m.used).toBeLessThanOrEqual(40);
  });

  it('3 PDFs on the demo company leave margin', async () => {
    const m = await metered(mime([pdf(1), pdf(2), pdf(3)]));
    expect(invoices()).toHaveLength(3);
    expect(m.used).toBeLessThan(40);
  });

  it('an invoice the agent does not fit stays pending and its reply says «en revisión»', async () => {
    await deliver(mime([pdf(1), pdf(2), pdf(3)]));
    const decided = new Set(db.tables.decisions?.map((d) => d.invoice_id));
    const pending = invoices().filter((i) => !decided.has(i.id));
    expect(pending.map((i) => i.raw_text)).toContainEqual(expect.stringContaining('#3003'));
    expect(replies()[0]!.text.match(/^Estado: en revisión$/gm)).toHaveLength(pending.length);
  });

  it.each([['one-pdf', 3], ['one-png', 4], ['text-only', 2]])('%s: the reader counts its worst case, %i calls (Bedrock, then Workers AI)', async (name, reads) => {
    const m = await metered(fixture(name));
    expect(m.used - db.meter.calls - 1).toBe(reads); // all but the database calls and the reply
  });
});
