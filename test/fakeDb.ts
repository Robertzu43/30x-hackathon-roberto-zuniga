// In-memory stand-in for the few supabase-js chains the routes use.
// Tokens are user ids: getUser(token) succeeds when a profile with that id exists.
type Row = Record<string, unknown>

export const tables: Record<string, Row[]> = { profiles: [], deliveries: [] }

export const reset = (profiles: Row[], deliveries: Row[]) => {
  tables.profiles = profiles.map((r) => ({ ...r }))
  tables.deliveries = deliveries.map((r) => ({
    status: 'pendiente', courier_id: null, failure_reason: null, updated_at: '2026-01-01T00:00:00Z', barrio: '', ...r,
  }))
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: ((r: Row) => boolean)[] = []
  private embed = false
  private cols?: string[]
  private orderBy?: string
  private mode: 'many' | 'maybe' | 'single' = 'many'
  private patch?: Row
  private rows?: Row[]
  constructor(private table: string) {}

  select(cols = '*') {
    this.embed = cols.includes('courier:profiles')
    if (!cols.includes('*')) this.cols = cols.split(',').map((s) => s.trim())
    return this
  }
  eq(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this }
  order(k: string) { this.orderBy = k; return this }
  maybeSingle() { this.mode = 'maybe'; return this }
  single() { this.mode = 'single'; return this }
  insert(rows: Row[]) { this.rows = rows; return this }
  update(patch: Row) { this.patch = patch; return this }

  private run() {
    const t = tables[this.table]
    if (this.rows) {
      for (const r of this.rows) {
        if (t.some((x) => x.delivery_date === r.delivery_date && x.pedido === r.pedido))
          return { data: null, error: { code: '23505', message: 'duplicate key' } }
        t.push({ id: crypto.randomUUID(), status: 'pendiente', courier_id: null, failure_reason: null, updated_at: 'now', ...r })
      }
      return { data: null, error: null }
    }
    let rows = t.filter((r) => this.filters.every((f) => f(r)))
    if (this.patch) rows.forEach((r) => Object.assign(r, this.patch))
    rows = rows.map((r) => (this.cols ? Object.fromEntries(this.cols.map((k) => [k, r[k]])) : { ...r }))
    if (this.embed)
      rows = rows.map((r) => {
        const p = tables.profiles.find((x) => x.id === r.courier_id)
        return { ...r, courier: p ? { full_name: p.full_name } : null }
      })
    if (this.orderBy) {
      const k = this.orderBy
      rows.sort((a, b) => String(a[k]).localeCompare(String(b[k])))
    }
    if (this.mode === 'many') return { data: rows, error: null }
    if (rows.length > 1 || (this.mode === 'single' && !rows.length)) return { data: null, error: { message: 'not single' } }
    return { data: rows[0] ?? null, error: null }
  }

  then<A, B>(ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, ko)
  }
}

export const fakeClient = () => ({
  auth: {
    getUser: async (token: string) =>
      tables.profiles.some((p) => p.id === token)
        ? { data: { user: { id: token } }, error: null }
        : { data: { user: null }, error: { message: 'bad jwt' } },
  },
  from: (table: string) => new Query(table),
})
