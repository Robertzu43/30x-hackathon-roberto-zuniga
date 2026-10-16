# Thesaurus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (the orchestrator runs it) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An accounts-payable agent for Blinka's challenge: it reads invoices (PDF, image, pasted email, pasted chat), decides PAGAR / FRENAR / ESCALAR against the company's policy, records an explanation a non-engineer reads, and asks a human by email when a rule breaks. Judged on Autonomía, Seguridad (one wrong PAGAR disqualifies) and Explicabilidad.

**Architecture:** Cloudflare Worker (Hono) serves `/api/*` and a Vite + React SPA. Supabase Postgres holds companies, beneficiaries, versioned policies, invoices and an append-only `decisions` table; RLS by `company_id`; every signup gets a seeded workspace by a database trigger. The decision engine is a pure TypeScript function; PAGAR exists only as its output. Workers AI reads documents; SES sends OTP (via Supabase SMTP) and escalation mail.

**Tech Stack:** TypeScript, Hono, Vite + React, supabase-js, Workers AI (`AI` binding), `unpdf` (PDF text), `aws4fetch` (SES SigV4), `zod`, Vitest, Playwright (video only). No ORM, no i18n library, no tour library, no UI kit.

**Spec:** `docs/PROBLEM.md`, `docs/DECISIONS.md` (D1-D21), `docs/CONTEXT.md` (rubric, deadline), `docs/SPEC.md` (AC-01..AC-60 and provisional rulings R-01..R-22, which bind every task below; where this plan and a ruling differ, the ruling wins and the task follows it).

## Global Constraints

- Node 22, TypeScript strict, ESM. `package.json` scripts `lint`, `typecheck`, `test`, `build`; `eslint.config.js` ignores `.worktrees/`, `dist/`, `.wrangler/`, `node_modules/` (CLAUDE.md).
- Spanish is the default language; every UI string and record sentence exists in `es` and `en` dictionaries (D14, D20). Emails and seed data are Spanish only. Formats: `es-CO` and `en-US` via `Intl`.
- Outcomes are exactly `PAGAR | FRENAR | ESCALAR` (D1); check verdicts are exactly `cumple | no_cumple | no_verificado` (D15). PAGAR is produced only by `decide()` when every check is `cumple` (D2).
- Money: amounts are `number` with 2 decimals in the invoice currency; USD conversion is `round2(amount * rate)` (D6). Period = calendar month in `America/Bogota` by arrival date; budget and balance in USD.
- Append-only: `decisions`, `approval_tokens`, `approval_uses` have no UPDATE/DELETE RLS policies (D10). Migrations are forward-only and additive; the `public` schema already has `profiles` and `deliveries` from an earlier run: never reuse those names. Seeds are upsert-only; "reset" archives (flag) and re-inserts (CLAUDE.md Infrastructure).
- Secrets only from env/Worker secrets: `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY`, `SES_FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`, `APPROVAL_HMAC_SECRET`. Public vars in `wrangler.toml`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `WORKERS_AI_MODEL`, `WORKERS_AI_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct"`, `SES_REGION = "us-east-2"`, `JEV_ENABLED = "false"`, `DEMO_EMAIL = "demo@andina-labs.example"`.
- Design: every screen follows the preloaded `minimalist-ui` skill; `/demo` and Login use `design-taste-frontend` (D21). Spanish copy, es-CO locale.
- Only the orchestrator deploys (`wrangler deploy` from `<RUN>/integration`) and applies migrations (`bash scripts/db-push.sh`). Builders never do either. Tasks 2 and 3 need their migration applied before QA: the orchestrator runs `bash scripts/db-push.sh` from the task worktree after the reviewer passes and before `qa-server.sh start`.

## Review Focus

1. An invoice whose amount reads `"1.000,00"` (es-CO) must not become 1.00 USD and pass the limit: `parseAmount` test in Task 4 covers `"1.000,00" -> 1000`, `"1,000.00" -> 1000`, `"$ 2.500" -> 2500`, `"2.500,5" -> null`.
2. Two invoices arriving at the same second that together exceed the budget: `insert_decision` STALE_PERIOD test in Task 8 (second insert with a stale `expected_committed_usd` raises and the Worker re-decides).
3. A mail scanner opening the approval link: Task 9 test asserts `GET /api/approve/:token` writes nothing and `POST` is the only consumer; a second `POST` with the same token returns 409.
4. A policy with an empty allowed list or a missing limit: Task 4 test `decide` returns ESCALAR with check `no_verificado`, never PAGAR.
5. A beneficiary with the same name and a different account number: Task 4 test returns ESCALAR with check `beneficiario_cuenta` = `no_cumple` and reason "cuenta cambiada".

---

### Task 1: Scaffold (Worker + SPA + tooling + i18n skeleton)

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `vite.config.ts`, `index.html`, `src/index.ts`, `src/env.ts`, `src/i18n/es.ts`, `src/i18n/en.ts`, `src/i18n/index.ts`, `web/main.tsx`, `web/App.tsx`, `web/i18n.tsx`, `web/styles.css`, `web/api.ts`
- Modify: `wrangler.toml` (add the public vars listed in Global Constraints; keep `[assets]`, `[ai]`, KV)
- Test: `src/index.test.ts`, `src/i18n/i18n.test.ts`

**Interfaces:**
- Produces: `app: Hono<{ Bindings: Env }>` default export from `src/index.ts`; `Env` in `src/env.ts` with bindings `AI`, `KV`, vars and secrets named in Global Constraints; `t(lang: 'es'|'en', key: string, vars?: Record<string,string|number>): string` and `type Lang = 'es'|'en'` from `src/i18n/index.ts` (dictionaries are flat `Record<string,string>`; `{name}` placeholders); `web/i18n.tsx` exports `LangProvider`, `useT()` returning `{ t, lang, setLang }` persisted in `localStorage['lang']`; `web/api.ts` exports `api(path, init?)` that adds the Supabase session JWT as `Authorization: Bearer` and throws on non-2xx with the JSON `error` field.
- Routes: `GET /api/health -> { ok: true }`. SPA served from `dist/` by `[assets]`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/index.test.ts
import app from './index';
test('health', async () => {
  const res = await app.request('/api/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
// src/i18n/i18n.test.ts
test('every es key exists in en', () => expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort()));
test('interpolates', () => expect(t('es', 'test.hello', { name: 'Ana' })).toBe('Hola, Ana'));
```

- [ ] **Step 2: Run `npx vitest run` and see them fail (modules missing)**
- [ ] **Step 3: Scaffold.** Install `hono`, `react`, `react-dom`, `react-router-dom`, `@supabase/supabase-js`, `zod`; dev: `typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `eslint`, `typescript-eslint`, `wrangler`, `@cloudflare/workers-types`. `src/index.ts` creates the Hono app with `app.get('/api/health', c => c.json({ ok: true }))` and a `notFound` JSON handler for `/api/*`. `web/App.tsx` renders a top bar with a language switch (`es | en`) and a placeholder route per screen (`/`, `/invoices/:id`, `/policy`, `/beneficiaries`, `/period`, `/login`, `/demo`, `/approve/:token`). `web/styles.css` holds the minimalist-ui tokens (warm monochrome palette, one accent, type scale, no gradients/shadows).
- [ ] **Step 4: `npm run lint && npm run typecheck && npm test && npm run build` all pass; `dist/index.html` exists**
- [ ] **Step 5: Commit** `feat: scaffold worker, spa, tooling and i18n`

### Task 2: Schema, RLS, workspace trigger, decision RPC

**Files:**
- Create: `supabase/migrations/20261017000100_thesaurus_core.sql`, `supabase/migrations/20261017000200_thesaurus_rpc.sql`
- Test: `scripts/tests/schema.test.sh` (greps the migration for every table, RLS line and policy named below; runs in `scripts/tests/run.sh`)

**Interfaces (tables, all with `company_id uuid not null` and RLS `using (company_id in (select company_id from company_members where user_id = auth.uid()))` unless noted):**
- `companies(id uuid pk default gen_random_uuid(), name text, approver_email text, lang text default 'es', is_demo boolean default false, created_at timestamptz default now())`. RLS: select for members only.
- `company_members(company_id, user_id uuid, role text default 'owner', primary key (company_id, user_id))`. RLS select own rows.
- `policies(id uuid pk, company_id, version int, name text, rules jsonb, created_at)`; unique `(company_id, version)`; insert + select only (a new version is a new row).
- `beneficiaries(id uuid pk, company_id, name text, country text, currency text, bank_account text, route text, category text, agreement jsonb, created_at, updated_at)`; select/insert/update.
- `invoices(id uuid pk, company_id, source text check (source in ('pdf','image','email','chat')), file_path text, raw_text text, fields jsonb, expected_outcome text, archived boolean default false, received_at timestamptz default now(), created_at)`; select/insert; update restricted to the `archived` column with a column-level grant (`revoke update on invoices from authenticated; grant update (archived) on invoices to authenticated;`) plus the members update policy (R-12).
- `decisions(id uuid pk, company_id, invoice_id uuid references invoices, seq int, outcome text check (outcome in ('PAGAR','FRENAR','ESCALAR')), actor text check (actor in ('agent','human')), actor_email text, channel text check (channel in ('link','dashboard')), checks jsonb, headline_es text, headline_en text, policy_version int, amount_usd numeric(14,2), payment jsonb, note text, created_at)`; unique `(invoice_id, seq)`; RLS: select, insert only.
- `approval_tokens(token_hash text pk, company_id, invoice_id, decision_id uuid, expires_at timestamptz, created_at)`; `approval_uses(token_hash text pk, decision_id uuid, created_at)`; RLS: insert/select only, members.
- Storage: policy on `storage.objects` for bucket `files`: members may select/insert where `(storage.foldername(name))[1] = company_id::text` of one of their companies.
- Trigger `on_auth_user_created` after insert on `auth.users` (security definer): creates a company named from the email's local part, a member row, then calls `seed_company(company_id)` (defined in Task 3; this migration creates a stub `seed_company(uuid) returns void` that does nothing, Task 3 replaces it with `create or replace`).
- RPC `insert_decision(p_invoice_id uuid, p_expected_committed_usd numeric, p_decision jsonb) returns decisions` (security invoker, `plpgsql`): takes `pg_advisory_xact_lock(hashtext(company_id::text))`, recomputes `committed_usd` for the invoice's company and month (sum of `amount_usd` of the latest decision per non-archived invoice whose outcome is PAGAR or ESCALAR, month of `received_at` in `America/Bogota`), excluding `p_invoice_id` itself (so a re-evaluation of an escalated invoice does not count its own earlier commitment), raises `exception 'STALE_PERIOD'` if it differs from `p_expected_committed_usd` by more than 0.005, raises `exception 'FINAL_DECISION'` when the invoice's latest decision is PAGAR or FRENAR (R-04, D16), raises `exception 'NOT_ESCALATED'` when `p_decision->>'actor' = 'human'` and the latest decision is not ESCALAR (R-03), else inserts the decision with `seq = coalesce(max(seq)+1, 1)` and returns the row.
- RPC `period_state(p_company_id uuid, p_month date) returns jsonb` with `{ paid_usd, committed_usd, count_by_outcome, by_beneficiary: [...] }` using the same "latest decision per invoice" rule.
- View `invoice_current` (`with (security_invoker = true)` so RLS applies) = each non-archived invoice joined to its latest decision (or null).
- `companies` update policy for members (only `name`, `approver_email`, `lang` are sent by the API).

- [ ] **Step 1: Write `scripts/tests/schema.test.sh`** asserting the migration files contain `create table public.companies`, `... decisions`, `enable row level security` once per table (8 times), no `drop`, no `truncate`, no `delete from`, and `pg_advisory_xact_lock` in the RPC file.
- [ ] **Step 2: Run `bash scripts/tests/run.sh` and see it fail**
- [ ] **Step 3: Write both migrations** as specified. Use `create or replace function` for every function and `create policy ... ` names `members_select_<table>`, `members_insert_<table>`, `members_update_<table>`.
- [ ] **Step 4: `bash scripts/tests/run.sh` passes.** The orchestrator applies with `bash scripts/db-push.sh` before QA; QA verifies by signing up a fresh user (OTP to `HEARTBEAT_EMAIL`) and reading `companies` through the REST API with that user's JWT, and that the same JWT cannot read another company's rows.
- [ ] **Step 5: Commit** `feat: core schema, rls, workspace trigger, decision rpc`

### Task 3: Seed data (Andina Labs) and demo documents

**Files:**
- Create: `supabase/migrations/20261017000300_seed_andina.sql` (`create or replace function seed_company(p_company uuid)`, plus `reset_demo_company()` ), `scripts/gen-invoices.mjs`, `web/public/demo/invoices/*.pdf|*.png` (generated), `docs/demo/DATASET.md`
- Test: `scripts/tests/seed.test.sh`

**Interfaces:**
- `seed_company(p_company uuid)`: upserts policy v1 "Política general" with `rules = { per_payment_limit_usd: 5000, approval_threshold_usd: 2500, period_budget_usd: 50000, account_balance_usd: 42000, duplicate_window_days: 30, agreement_tolerance_pct: 1, due_grace_days: 0, fx_rates: { COP: 0.000245, MXN: 0.054, BRL: 0.18, ARS: 0.00095, EUR: 1.08, USD: 1 }, allowed_beneficiaries_only: true }`; 8 beneficiaries (CO retainer 2500 USD monthly `Laura Méndez` route `COP · transferencia`; MX hourly 45 USD cap 3000 `Diego Ruiz` route `MXN`; BR designer 1800 USD monthly `Ana Souza` route `Pix`; AR dev 2200 USD monthly `Martín López` route `CBU`; US SaaS `Nube Sur LLC` subscription 4200 USD monthly route `ACH`; EU vendor `Forma Studio` one-off route `SWIFT`; CO accountant `Contadores Andinos SAS` 900 USD monthly route `COP`; US contractor `Northstar Group` hourly 80 USD cap 2000 route `ACH`); 29 invoices with `fields` pre-extracted (including `bank_account`, R-05) and `expected_outcome`: 15 PAGAR (normal), 3 FRENAR (exact duplicate of an earlier one; amount over the hard per-payment limit; `25.000.000 COP` = 6.125 USD over the per-payment limit, R-07), 11 ESCALAR (duplicate with a different number; new beneficiary `Pixel Lab`; Laura Méndez with a changed account; Nube Sur LLC 4.200 USD over the approval threshold, the one the video approves; retainer invoice for 3.100 instead of 2.500; `13.000.000 COP` = 3.185 USD over the threshold; the invoice that exhausts the month's budget; the one that exceeds the account balance; illegible (fields null); past due; outside the period). Dates are relative to seeding time (`now()` offsets, R-09). The builder picks rule values and arrival order so that each trap fails its own named check and nothing else (R-08: with balance above budget the balance trap can never fail; set `account_balance_usd` below `period_budget_usd` and order the invoices so the budget trap fails on pending commitments while the balance trap fails on paid amounts), and proves it with the seed-replay test of Task 4. Seed invoices use fixed ids `00000000-0000-4000-8000-0000000000NN` suffixed per company via `uuid_generate_v5`-free approach: `md5(p_company::text || NN)::uuid`.
- `reset_demo_company()`: for the company where `is_demo`, sets `archived = true` on all its invoices, re-inserts the 29 seed invoices with new ids, inserts policy version `max+1` with the seed rules, upserts the 8 beneficiaries by `(company_id, name)`.
- `scripts/gen-invoices.mjs`: renders each seed invoice from an HTML template with Playwright (`/opt/pw-browsers/chromium`) to `web/public/demo/invoices/<NN>.pdf` (text layer) or `.png` (for the `image` ones), Spanish copy, es-CO number formats, one deliberately blurred PNG for the illegible case. Email and chat invoices have no file; their `raw_text` is in the seed.
- `docs/demo/DATASET.md`: the table of 27 invoices: id, beneficiary, amount, currency, source, trap, expected outcome, reason.

- [ ] **Step 1: Write `scripts/tests/seed.test.sh`** asserting the migration has 29 `expected_outcome` values with counts PAGAR=15, FRENAR=3, ESCALAR=11, 8 beneficiaries, no `delete`/`truncate`, and `DATASET.md` lists the same 29 rows with the same counts (R-08).
- [ ] **Step 2: Run it, see it fail**
- [ ] **Step 3: Write the migration, the generator and DATASET.md.** Run `node scripts/gen-invoices.mjs` and commit the generated files.
- [ ] **Step 4: `bash scripts/tests/run.sh` passes.** Orchestrator applies the migration before QA; QA: a fresh signup sees 29 invoices and 8 beneficiaries.
- [ ] **Step 5: Commit** `feat: andina labs seed, demo documents, dataset table`

### Task 4: Money parsing and the decision engine (pure)

**Files:**
- Create: `src/lib/money.ts`, `src/engine/types.ts`, `src/engine/checks.ts`, `src/engine/decide.ts`
- Test: `src/lib/money.test.ts`, `src/engine/decide.test.ts`

**Interfaces:**
- `parseAmount(raw: string): number | null` (accepts `1.000,00`, `1,000.00`, `$ 2.500`, `USD 1,234.5`; ambiguous like `2.500,5` -> null); `toUsd(amount: number, currency: string, rates: Record<string, number>): number | null` (`round2`, null when no rate).
- `types.ts`: `Outcome = 'PAGAR'|'FRENAR'|'ESCALAR'`; `Verdict = 'cumple'|'no_cumple'|'no_verificado'`; `InvoiceFields { payee_name: string|null; amount: number|null; currency: string|null; invoice_number: string|null; issue_date: string|null; due_date: string|null; concept: string|null; bank_account: string|null; confidence: Record<string, number> }` (R-05); `Invoice { id; received_at: string; source; fields: InvoiceFields }`; `Beneficiary { id; name; bank_account; currency; route; category; agreement: { type: 'retainer'|'hourly'|'subscription'|'one_off'; amount_usd?: number; cap_usd?: number; period?: 'monthly'; valid_until?: string } }`; `PolicyRules` (the seed keys); `PeriodState { month: string; committed_usd: number; paid_usd: number; balance_usd: number; previous /* every non-archived invoice received within the policy's duplicate_window_days, not only this month (R-06) */: Array<{ invoice_id; invoice_number: string|null; beneficiary_id: string|null; amount_usd: number; concept: string|null; received_at: string; outcome: Outcome }> }`; `Check { id: CheckId; verdict: Verdict; actual: string; threshold: string; values: Record<string, string|number|null>; overridden?: { by: string; channel: 'link'|'dashboard' } }` (an overridden check keeps `verdict: 'no_cumple'` and is rendered as "no cumple · aprobado por <correo> <canal>", R-22); `Decision { outcome: Outcome; checks: Check[]; amount_usd: number|null; payment: { beneficiary: string; route: string; currency: string; amount: number } | null }`.
- `CheckId` = `lectura | beneficiario_permitido | beneficiario_cuenta | acuerdo | duplicado_exacto | duplicado_probable | limite_pago | umbral_aprobacion | presupuesto_periodo | saldo_cuenta | vencimiento | periodo | moneda`.
- `decide(invoice: Invoice, beneficiary: Beneficiary | null, rules: PolicyRules | null, period: PeriodState, now: string): Decision`. Consequence table fixed (D15): `duplicado_exacto` or `limite_pago` `no_cumple` -> FRENAR; any other `no_cumple` or any `no_verificado` -> ESCALAR; all `cumple` -> PAGAR with `payment` filled from the beneficiary. Missing rule key or null `rules` -> that check `no_verificado`. `beneficiary === null` -> `beneficiario_permitido` `no_cumple`. Same name, different `bank_account` -> `beneficiario_cuenta` `no_cumple` with `values.reason = 'cuenta cambiada'`; invoice `bank_account` null -> `beneficiario_cuenta` `no_verificado` (R-05). Exact duplicate looks back over `period.previous` (the duplicate window); `duplicate_window_days` missing -> `duplicado_exacto` `no_verificado` (R-06). Agreement: retainer/subscription amount within `agreement_tolerance_pct`; hourly within `cap_usd`; one_off always `cumple`. Exact duplicate: same beneficiary + same `invoice_number` in `period.previous` (any outcome). Probable duplicate: same beneficiary + same concept + same month, different number -> `no_cumple` (ESCALAR). Period: `received_at` month in `America/Bogota` equals `period.month`. Budget: `committed_usd + amount_usd <= period_budget_usd`; balance: `paid_usd + amount_usd <= account_balance_usd`. Due: `due_date >= today - due_grace_days`.
- `HUMAN_OVERRIDABLE: CheckId[] = ['umbral_aprobacion','beneficiario_permitido','beneficiario_cuenta','acuerdo','duplicado_probable','vencimiento','periodo','lectura']` (never `presupuesto_periodo`, `saldo_cuenta`, `limite_pago`, `duplicado_exacto`, `moneda`: those need data or a policy change).
- `decideWithOverrides(overridden: CheckId[], by: { email: string; channel: 'link'|'dashboard' }, invoice, beneficiary, rules, period, now): Decision` = `decide`, then for each check in `overridden` that is `no_cumple` or `no_verificado` and in `HUMAN_OVERRIDABLE`, keep its verdict but set `overridden = by` and treat it as passing for the consequence table (R-02, R-22). The approval flow passes `overridden` = the ids of the checks that were not `cumple` in the escalated decision; budget, balance, per-payment limit, exact duplicate and rate are always re-checked fresh and can never be overridden (R-21).

- [ ] **Step 1: Write the tests**: money cases from Review Focus 1; one `decide` test per seed trap (same values as Task 3) asserting outcome and the failing check id; `all cumple -> PAGAR with payment`; `rules null -> ESCALAR, every check no_verificado`; `empty allowed list -> ESCALAR`; `currency without rate -> ESCALAR moneda`; `decideWithOverrides(['umbral_aprobacion'], by, ...)` after budget exhausted -> ESCALAR presupuesto_periodo`; `decideWithOverrides(['presupuesto_periodo'], ...)` still ESCALAR (non-overridable); an overridden check keeps `verdict 'no_cumple'` and carries `overridden.by`; seed-replay test: `decide` over every Task 3 seed row with the AI binding throwing gives `expected_outcome` (AC-10); one test per CheckId forcing `no_cumple` then `no_verificado` asserts outcome != PAGAR (AC-16).
- [ ] **Step 2: `npx vitest run src/engine src/lib/money.test.ts` fails**
- [ ] **Step 3: Implement** `money.ts`, `checks.ts` (one exported function per CheckId with signature `(ctx: CheckContext) => Check`), `decide.ts` (runs all checks, applies the table).
- [ ] **Step 4: Tests pass; `npm run lint && npm run typecheck` pass**
- [ ] **Step 5: Commit** `feat: money parsing and pure decision engine with trap tests`

### Task 5: Explanations (templates es/en)

**Files:**
- Create: `src/engine/explain.ts`; add keys to `src/i18n/es.ts`, `src/i18n/en.ts`
- Test: `src/engine/explain.test.ts`

**Interfaces:**
- `explainCheck(check: Check, lang: Lang): string` e.g. es: `Límite por pago: 2.500 USD ≤ 5.000 USD → cumple`, `Presupuesto octubre: 42.000 usados + 2.500 = 44.500 ≤ 50.000 USD → cumple`, `Moneda: 1.500.000 COP × 0,000245 = 367,50 USD (tasa de la política)`.
- `headline(decision: Decision, invoice, beneficiary, lang): string` e.g. `PAGAR · 2.500 USD a Laura Méndez, retainer de octubre, dentro de reglas`; `ESCALAR · 4.200 USD a Nube Sur LLC: supera el umbral de aprobación de 2.500 USD`.
- `whatWouldPay(decision, lang): string[]` one line per non-`cumple` check: `Que una persona apruebe el monto sobre el umbral`.
- Numbers through `new Intl.NumberFormat(lang === 'es' ? 'es-CO' : 'en-US')`.

- [ ] **Step 1: Tests** for 4 check sentences in both languages, 2 headlines, `whatWouldPay` for an ESCALAR with two failing checks, and `every CheckId x Verdict has a template key in both dictionaries`.
- [ ] **Step 2: Fail**  - [ ] **Step 3: Implement**  - [ ] **Step 4: Pass**  - [ ] **Step 5: Commit** `feat: bilingual explanation templates`

### Task 6: Email (SES) and approval tokens

**Files:**
- Create: `src/lib/email.ts`, `src/lib/tokens.ts`
- Test: `src/lib/email.test.ts`, `src/lib/tokens.test.ts`

**Interfaces:**
- `sendEmail(env: Env, msg: { to: string; subject: string; text: string; html: string }): Promise<{ sent: boolean; id?: string }>`: SES v2 `SendEmail` on `https://email.${env.SES_REGION}.amazonaws.com/v2/email/outbound-emails` signed with `aws4fetch` using `AWS_SES_ACCESS_KEY_ID/SECRET`, from `SES_FROM_EMAIL`. When either secret is missing: `console.log` the message and return `{ sent: false }`; never throw.
- `escalationEmail(args: { lang: 'es'; invoice; decision; approveUrl: string; rejectUrl: string }): { subject; text; html }` Spanish: headline, "Lo que leí" fields, the broken rules, two buttons.
- `tokens.ts`: `signToken(secret: string, payload: { invoice_id: string; decision_id: string; action: 'approve'|'reject'; exp: number }): Promise<string>` (base64url payload + HMAC-SHA256 via WebCrypto), `verifyToken(secret, token): Promise<payload | null>` (bad signature or expired -> null), `hashToken(token): Promise<string>` (sha256 hex).

- [ ] **Step 1: Tests**: `sendEmail` with mocked `fetch` asserts URL, `Authorization` header starts with `AWS4-HMAC-SHA256`, body `FromEmailAddress`; without secrets returns `{ sent: false }` and calls no fetch; token round trip, tampered token -> null, expired -> null.
- [ ] **Step 2: Fail**  - [ ] **Step 3: Implement**  - [ ] **Step 4: Pass**  - [ ] **Step 5: Commit** `feat: ses email helper and signed approval tokens`

### Task 7: Reader (document to fields)

**Files:**
- Create: `src/lib/llm.ts`, `src/prompts/extract.ts`
- Test: `src/lib/llm.test.ts`

**Interfaces:**
- `documentToText(env, input: { kind: 'pdf'|'image'|'text'; bytes?: ArrayBuffer; text?: string }): Promise<string>`: pdf via `unpdf` `extractText`; image via `env.AI.run(env.WORKERS_AI_VISION_MODEL, { image: [...bytes], prompt: 'Transcribe every text in this invoice exactly.' })`; text as is.
- `extractFields(env, text: string): Promise<InvoiceFields>`: `env.AI.run(env.WORKERS_AI_MODEL, { messages: [...prompt], response_format: { type: 'json_schema', json_schema: INVOICE_SCHEMA } })`; result validated with zod; amount re-parsed with `parseAmount` when the model returns a string; `confidence` per field in `[0,1]`; any failure (throw, invalid JSON, timeout 20s) returns all-null fields with `confidence = {}` and `concept = 'ilegible'`. Cross-check: if `subtotal` and `tax` are present and `subtotal + tax != total` (±0.01) set `amount = null`.
- `INVOICE_SCHEMA` in `src/prompts/extract.ts` (payee_name, amount, currency ISO, invoice_number, issue_date, due_date, concept, bank_account, subtotal, tax, confidence). A field with confidence below 0.8 is stored as null (R-10).

- [ ] **Step 1: Tests** with a fake `env.AI.run`: valid JSON -> fields; `"1.000,00"` string amount -> 1000; AI throws -> null fields `concept: 'ilegible'`; subtotal/tax mismatch -> amount null; pdf text layer from a fixture `src/lib/__fixtures__/simple.pdf` contains the payee name.
- [ ] **Step 2: Fail**  - [ ] **Step 3: Implement**  - [ ] **Step 4: Pass**  - [ ] **Step 5: Commit** `feat: document reader with schema-validated extraction`

### Task 8: API: invoices, run, policy, beneficiaries, period

**Files:**
- Create: `src/lib/supabase.ts`, `src/lib/auth.ts`, `src/routes/invoices.ts`, `src/routes/policy.ts`, `src/routes/beneficiaries.ts`, `src/routes/period.ts`, `src/services/runAgent.ts`
- Modify: `src/index.ts` (mount routes under `/api`)
- Test: `src/services/runAgent.test.ts`, `src/routes/routes.test.ts`

**Interfaces:**
- `userClient(env, jwt)` returns supabase-js client with `global.headers.Authorization = Bearer jwt`; `requireUser(c)` middleware verifies the JWT with `supabase.auth.getUser(jwt)` and sets `c.var.user`, `c.var.companyId` (first membership), `c.var.lang` (user metadata `lang` or `es`); 401 JSON otherwise.
- `runAgent(deps: { db; env; lang }, invoiceIds: string[] | 'pending'): Promise<{ PAGAR: number; FRENAR: number; ESCALAR: number }>`: for each invoice in `received_at` order: load beneficiary by normalized name (lowercase, strip punctuation and legal suffixes `s.a.s|sas|ltda|inc|llc`), latest policy, `period_state` (its `committed_usd` excludes the invoice being decided), previous decisions; `decide`; `insert_decision` with `expected_committed_usd`; on `STALE_PERIOD` retry up to 3 times; on a new ESCALAR (the invoice's first escalation, never on re-evaluation, R-16) and only when the company is not `is_demo` (R-15): create one approval token pair and send one escalation email to `companies.approver_email` (Task 6); writes `headline_es/en`, `amount_usd`, `payment`.
- Routes (all under `requireUser`): `POST /api/invoices` multipart (`file`, `source`; PDF/PNG/JPEG, max 10 MB) or JSON (`{ source: 'email'|'chat', text }`, 1-20000 chars; R-11; violations -> 400 `{ error: 'Formato no admitido: sube un PDF, PNG o JPG de hasta 10 MB' }`): stores the file at `files/<company_id>/<invoice_id>.<ext>`, runs the reader, inserts the invoice, runs the agent on it, returns `{ invoice, decision }`; `GET /api/invoices` -> `invoice_current` rows with `headline` in the user's lang; `GET /api/invoices/:id` -> invoice + all decisions (timeline) + beneficiary + explanations + `file_url` (5-minute signed URL from `storage.from('files').createSignedUrl` with the user client) when the invoice has a file; `PUT /api/company { name?, approver_email?, lang? }`; `POST /api/invoices/run` -> `runAgent('pending')`; `GET/PUT /api/policy` (PUT inserts version `max+1`, body validated with zod against `PolicyRules`, returns `{ policy, would_change: Array<{ invoice_id, headline, from: Outcome, to: Outcome }> }` listing the pending/escalated invoices whose outcome differs under the new rules, computed with `decide` without inserting (R-14)); `POST /api/policy/reevaluate` -> runs the agent on pending + escalated invoices; `GET/POST/PUT /api/beneficiaries`; `GET /api/period?month=YYYY-MM` -> `period_state` + `autonomy_pct` (R-01: over seeded invoices with `expected_outcome`, the share whose FIRST agent decision is PAGAR or FRENAR and equals `expected_outcome`, integer percent) + `violations` (R-01: seeded invoices whose first agent decision is PAGAR while `expected_outcome` is not PAGAR) + `explained_pct` (decisions with a non-empty `checks`, always 100) + budget/balance from the rules (D17).
- Validation errors -> 400 `{ error }`. Rate limit: `env.RATE_LIMIT` binding added to `wrangler.toml` in this task (`[[unsafe.bindings]] name = "RATE_LIMIT" type = "ratelimit" namespace_id = "1001" simple = { limit = 60, period = 60 }`), keyed by user id, on `POST` routes -> 429.

- [ ] **Step 1: Tests**: `runAgent` with an in-memory fake `db` (objects with the methods the service calls): 3 seed-like invoices produce the expected outcomes and `insert_decision` receives the right `expected_committed_usd`; STALE_PERIOD once -> retried and succeeds; ESCALAR -> `sendEmail` called once with two URLs. Routes: unauthenticated `GET /api/invoices` -> 401; `PUT /api/policy` with a negative limit -> 400.
- [ ] **Step 2: Fail**  - [ ] **Step 3: Implement**  - [ ] **Step 4: Pass; `qa-server.sh` run: upload a seed PDF, see the decision**  - [ ] **Step 5: Commit** `feat: api for invoices, agent run, policy, beneficiaries, period`

### Task 9: Approval flow (email links, confirm page, re-evaluation)

**Files:**
- Create: `src/routes/approvals.ts`, `src/lib/admin.ts` (the only module that builds the service-role client)
- Modify: `src/index.ts`
- Test: `src/routes/approvals.test.ts`

**Interfaces:**
- `GET /api/approve/:token` -> `{ invoice, decision, action, expires_at }` (verifies the token, reads with the service-role client scoped by the token's `invoice_id`; writes nothing).
- `POST /api/approve/:token { note? }` -> inserts `approval_uses` keyed by the escalation's `decision_id` (both links of a pair share it: `approval_uses(decision_id text pk, ...)`, `on conflict do nothing`; no row -> 409 `{ error: 'token_used' }`, R-03), then: approve -> `decideWithOverrides(<ids of the checks that were not cumple in the escalated decision>, { email: approver_email, channel: 'link' }, ...)` with fresh period state (R-02); the result is inserted via `insert_decision` with `actor = 'human'`, `actor_email`, `channel = 'link'` (the RPC refuses it unless the latest decision is ESCALAR, R-03/R-04); reject -> FRENAR decision with `actor = 'human'`. Returns the new decision. The same actions exist for a logged-in member with `channel = 'dashboard'`: `POST /api/invoices/:id/approve|reject` under `requireUser`; a dashboard answer also spends the pair (same `decision_id` row).

- [ ] **Step 1: Tests** (fake db): GET does not call any insert; POST approve then POST reject with the pair's other token -> 409; dashboard approve after a link approve -> 409; approve after budget exhausted -> new decision ESCALAR not PAGAR with the overridden check still `no_cumple` + `overridden.by`; reject -> FRENAR human with `channel`.
- [ ] **Step 2: Fail**  - [ ] **Step 3: Implement**  - [ ] **Step 4: Pass**  - [ ] **Step 5: Commit** `feat: approval links with single-use tokens and re-evaluation`

### Task 10: Demo company (direct access, reset) and demo user script

**Files:**
- Create: `src/routes/demo.ts`, `scripts/seed-demo-user.mjs`
- Modify: `src/index.ts`, `scripts/preflight.sh` (WARN if the demo user is missing)
- Test: `src/routes/demo.test.ts`

**Interfaces:**
- `scripts/seed-demo-user.mjs <APP_URL>` (orchestrator runs it once after the migrations are applied and the Worker is deployed, with `SUPABASE_SERVICE_ROLE_KEY` from env; idempotent): `auth.admin.getUserByEmail(DEMO_EMAIL)` or `createUser({ email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { lang: 'es' } })`, and on every run `updateUserById` to reset the password to `DEMO_PASSWORD` (R-18); marks its company `is_demo = true`, `approver_email = HEARTBEAT_EMAIL`; then signs in as the demo user with the anon key and calls `POST <APP_URL>/api/invoices/run` so the demo company shows decisions before anyone enters. `DEMO_PASSWORD` is a public constant `andina-demo-2026` (the demo company is disposable by design, D8).
- `GET /api/demo/overview` (no auth): demo company's `invoice_current` rows and period summary, `Cache-Control: public, max-age=60`.
- `POST /api/demo/reset` (auth: must be a member of the demo company): calls `reset_demo_company()` then `runAgent('pending')`.
- The SPA's "Entrar como Andina Labs" button signs in with `signInWithPassword({ email: DEMO_EMAIL, password })` client-side (Task 16).

- [ ] **Step 1: Tests**: overview route returns only `is_demo` company rows and the cache header; reset on a non-demo member -> 403.
- [ ] **Step 2: Fail**  - [ ] **Step 3: Implement**  - [ ] **Step 4: Pass**  - [ ] **Step 5: Commit** `feat: public demo overview, demo reset, demo user script`

### Task 11: Web: Login (OTP + language) and guided tour

**Files:**
- Create: `web/pages/Login.tsx`, `web/components/Tour.tsx`, `web/tour-steps.ts`, `web/auth.tsx`
- Modify: `web/App.tsx`
- Test: `web/Tour.test.tsx` (vitest + `@testing-library/react`, jsdom)

**Interfaces:**
- `Login`: language toggle (es/en, stored in `localStorage` and after login in `auth.updateUser({ data: { lang } })`), email field -> `signInWithOtp({ email, options: { shouldCreateUser: true } })`, 6-digit code field -> `verifyOtp({ email, token, type: 'email' })`; on success, if the user has pending invoices, `POST /api/invoices/run` once, then navigate to `/`.
- `Tour`: steps `[{ selector: '[data-tour="inbox"]', title, body, route }]` from `web/tour-steps.ts` in both languages (7 steps: Bandeja, Nueva factura, Ejecutar agente, Detalle, Política, Beneficiarios, Periodo/escalado). Renders a fixed overlay that dims the page and cuts a spotlight around the target (`box-shadow: 0 0 0 9999px rgba(0,0,0,.6)` on a positioned box from `getBoundingClientRect`), a card with Atrás / Siguiente / Saltar, navigates routes between steps, scrolls the target into view. Starts when `user_metadata.tour_seen !== true`, and always for the demo user (`email === DEMO_EMAIL`, R-17); on finish or skip sets `tour_seen: true` via `auth.updateUser` (not for the demo user). "Ver tutorial" in the top bar restarts it.
- `auth.tsx`: `AuthProvider`, `useSession()`, `RequireAuth` route guard.

- [ ] **Step 1: Tests**: Tour renders step 1 title in `es`, "Siguiente" advances to step 2, "Saltar" calls `onDone`; language `en` renders English titles.
- [ ] **Step 2: Fail**  - [ ] **Step 3: Implement** (design-taste-frontend for Login)  - [ ] **Step 4: Pass; manual check on qa-server**  - [ ] **Step 5: Commit** `feat: otp login with language choice and spotlight tour`

### Task 12: Web: Bandeja and Nueva factura

**Files:**
- Create: `web/pages/Inbox.tsx`, `web/components/NewInvoice.tsx`, `web/components/OutcomeChip.tsx`
- Test: `web/Inbox.test.tsx`

**Interfaces:** list from `GET /api/invoices` with chip + headline, filters by outcome and beneficiary, "Ejecutar agente" button -> `POST /api/invoices/run` -> toast `n PAGAR · n FRENAR · n ESCALAR`; "Nueva factura" opens three tabs (Subir PDF o imagen / Pegar correo / Pegar chat) -> `POST /api/invoices`, then navigates to the new invoice's detail. All `data-tour` anchors from Task 11 present.

- [ ] **Step 1: Tests**: renders 3 rows from a mocked `api`, filter by `ESCALAR` leaves 1; "Ejecutar agente" calls the run endpoint and shows the summary.
- [ ] **Step 2-5:** Fail, implement (minimalist-ui), pass, commit `feat: inbox and new invoice`

### Task 13: Web: Detalle de decisión

**Files:** Create `web/pages/InvoiceDetail.tsx`, `web/components/ChecksTable.tsx`, `web/components/Timeline.tsx`; Test `web/InvoiceDetail.test.tsx`

**Interfaces:** from `GET /api/invoices/:id`: headline; left column document preview (signed URL for files, raw text for email/chat) and extracted fields with confidence; right column each check sentence (`explainCheck`), policy name/version/date, "Qué tendría que pasar para pagarla" list, timeline of all decisions with actor and time; when PAGAR, the payment block (beneficiary, route, currency, amount); when ESCALAR, Aprobar / Rechazar buttons -> `POST /api/invoices/:id/approve|reject`.

- [ ] **Step 1: Tests**: renders headline and 13 check rows; ESCALAR shows the two buttons; PAGAR shows the payment block.
- [ ] **Step 2-5:** Fail, implement, pass, commit `feat: decision detail with two columns and timeline`

### Task 14: Web: Política and Beneficiarios

**Files:** Create `web/pages/Policy.tsx`, `web/pages/Beneficiaries.tsx`; Test `web/Policy.test.tsx`

**Interfaces:** Company section (name, approver email, language -> `PUT /api/company`); Policy form with every `PolicyRules` key (numbers, FX table rows, allowed-only switch), "Guardar como versión n" -> `PUT /api/policy` -> banner "`n` facturas pendientes cambiarían de resultado · Reevaluar" -> `POST /api/policy/reevaluate`; version list (name, number, date). Beneficiaries table + form (name, country, currency, bank account, route select from Blinka routes, category, agreement type/amount/cap/period).

- [ ] **Step 1: Tests**: saving with `per_payment_limit_usd = 1000` posts the body and shows the would-change banner; beneficiary form submits.
- [ ] **Step 2-5:** Fail, implement, pass, commit `feat: policy editor with versions and beneficiaries directory`

### Task 15: Web: Periodo

**Files:** Create `web/pages/Period.tsx`; Test `web/Period.test.tsx`

**Interfaces:** from `GET /api/period`: budget, balance, paid, committed, available, per-beneficiary table, and three large figures: `Autonomía n %`, `Violaciones 0`, `Decisiones explicadas 100 %`. Numbers via Intl in the user's lang.

- [ ] **Step 1: Test**: renders the three figures from a mocked response.  - [ ] **Step 2-5:** commit `feat: period screen with autonomy and violations`

### Task 16: Web: Approve page and public /demo

**Files:** Create `web/pages/Approve.tsx`, `web/pages/Demo.tsx`; Test `web/Approve.test.tsx`

**Interfaces:** `/approve/:token`: GET shows the invoice summary and a single "Confirmar" button; the button does the POST; shows the resulting decision; 409 -> "Este enlace ya se usó". `/demo` (design-taste-frontend): three-line problem statement, read-only inbox of Andina Labs from `GET /api/demo/overview`, buttons "Entrar como Andina Labs" (password sign-in with `DEMO_EMAIL`, then `/`) and, when signed in as the demo user, "Reiniciar demo" -> `POST /api/demo/reset`; link to the happy-path video.

- [ ] **Step 1: Tests**: Approve renders Confirmar and only POSTs on click; Demo renders rows from overview.  - [ ] **Step 2-5:** commit `feat: approval confirmation page and public demo page`

### Task 17: Deploy, secrets, README, submission kit

**Files:** Modify `scripts/worker-secrets.sh` (add `AWS_SES_ACCESS_KEY_ID AWS_SES_SECRET_ACCESS_KEY SES_FROM_EMAIL APPROVAL_HMAC_SECRET`), `README.md`; Create `docs/SUBMISSION.md`; Modify `wrangler.toml` (ratelimit binding)

**Steps:**
- [ ] SES is already configured (16 Oct, by the launcher: IAM user `thesaurus-ses`, Supabase SMTP, Worker secrets `AWS_SES_*` and `SES_FROM_EMAIL`; R-19 is satisfied; production access was DENIED by AWS, so mail reaches verified addresses only: AC-54 needs `HEARTBEAT_EMAIL` verified, AC-55 stays SHOULD and undone). No AWS CLI in this task.
- [ ] Orchestrator: `wrangler secret put APPROVAL_HMAC_SECRET` with `openssl rand -hex 32` (never printed), `bash scripts/db-push.sh`, `wrangler deploy` from `<RUN>/integration`, `curl https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/api/health`, then `node scripts/seed-demo-user.mjs https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev`.
- [ ] README (Spanish): first 10 lines for a non-technical reader (the problem in Blinka's words, what Thesaurus does, the three outcomes, the demo URL and the demo access); then how it decides (the check list and the consequence table), how to run, how to deploy, how to connect SES/another mailer (one file), what's not done.
- [ ] `docs/SUBMISSION.md`: project name "Thesaurus", challenge "Reto Blinka: Agentes que pagan por la empresa", description for the jury (<= 5000 chars, Spanish: problem, what it does, how safety is guaranteed by design, how to try it: /demo and "Entrar como Andina Labs"), repo URL, demo URL, video URL placeholder filled by Task 18.
- [ ] Commit `docs: readme and submission kit`

### Task 18: Happy-path video and final checks

**Files:** Create `scripts/record-happy-path.mjs`, `docs/demo/happy-path.webm` (copied to `web/public/demo/happy-path.webm`); Modify `docs/SUBMISSION.md`, `README.md`

**Steps:**
- [ ] `scripts/record-happy-path.mjs`: Playwright (`/opt/pw-browsers/chromium`), `recordVideo`, against the deployed URL: open `/demo`, "Entrar como Andina Labs", tour (3 steps then Saltar), upload `web/public/demo/invoices/01.pdf`, open its detail, open the escalated `Nube Sur` invoice and approve it from the dashboard, open Política, lower `per_payment_limit_usd` to 1000, save, reevaluate, open Periodo. Saves `docs/demo/happy-path.webm`.
- [ ] Copy the video to `web/public/demo/`, redeploy (allowed in FREEZE), set the video URL `https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev/demo/happy-path.webm` in `docs/SUBMISSION.md` and README.
- [ ] QA full happy path on the deployed URL (orchestrator step 3). Commit `docs: happy path video and final submission links`.

---

## SHOULD tasks (only after every MUST task passed QA; in this order)

- **S1 CSV export**: `GET /api/period/export.csv` (one row per decision: date, invoice, beneficiary, amount, currency, USD, outcome, headline, policy version) + button on Periodo. Test: header row and one decision row.
- **S2 JEV behind flag** (D3): `src/lib/jev.ts` with `judge(env, question)` through `src/lib/llm.ts` style guard; when `JEV_ENABLED === 'true'` and the deterministic name match fails, ask "Is payee X the directory beneficiary Y?" (Noul) and when the probable-duplicate check is `cumple`, ask "Is this invoice a duplicate of Z?"; a `yes` with p >= 0.9 adds an ESCALAR trigger check `jev_<id>`; any failure or flag off = deterministic result. Tests with a fake fetch.
- **S3 Invite link**: `POST /api/invite` (demo-company members only? no: any member) -> `auth.admin.generateLink({ type: 'magiclink', email })` returned, not sent; button on the top bar.
- **S4 Scoped policies** (D18): `policies.scope jsonb` (`{ categories: [...] }`), `GET /api/policy` lists all, `runAgent` picks by beneficiary category, strictest on overlap.
- **S5 Policy JSON import/export**: download/upload the `rules` document on the Policy screen.

## Deploy points for the orchestrator
After Task 10 (first full API) and after Task 16 (full UI) deploy `<RUN>/integration` so QA can also exercise the real URL; Task 17 is the formal deploy; Task 18 redeploys with the video. Migrations are applied when Tasks 2 and 3 pass review (before their QA) and again at Task 17 (idempotent).
