// In-memory stand-in for the supabase-js client: only the calls src/agent makes. Never the real Supabase in unit tests.
// `invoice_current`, `insert_decision` and `period_state` mirror migrations 000200/000250 (lock aside).
import { bogotaDay } from '../../engine/checks';
import { round2 } from '../../lib/money';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
export interface Query { table: string; op: 'select' | 'insert'; eq: Row }

const month = (iso: unknown) => bogotaDay(String(iso)).slice(0, 7);

export function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    companies: [], invoices: [], beneficiaries: [], policies: [], decisions: [], approval_tokens: [], agent_runs: [], ...seed,
  };
  const queries: Query[] = [];
  const rpcs: Array<{ name: string; args: Row }> = [];
  // Per-call failure injection: return an error message to make that call fail.
  const fail: Partial<Record<'insert_decision' | 'period_state', (args: Row) => string | undefined>> = {};
  let ids = 0;

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
    private eqs: Row = {};
    constructor(private table: string) {}
    select(columns?: string) { void columns; return this; } // column lists are ignored: rows come back whole
    eq(c: string, v: unknown) { this.eqs[c] = v; this.preds.push((r) => (r[c] ?? (c === 'archived' ? false : undefined)) === v); return this; } // archived defaults to false like the column
    is(c: string, v: null) { this.preds.push((r) => (r[c] ?? null) === v); return this; }
    not(c: string, _op: 'is', v: null) { this.preds.push((r) => (r[c] ?? null) !== v); return this; }
    in(c: string, vs: unknown[]) { this.preds.push((r) => vs.includes(r[c])); return this; }
    gte(c: string, v: string) { this.preds.push((r) => Date.parse(String(r[c])) >= Date.parse(v)); return this; }
    order(c: string, o?: { ascending?: boolean }) { this.sorts.push([c, o?.ascending !== false]); return this; }
    limit(n: number) { this.max = n; return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    insert(p: Row | Row[]) { this.payload = p; return this; }
    private run(): Result {
      queries.push({ table: this.table, op: this.payload ? 'insert' : 'select', eq: this.eqs });
      if (this.payload) {
        tables[this.table] ??= [];
        tables[this.table]!.push(...[this.payload].flat());
        return { data: null, error: null };
      }
      let rows = (this.table === 'invoice_current' ? current() : tables[this.table] ?? []).filter((r) => this.preds.every((p) => p(r)));
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
    tables, queries, rpcs, fail,
    from: (table: string) => new Builder(table),
    rpc: async (name: string, args: Row): Promise<Result> => {
      rpcs.push({ name, args });
      const injected = fail[name as keyof typeof fail]?.(args);
      if (injected) return { data: null, error: { message: injected } };
      return procs[name]!(args);
    },
  };
}
export type FakeDb = ReturnType<typeof fakeDb>;
