# Rutas del Norte — Delivery Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Carolina's WhatsApp + spreadsheet dispatching with one web app: she imports the day's CSV, assigns couriers, and at 6pm sees on one screen what was delivered, what failed and why; couriers mark deliveries from their phones.

**Architecture:** One Cloudflare Worker (Hono) serves the Vite + React SPA from `dist/` (Static Assets) and the JSON API under `/api/*`. Supabase Postgres holds `profiles` and `deliveries` (RLS on); Supabase Auth email+password issues JWTs. The Worker verifies the caller's JWT, loads their role from `profiles`, and then talks to Postgres with the service_role key, enforcing authorization itself (one rule, stated in `src/lib/auth.ts`). Pure domain logic (CSV parsing, phone/date/money formatting, status transitions) lives in small modules with unit tests.

**Tech Stack:** TypeScript, Hono, @supabase/supabase-js, Vite + React, Vitest, ESLint (flat config), Wrangler. No other runtime dependencies without a builder justification in the report.

**Spec:** `docs/SPEC.md` (written by `product` from `docs/PROBLEM.md` + `docs/DECISIONS.md`). Each task lists the AC ids it serves; the AC text and product rulings R-01..R-10 are the contract, this plan is the route. Where they differ, SPEC wins.

**Base branch for this run:** `dryrun/e2e` plays `main`. Task branches `task/<n>-<slug>` merge into `integration`; `integration` merges into `dryrun/e2e`. Never touch `main`.

## Global Constraints

- UI copy Spanish (es-CO). Code, comments, commit messages English.
- Routes (D6): dispatcher `/`, courier `/mensajero`, demo `/demo`, API `/api/*`. One Worker, one URL.
- Statuses (D3): `pendiente` → `asignado` → `entregado` | `fallido`. Dispatcher may (re)assign a `pendiente`, `asignado` or `fallido` delivery → `asignado`. `entregado` is final.
- Failure reasons (exact values stored): `no_estaba`, `direccion_errada`, `rechazado`, `otro`. Labels shown: "No estaba", "Dirección errada", "Rechazado", "Otro". No free-text note (R-09).
- Courier cannot change a delivery once `entregado`/`fallido` (R-04); only the dispatcher's reassign reopens it.
- "Today" = America/Bogota calendar date (UTC-5, no DST) (D4). Timestamps stored UTC.
- Phones stored E.164 `+57XXXXXXXXXX`: accept 10 digits starting `3` or `60`, optional `57`/`+57` prefix, ignoring spaces, dashes, dots, parentheses; else skip "Teléfono inválido" (D5, R-01). Valor: strip `$`, spaces, `.` thousands; `,00` decimals allowed, non-zero decimals or non-integer → skip "Valor inválido" (R-02). Money: integer COP, shown `$ 45.000` (es-CO, no decimals). Dates shown `dd/mm/yyyy`.
- CSV columns (header row, any order, case-insensitive): `pedido, cliente, telefono, direccion, barrio, valor`. Rows missing `telefono` or `direccion` are skipped and listed; duplicate `pedido` for the same date (in file or already in DB) is skipped and listed (first occurrence kept); valid rows are never blocked (D2). Skip labels shown: "Falta teléfono", "Falta dirección", "Pedido duplicado", "Teléfono inválido", "Valor inválido". Missing column or non-CSV → Spanish error, nothing imported (AC-11).
- Auth: Supabase email+password; no sign-up page; role in `profiles.role` ∈ {`dispatcher`,`courier`} (D1).
- Every table: RLS enabled in the migration that creates it. Migrations only in `supabase/migrations/`, applied with `bash scripts/db-push.sh`, each with a `-- down` block.
- API errors: JSON `{ "error": "<message>" }` with 400 (validation), 401 (no/invalid token), 403 (wrong role or not your delivery), 404, 409 (illegal status transition).
- No LLM feature, no email except the SHOULD task (Task 9). Email only via `src/lib/email.ts`.
- `package.json` scripts: `lint`, `typecheck`, `test` (vitest run), `build` (vite build), `deploy` (`npm run build && wrangler deploy`).

## Review Focus

1. CSV from a real store export: BOM at start, `;` separator (Excel es-CO default), quoted fields with commas, CRLF, phone written `300 123 4567` / `3001234567` / `+57 300...`, `valor` written `45.000` or `$45,000`. Expect: parsed correctly, phone normalized, valor integer. → tests in Task 2.
2. Courier marks a delivery that the dispatcher just reassigned to someone else → 403, not a silent overwrite. → test in Task 5.
3. Request near midnight Bogotá (e.g. 2026-10-16T04:30Z is still 15/10 in Bogotá) → "today" is 2026-10-15. → test in Task 2.
4. `fallido` without a reason, or reason not in the enum (e.g. `lluvia`) → 400. → test in Task 5.
5. Expired/garbage bearer token or a courier token on dispatcher endpoints → 401/403, never 500. → test in Task 4.

---

### Task 1: Scaffold Worker + SPA + toolchain

**Seat:** senior-builder. **ACs:** AC-22 (routes), AC-27 (lint/typecheck/test).

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/index.ts`, `src/app.ts`, `web/main.tsx`, `web/App.tsx`, `web/styles.css`, `test/health.test.ts`
- Modify: `.gitignore` (add `node_modules`, `dist`), `wrangler.toml` only if `main` path changes (keep `src/index.ts`).

**Interfaces:**
- Produces: `src/app.ts` exports `app: Hono<{ Bindings: Env }>` and `type Env = { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY: string; RESEND_API_KEY?: string; RESEND_FROM: string }`. `src/index.ts` does `export default app` (later Task 9 adds `scheduled`). Later tasks mount routes with `app.route('/api', ...)` or add handlers in their own files imported by `src/app.ts`.
- Produces: SPA with client routes `/` (dispatcher), `/mensajero` (courier), `/demo` (demo) rendering placeholder headings; `web/api.ts` exports `api<T>(path: string, init?: RequestInit): Promise<T>` that adds `Authorization: Bearer <token>` from the Supabase browser session and throws `Error(body.error)` on non-2xx.

- [ ] **Step 1:** Failing test `test/health.test.ts`: `await app.request('/api/health')` → status 200, body `{ ok: true }`; `await app.request('/api/nope')` → 404 with `{ error: 'not found' }`.
- [ ] **Step 2:** `npm test` → FAIL (module missing).
- [ ] **Step 3:** Install `hono @supabase/supabase-js react react-dom` and dev `typescript vitest vite @vitejs/plugin-react @types/react @types/react-dom eslint typescript-eslint @cloudflare/workers-types wrangler`. Implement `src/app.ts`, `src/index.ts`, SPA shell (no router lib: switch on `location.pathname`), `minimalist-ui` styling base in `web/styles.css`.
- [ ] **Step 4:** `npm run lint && npm run typecheck && npm test && npm run build` → all exit 0, `dist/index.html` exists.
- [ ] **Step 5:** Commit `feat: scaffold worker, spa and toolchain`.

### Task 2: Domain logic (CSV, phone, dates, money, transitions)

**Seat:** junior-builder. **ACs:** AC-07, AC-08, AC-09, AC-10, AC-11, AC-12 (formatting), AC-19 (transition rule).

**Files:**
- Create: `src/lib/csv.ts`, `src/lib/format.ts`, `src/lib/status.ts`, `test/csv.test.ts`, `test/format.test.ts`, `test/status.test.ts`, fixtures `docs/demo/pedidos-ejemplo.csv` (5 valid + 1 no telefono + 1 no direccion, Bogotá addresses) and `docs/demo/pedidos-formatos.csv` (the AC-10 phone and valor formats)

**Interfaces:**
- Produces (`src/lib/format.ts`): `toE164(raw: string): string | null` (per R-01; else null); `bogotaToday(now?: Date): string` (`YYYY-MM-DD`); `formatDate(iso: string): string` (`dd/mm/yyyy`); `formatCOP(n: number): string` (`$ 45.000`); `parseCOP(raw: string): number | null` (per R-02).
- Produces: `REASON_LABELS: Record<Reason, string>` in `src/lib/status.ts`.
- Produces (`src/lib/csv.ts`): `type ImportRow = { pedido: string; cliente: string; telefono: string; direccion: string; barrio: string; valor: number }`; `type Skipped = { line: number; pedido: string; reason: 'falta_telefono' | 'falta_direccion' | 'telefono_invalido' | 'valor_invalido' | 'duplicado' }`; `SKIP_LABELS: Record<Skipped['reason'], string>` (Spanish labels above); `parseDeliveriesCsv(text: string, existingPedidos?: Set<string>): { valid: ImportRow[]; skipped: Skipped[] } | { error: string }` (error = Spanish message naming missing columns).
- Produces (`src/lib/status.ts`): `type Status = 'pendiente'|'asignado'|'entregado'|'fallido'`; `type Reason = 'no_estaba'|'direccion_errada'|'rechazado'|'otro'`; `REASONS: readonly Reason[]`; `canAssign(s: Status): boolean` (true for pendiente/asignado/fallido); `canCourierMark(s: Status): boolean` (true only for asignado).

- [ ] **Step 1:** Failing tests with exact cases:
  - `toE164` of `'3001234567'`, `'573001234567'`, `'+57 300 123 4567'`, `'300-123-4567'` all `=== '+573001234567'`; `toE164('601 234 5678') === '+576012345678'`; `toE164('12345') === null`.
  - `bogotaToday(new Date('2026-10-16T04:30:00Z')) === '2026-10-15'`; `bogotaToday(new Date('2026-10-16T05:00:00Z')) === '2026-10-16'`.
  - `formatDate('2026-10-15') === '15/10/2026'`; `formatCOP(45000)` matches `/^\$\s?45\.000$/`; `parseCOP` of `'45000'`, `'45.000'`, `'$45.000'`, `'45.000,00'` all `=== 45000`; `parseCOP('45.000,50') === null`; `parseCOP('abc') === null`.
  - CSV: header `pedido,cliente,telefono,direccion,barrio,valor` + 4 rows (1 valid, 1 missing telefono, 1 missing direccion, 1 duplicate pedido of row 1) → `valid.length === 1`, skipped reasons `['falta_telefono','falta_direccion','duplicado']` with 1-based data line numbers.
  - CSV with BOM, `;` separator, CRLF, quoted `"Cra 7 # 45-10, apto 301"` → address preserved with comma.
  - `existingPedidos = new Set(['P-1'])` → row P-1 skipped as `duplicado`.
  - header missing `valor` → returns `{ error }` mentioning `valor`; binary/empty text → `{ error }`.
  - `canAssign('entregado') === false`, `canCourierMark('fallido') === false`.
- [ ] **Step 2:** `npx vitest run test/csv.test.ts test/format.test.ts test/status.test.ts` → FAIL.
- [ ] **Step 3:** Implement. CSV: hand-rolled RFC-4180 parser (~30 lines), separator = `;` if the header line has more `;` than `,`. `formatCOP` via `Intl.NumberFormat('es-CO')` prefixed `$ `. `bogotaToday` = `new Date(now.getTime() - 5*3600e3).toISOString().slice(0,10)`.
- [ ] **Step 4:** Same command → PASS; `npm run lint && npm run typecheck`.
- [ ] **Step 5:** Commit `feat: csv import parsing and es-CO formatting`.

### Task 3: Schema, RLS and seed

**Seat:** senior-builder. **ACs:** AC-06 (RLS), AC-01/AC-02 (roles via profiles), AC-23 (seed).

**Files:**
- Create: `supabase/migrations/20261015200000_core.sql`, `scripts/seed.mjs`, `test/seed.test.ts` (live, see Step 1)
- Modify: `package.json` (add script `seed`: `node scripts/seed.mjs`)

**Interfaces:**
- Produces table `profiles(id uuid pk references auth.users on delete cascade, full_name text not null, role text not null check (role in ('dispatcher','courier')))`.
- Produces table `deliveries(id uuid pk default gen_random_uuid(), delivery_date date not null, pedido text not null, cliente text not null, telefono text not null check (telefono ~ '^\+57[0-9]{10}$'), direccion text not null, barrio text not null default '', valor integer not null check (valor >= 0), status text not null default 'pendiente' check (status in ('pendiente','asignado','entregado','fallido')), courier_id uuid references profiles(id), failure_reason text check (failure_reason in ('no_estaba','direccion_errada','rechazado','otro')), updated_at timestamptz not null default now(), unique (delivery_date, pedido))`, index on `(delivery_date, courier_id)`.
- RLS: enable on both tables. Policies (defence in depth; the Worker uses service_role): `profiles` select where `id = auth.uid()`; `deliveries` select where `courier_id = auth.uid()` or caller's profile role is dispatcher. No insert/update/delete policies (only service_role writes).
- Produces `scripts/seed.mjs` (idempotent, uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env): creates via Auth admin API, or reuses, `carolina@rutasdelnorte.demo` (dispatcher, "Carolina Gómez"), `andres@rutasdelnorte.demo` (courier, "Andrés Pérez"), `luisa@rutasdelnorte.demo` (courier, "Luisa Martínez"), password `Demo2026!`; deletes (only `RDN-%` demo rows, any date) and re-inserts today's (Bogotá) 12 demo deliveries `RDN-1001..RDN-1012` with Bogotá addresses, split across both couriers: 2 pendiente, 4 asignado, 4 entregado, 2 fallido (`no_estaba`, `direccion_errada`) (R-06, R-08). Exports `DEMO_USERS` constant consumed by Task 8.

- [ ] **Step 1:** Failing test `test/seed.test.ts` (runs only when `SUPABASE_SERVICE_ROLE_KEY` is set: `describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)`; state "skipped: no key" in report if so): after running seed twice, today's `RDN-%` deliveries count is 12, status counts `{pendiente:2, asignado:4, entregado:4, fallido:2}`, and an anon-key client (no session) selecting `deliveries` gets 0 rows (RLS).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Write migration (with `-- down`), `bash scripts/db-push.sh`, write seed, `npm run seed` twice.
- [ ] **Step 4:** `npx vitest run test/seed.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat: core schema with rls and demo seed`.

### Task 4: Auth middleware

**Seat:** senior-builder. **ACs:** AC-03, AC-04, AC-01/AC-02 (role check).

**Files:**
- Create: `src/lib/db.ts`, `src/lib/auth.ts`, `test/auth.test.ts`
- Modify: `src/app.ts` (add `GET /api/me`)

**Interfaces:**
- Consumes: `Env`, `app` (Task 1); tables (Task 3).
- Produces: `adminClient(env: Env): SupabaseClient` (service_role, `auth.persistSession=false`); `requireRole(...roles: ('dispatcher'|'courier')[]): MiddlewareHandler` — reads `Authorization: Bearer`, `adminClient(env).auth.getUser(token)`, loads profile; sets `c.set('user', { id: string; role: 'dispatcher'|'courier'; full_name: string })`; 401 `{error:'no autenticado'}` on missing/invalid token or missing profile; 403 `{error:'sin permiso'}` on wrong role. `GET /api/me` (any role) returns the user object.
- Tests mock `adminClient` with `vi.mock('../src/lib/db')` returning a stub whose `auth.getUser` and `from('profiles')` resolve canned values.

- [ ] **Step 1:** Failing tests: no header → 401; `Bearer garbage` (getUser returns error) → 401; courier token on a `requireRole('dispatcher')` probe route → 403; dispatcher → 200 and `/api/me` body has `role: 'dispatcher'`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS, lint, typecheck.
- [ ] **Step 5:** Commit `feat: jwt auth middleware with roles`.

### Task 5: Delivery API (dispatcher + courier)

**Seat:** senior-builder. **ACs:** AC-04, AC-05, AC-07..AC-11 (server side), AC-12, AC-13, AC-14, AC-16..AC-19, AC-20.

**Files:**
- Create: `src/routes/deliveries.ts`, `test/deliveries.test.ts`
- Modify: `src/app.ts` (mount)

**Interfaces:**
- Consumes: `parseDeliveriesCsv`, `bogotaToday`, `canAssign`, `canCourierMark`, `REASONS` (Task 2); `requireRole`, `adminClient` (Task 4).
- Produces endpoints (all JSON; `date` defaults to `bogotaToday()`, must match `YYYY-MM-DD` else 400):
  - `POST /api/import/preview` (dispatcher) body `{ csv: string, date?: string }` → `{ date, valid: ImportRow[], skipped: Skipped[] }` (existing pedidos for that date fetched from DB).
  - `POST /api/import/confirm` (dispatcher) same body → re-parses server-side (400 with the parser's `error` if any), inserts valid rows with status `pendiente` → `{ inserted: number, skipped: Skipped[] }`. Never trusts a client-sent row list.
  - `GET /api/deliveries?date=` (dispatcher) → `Delivery[]` incl. `courier_name`, ordered by `pedido`.
  - `GET /api/couriers` (dispatcher) → `{ id, full_name }[]`.
  - `PATCH /api/deliveries/:id/assign` (dispatcher) `{ courier_id }` → 404 unknown delivery, 400 if courier_id is not a courier, 409 if `!canAssign(status)`; else status `asignado`, courier set, failure_reason cleared → updated `Delivery`.
  - `GET /api/me/deliveries?date=` (courier) → own deliveries only.
  - `PATCH /api/deliveries/:id/status` (courier) `{ status: 'entregado'|'fallido', reason?: Reason }` → 403 if `courier_id !== user.id`; 409 if `!canCourierMark(status)`; 400 if fallido without valid reason; else updated `Delivery`.
  - `GET /api/summary?date=` (dispatcher) → `{ date, entregado: n, fallido: n, pendiente: n, asignado: n, failed: { pedido, cliente, direccion, courier_name, failure_reason }[] }`. (End-of-day "pendiente" on screen = pendiente + asignado, R-05.)
- `type Delivery = { id, delivery_date, pedido, cliente, telefono, direccion, barrio, valor, status, courier_id, courier_name, failure_reason, updated_at }`.
- Tests: same `vi.mock('../src/lib/db')` approach with an in-memory stub of the few query chains used; keep the stub in `test/fakeDb.ts` and use it for all route tests.

- [ ] **Step 1:** Failing tests, one per rule: preview lists skipped rows and doesn't write; confirm inserts only valid rows and skips DB duplicates; assign on `entregado` → 409; reassign a `fallido` → `asignado` with reason cleared; courier A marking courier B's delivery → 403; `fallido` without reason → 400; `fallido` + `lluvia` → 400; `fallido` + `otro` → 200; courier re-marking an `entregado` → 409; courier on `/api/summary` → 403; summary counts match fixture.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS, lint, typecheck.
- [ ] **Step 5:** Commit `feat: delivery api for dispatcher and courier`.

### Task 6: Dispatcher screen (`/`)

**Seat:** junior-builder. **ACs:** AC-01, AC-07..AC-11 (UI), AC-12, AC-13, AC-14, AC-20.

**Files:**
- Create: `web/Login.tsx`, `web/Dispatcher.tsx`, `web/supabase.ts`, `test/web/dispatcher.test.tsx` (if jsdom is added; otherwise QA covers UI and the builder says so)
- Modify: `web/App.tsx`

**Interfaces:**
- Consumes: endpoints from Task 5; `api()` from Task 1; `formatDate`, `formatCOP` from Task 2 (import from `src/lib/format.ts`).
- Produces: `web/supabase.ts` exports `supabase` browser client (URL + anon key from `import.meta.env.VITE_SUPABASE_URL/ANON_KEY`, values copied from wrangler.toml `[vars]` into `vite.config.ts` `define`); `<Login role="dispatcher"|"courier">` reused by Task 7. A courier who logs in at `/` sees "Esta pantalla es para despacho" and a link to `/mensajero`.
- Screen sections, top to bottom: header with date `dd/mm/yyyy` and "Cerrar sesión"; **Cierre del día** (Entregados / Fallidos / Pendientes counts + failed list with pedido, cliente, dirección, mensajero, reason label) — this is the 6pm screen; **Importar CSV** (file input → preview table of valid rows + skipped list with row number and Spanish reason, or the AC-11 error → "Confirmar"); **Entregas** table (pedido, cliente, teléfono, dirección, barrio, valor, estado, mensajero select). Changing the select calls assign and refreshes. Rows `entregado` show the select disabled.

- [ ] **Step 1–4:** TDD where testable; then `npm run build` and run `npx wrangler dev` + manual check of login → import preview → confirm → assign. Report what was checked by hand.
- [ ] **Step 5:** Commit `feat: dispatcher screen`.

### Task 7: Courier screen (`/mensajero`)

**Seat:** junior-builder. **ACs:** AC-02, AC-16, AC-17, AC-18, AC-19.

**Files:**
- Create: `web/Courier.tsx`
- Modify: `web/App.tsx`

**Interfaces:**
- Consumes: `<Login role="courier">`, `supabase`, `api()`; `GET /api/me/deliveries`, `PATCH /api/deliveries/:id/status`.
- Produces: mobile-first list (360 px wide, tap targets ≥ 44 px) of today's own deliveries: pedido, cliente, `tel:` link, dirección + barrio, valor, estado. For `asignado`: buttons "Entregado" and "Fallido"; Fallido opens a reason picker (4 options, none preselected; save disabled until one is picked), then confirms. Delivered/failed rows show their final state. Pull-free refresh button "Actualizar".

- [ ] **Step 1–4:** Build, `wrangler dev`, check at 360 px viewport that a courier can mark one entregado and one fallido with reason. Report the check.
- [ ] **Step 5:** Commit `feat: courier phone screen`.

### Task 8: Demo page, README, deploy, recorded happy path

**Seat:** senior-builder (deploy). **ACs:** AC-22, AC-23, AC-24, AC-26 (AC-25 ledger is the orchestrator's).

**Files:**
- Create: `web/Demo.tsx`, `e2e/happy-path.spec.ts`, `playwright.config.ts`, `docs/demo/happy-path.webm` (generated)
- Modify: `web/App.tsx`, `README.md`

**Interfaces:**
- Consumes: `DEMO_USERS` from `scripts/seed.mjs` (copy the emails/password literally into `Demo.tsx`; they are demo credentials, intentionally public).
- `/demo` (no login): one paragraph in Spanish explaining the problem, the three demo accounts with password, buttons "Abrir como despacho" (`/`) and "Abrir como mensajero" (`/mensajero`), and today's seeded counts from a public `GET /api/demo/summary` that returns only counts (no PII).
- README (Spanish, first 10 lines readable by Carolina's boss): problem in the company's words (quote PROBLEM.md), what was built, how to run locally, how to deploy (`npm run deploy`, secrets via `bash scripts/worker-secrets.sh`, `bash scripts/db-push.sh`, `npm run seed`), deployed URL, what's not done.
- `e2e/happy-path.spec.ts` against `BASE_URL` (deployed): dispatcher logs in, uploads `docs/demo/pedidos-ejemplo.csv` (preview shows skipped rows), confirms, assigns deliveries to Andrés; courier Andrés logs in on a 360 px viewport, marks one entregado and one fallido (no estaba); dispatcher's Cierre del día shows the counts and the reason. `recordVideo` → `docs/demo/happy-path.webm`.

- [ ] **Step 1:** `npm run deploy`; `curl -s $URL/api/health` → `{"ok":true}`; `curl -s $URL/demo` → 200.
- [ ] **Step 2:** `npm run seed`; `curl -s $URL/api/demo/summary` → entregado 4, fallido 2, pendiente 6.
- [ ] **Step 3:** `BASE_URL=$URL npx playwright test e2e/happy-path.spec.ts` → PASS, webm exists.
- [ ] **Step 4:** Re-run `npm run seed` so the demo is clean after the recording.
- [ ] **Step 5:** Commit `feat: demo page, readme, happy path recording`.

### Task 9 (SHOULD, only after every MUST passed QA): search and past-date close

**Seat:** junior-builder. **ACs:** AC-15, AC-21.

**Files:** Modify `web/Dispatcher.tsx`.

- Search box above Entregas filters today's rows client-side by `pedido` substring (AC-15).
- `<input type="date">` in Cierre del día, default today, max today; calls `GET /api/summary?date=` (Task 5 already accepts `date`) (AC-21).
- [ ] Check by hand on `wrangler dev`; commit `feat: board search and past-date close`.

### Task 10 (SHOULD, after Task 9): 6pm end-of-day email

**Seat:** junior-builder. **ACs:** AC-28.

**Files:**
- Create: `src/lib/email.ts`, `src/cron.ts`, `test/cron.test.ts`
- Modify: `src/index.ts` (`export default { fetch: app.fetch, scheduled }`), `wrangler.toml` (`[triggers] crons = ["0 23 * * *"]` = 18:00 Bogotá; recipient = the dispatcher's auth email, looked up with `adminClient(env).auth.admin.getUserById` for the `profiles` row with role dispatcher)

**Interfaces:**
- `sendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<{ id: string }>` (fetch to Resend; tests mock fetch).
- `scheduled` builds the same numbers as `GET /api/summary` for `bogotaToday()` and sends subject "Cierre del día dd/mm/yyyy" to the dispatcher.
- Test: mocked fetch receives one POST to `https://api.resend.com/emails` whose html contains the three counts and each failed pedido.

---

## Execution notes for the orchestrator

- Dependency order: 1 → 2 → 3 → 4 → 5 → (6 ∥ 7) → 8 → 9 → 10. Tasks 9 and 10 are SHOULD: only after every MUST passed QA, and never in FREEZE. Cut order if short: 10, then AC-21, then AC-15. Tasks 2 and 3 may run in parallel after 1.
- Task 3 runs `db-push.sh` against the hackathon Supabase project (pre-authorised). Task 8 deploys to Roberto's Cloudflare account (pre-authorised).
- Copy SPEC.md "Product rulings at plan time" R-01..R-10 into the ledger verbatim in your first entry (AC-25).
- `scripts/sync.sh` pushes `main`/`integration`/`task/*` only; after merging `integration` into `dryrun/e2e`, push it with `git push -u origin dryrun/e2e`.
