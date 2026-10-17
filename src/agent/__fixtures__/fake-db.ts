// In-memory stand-in for the supabase-js client: only the calls src/agent makes. Never the real Supabase in unit tests.
// `invoice_current`, `insert_decision` and `period_state` mirror migrations 000200/000250 (lock aside); the screen_* functions
// mirror migration 001000 (AC-98), run as the caller's auth.uid() (rpc's third argument).
import { bogotaDay } from '../../engine/checks';
import { round2 } from '../../lib/money';
import type { Budget } from '../../lib/supabase';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
export interface Query { table: string; op: 'select' | 'insert' | 'upsert'; eq: Row }

const month = (iso: unknown) => bogotaDay(String(iso)).slice(0, 7);

export function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    companies: [], invoices: [], beneficiaries: [], policies: [], decisions: [], approval_tokens: [], agent_runs: [], ...seed,
  };
  const queries: Query[] = [];
  const rpcs: Array<{ name: string; args: Row }> = [];
  // Per-call failure injection: return an error message to make that call fail.
  const fail: Partial<Record<'insert_decision' | 'period_state', (args: Row) => string | undefined>> & { query?: (q: Query) => string | undefined } = {};
  let ids = 0;
  // Every call that would be one HTTP request to Supabase: counted here, and on the invocation's Budget when a client was
  // built with one (the mocked userClient/adminClient set it), the way the real clients count through Budget.fetch.
  const meter = { calls: 0, budget: undefined as Budget | undefined, hit() { meter.calls++; meter.budget?.count(); } };

  const latest = (invoiceId: unknown) =>
    tables.decisions!.filter((d) => d.invoice_id === invoiceId).sort((a, b) => Number(b.seq) - Number(a.seq))[0];
  const current = (): Row[] => tables.invoices!.filter((i) => !i.archived).map((i) => {
    const d = latest(i.id);
    return { ...i, decision_id: d?.id ?? null, seq: d?.seq ?? null, outcome: d?.outcome ?? null, amount_usd: d?.amount_usd ?? null, payment: d?.payment ?? null,
      // the view's remaining columns (migration 000200)
      actor: d?.actor ?? null, headline_es: d?.headline_es ?? null, headline_en: d?.headline_en ?? null,
      question_es: d?.question_es ?? null, question_en: d?.question_en ?? null, policy_version: d?.policy_version ?? null };
  });
  const sums = (companyId: unknown, m: string, exclude: unknown) => {
    const rows = current().filter((c) => c.company_id === companyId && c.id !== exclude && c.outcome && month(c.received_at) === m);
    const sum = (o: string[]) => round2(rows.filter((c) => o.includes(String(c.outcome))).reduce((s, c) => s + Number(c.amount_usd ?? 0), 0));
    return { committed_usd: sum(['PAGAR', 'ESCALAR']), paid_usd: sum(['PAGAR']) };
  };

  // Migration 001000's screen functions: null when auth.uid() is in no company (its first membership by company id).
  const sorted = (rows: Row[], ...keys: string[]) => [...rows].sort((a, b) => {
    for (const k of keys) { const [c, desc] = k.startsWith('-') ? [k.slice(1), -1] : [k, 1]; if (a[c] !== b[c]) return (String(a[c]) < String(b[c]) ? -1 : 1) * desc; }
    return 0;
  });
  const directory = (c: unknown) => tables.beneficiaries!.filter((b) => b.company_id === c && !b.archived);
  const inbox = (a: Row, c: unknown) => ({
    invoices: sorted(current().filter((r) => r.company_id === c), '-received_at').map((r) => ({ ...r, headline: a.p_lang === 'en' ? r.headline_en : r.headline_es })),
    last_run: ((r) => (r ? { at: r.created_at, trigger: r.trigger, via: r.via ?? null } : null))(
      sorted(tables.agent_runs!.filter((r) => r.company_id === c || (r.company_id ?? null) === null), '-created_at')[0]),
    portal_slug: tables.companies!.find((x) => x.id === c)?.portal_slug ?? null,
    beneficiaries: sorted(directory(c), 'name').map((b) => ({ id: b.id, name: b.name })),
  });
  const period = (c: unknown) => ({
    current: sorted(current().filter((r) => r.company_id === c), 'received_at', 'id')
      .map((r) => ({ id: r.id, received_at: r.received_at, fields: r.fields ?? null, outcome: r.outcome, amount_usd: r.amount_usd })),
    directory: directory(c),
    policy: ((p) => (p ? { version: p.version, rules: p.rules } : null))(sorted(tables.policies!.filter((p) => p.company_id === c), '-version')[0]),
    seeded: tables.invoices!.filter((i) => i.company_id === c && !i.archived && i.expected_outcome != null).map((i) => ({ id: i.id, expected_outcome: i.expected_outcome })),
    decisions: sorted(tables.decisions!.filter((d) => d.company_id === c), 'seq')
      .map((d) => ({ invoice_id: d.invoice_id, seq: d.seq, outcome: d.outcome, actor: d.actor, checks: d.checks ?? null })),
  });
  const screens: Record<string, (a: Row, c: unknown) => unknown> = {
    screen_inbox: inbox,
    screen_period: (_a, c) => period(c),
    screen_beneficiaries: (_a, c) => ({ beneficiaries: sorted(directory(c), 'name') }),
    screen_policy: (_a, c) => ({
      versions: sorted(tables.policies!.filter((p) => p.company_id === c), '-version'),
      company: ((co) => co && Object.fromEntries(['id', 'name', 'approver_email', 'lang', 'is_demo', 'is_trial'].filter((k) => k in co).map((k) => [k, co[k]])))(
        tables.companies!.find((x) => x.id === c)),
      fx: (tables.fx_latest ?? []).map((f) => ({ currency: f.currency, usd_per_unit: f.usd_per_unit, source: f.source, fetched_at: f.fetched_at })),
    }),
    screen_detail(a, c) {
      const v = current().find((r) => r.company_id === c && r.id === a.p_id);
      const co = tables.companies!.find((x) => x.id === c);
      const token = sorted(tables.approval_tokens!.filter((t) => t.company_id === c && t.invoice_id === a.p_id), '-created_at')[0];
      const policy = tables.policies!.find((p) => p.company_id === c && v && p.version === v.policy_version);
      return v ? {
        company_id: c, invoice: v, decisions: sorted(tables.decisions!.filter((d) => d.company_id === c && d.invoice_id === v.id), 'seq'), directory: directory(c),
        company: { is_demo: co?.is_demo ?? false, is_trial: co?.is_trial ?? false },
        notification: token ? { email_sent: token.email_sent, sent_to: token.sent_to } : null,
        policy: policy ? { name: policy.name, version: policy.version, created_at: policy.created_at } : null,
      } : null;
    },
    screen_demo_overview: (a, c) => (tables.companies!.find((x) => x.id === c)?.is_demo ? { invoices: inbox(a, c).invoices, period: period(c) } : null),
  };
  const companyOf = (uid: unknown) => (tables.company_members ?? []).filter((m) => m.user_id === uid).map((m) => String(m.company_id)).sort()[0];

  const procs: Record<string, (a: Row) => Result> = {
    insert_decision(a) {
      const inv = tables.invoices!.find((i) => i.id === a.p_invoice_id);
      if (!inv) return { data: null, error: { message: 'INVOICE_NOT_FOUND' } };
      const last = latest(inv.id);
      if (Number(last?.seq ?? 0) !== a.p_expected_seq) return { data: null, error: { message: 'ALREADY_DECIDED' } };
      if (Math.abs(sums(inv.company_id, month(inv.received_at), inv.id).committed_usd - Number(a.p_expected_committed_usd)) > 0.005) {
        return { data: null, error: { message: 'STALE_PERIOD' } };
      }
      if (last && ['PAGAR', 'FRENAR'].includes(String(last.outcome))) return { data: null, error: { message: 'FINAL_DECISION' } };
      const row = { ...(a.p_decision as Row), id: `dec-${++ids}`, invoice_id: inv.id, company_id: inv.company_id, seq: Number(last?.seq ?? 0) + 1 };
      tables.decisions!.push(row);
      return { data: row, error: null };
    },
    period_state: (a) => ({ data: sums(a.p_company_id, String(a.p_month).slice(0, 7), a.p_exclude_invoice), error: null }),
  };

  class Builder implements PromiseLike<Result> {
    private preds: Array<(r: Row) => boolean> = [];
    private sorts: Array<[string, boolean]> = [];
    private max = Infinity;
    private mode: 'many' | 'single' | 'maybe' = 'many';
    private payload: Row | Row[] | null = null;
    private conflict: string[] | null = null; // upsert: the key columns
    private eqs: Row = {};
    private embed = false;
    constructor(private table: string) {}
    // Column lists are ignored (rows come back whole), except the embedded latest decision `decisions(...)` that PostgREST
    // resolves through invoice_current.id -> decisions.invoice_id (checked live, 17 Oct): [latest] or [].
    select(columns?: string) { this.embed = /\bdecisions\(/.test(columns ?? ''); return this; }
    eq(c: string, v: unknown) { this.eqs[c] = v; this.preds.push((r) => (r[c] ?? (c === 'archived' ? false : undefined)) === v); return this; } // archived defaults to false like the column
    is(c: string, v: null) { this.preds.push((r) => (r[c] ?? null) === v); return this; }
    not(c: string, _op: 'is', v: null) { this.preds.push((r) => (r[c] ?? null) !== v); return this; }
    in(c: string, vs: unknown[]) { this.preds.push((r) => vs.includes(r[c])); return this; }
    gte(c: string, v: string) { this.preds.push((r) => Date.parse(String(r[c])) >= Date.parse(v)); return this; }
    order(c: string, o?: { ascending?: boolean; referencedTable?: string }) { if (!o?.referencedTable) this.sorts.push([c, o?.ascending !== false]); return this; }
    limit(n: number, o?: { referencedTable?: string }) { if (!o?.referencedTable) this.max = n; return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    insert(p: Row | Row[]) { this.payload = p; return this; }
    upsert(p: Row | Row[], o: { onConflict: string }) { this.payload = p; this.conflict = o.onConflict.split(','); return this; }
    private run(): Result {
      meter.hit();
      const q: Query = { table: this.table, op: this.conflict ? 'upsert' : this.payload ? 'insert' : 'select', eq: this.eqs };
      queries.push(q);
      const injected = fail.query?.(q);
      if (injected) return { data: null, error: { message: injected } };
      if (this.payload) {
        const rows = (tables[this.table] ??= []);
        for (const p of [this.payload].flat()) {
          const at = this.conflict ? rows.findIndex((r) => this.conflict!.every((k) => r[k] === p[k])) : -1;
          if (at >= 0) rows[at] = p; else rows.push(p);
        }
        return { data: null, error: null };
      }
      let rows = (this.table === 'invoice_current' ? current() : tables[this.table] ?? []).filter((r) => this.preds.every((p) => p(r)));
      if (this.embed) rows = rows.map((r) => ({ ...r, decisions: latest(r.id) ? [latest(r.id)] : [] }));
      for (const [c, asc] of [...this.sorts].reverse()) {
        rows = [...rows].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (asc ? 1 : -1));
      }
      rows = rows.slice(0, this.max);
      if (this.mode === 'many') return { data: rows, error: null };
      if (this.mode === 'single' && rows.length !== 1) return { data: null, error: { message: 'not exactly one row' } };
      return { data: rows[0] ?? null, error: null };
    }
    then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
      return Promise.resolve().then(() => this.run()).then(ok, ko);
    }
  }

  return {
    tables, queries, rpcs, fail, meter,
    from: (table: string) => new Builder(table),
    rpc: async (name: string, args: Row = {}, uid?: string): Promise<Result> => {
      meter.hit();
      rpcs.push({ name, args });
      const injected = fail[name as 'insert_decision' | 'period_state']?.(args);
      if (injected) return { data: null, error: { message: injected } };
      if (screens[name]) { const c = companyOf(uid); return { data: c === undefined ? null : screens[name](args, c), error: null }; }
      return procs[name]!(args);
    },
  };
}
export type FakeDb = ReturnType<typeof fakeDb>;
