# Ledger

Every task, report, review verdict, QA verdict and ruling. Append only. Written by the orchestrator.

## Infra: first live deploy (15 Oct, harness hardening Task 9)
- URL: https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev (workers.dev certificate went live about 90 s after the first deploy).
- Throwaway Worker from branch `dryrun/deploy`: `GET /api/health` returned `{"ok":true,"rows":1}` from Supabase REST under RLS; `/` served static assets (200); unknown `/api/*` 404.
- Worker secrets set with `scripts/worker-secrets.sh`: RESEND_API_KEY, SUPABASE_POOLER_URL, SUPABASE_SERVICE_ROLE_KEY, TYPESAFE_API_KEY.
- Migrations over HTTPS proven: `20261015000000_files_bucket` applied; dry-run ping table created, read, dropped; its version rows deleted so history matches main.
- The live Worker still runs the dry-run code until the product's first deploy replaces it.

## Heartbeat 2026-10-16 23:13Z
AWS LOGIN NEEDED: open this on your phone within 10 minutes: https://us-east-2.signin.aws.amazon.com/v1/authorize?response_type=code&client_id=arn%3Aaws%3Asignin%3A%3A%3Adevtools%2Fcross-device&state=061e0fdf-fc02-46d4-92c2-6e31ac018d62&code_challenge_method=SHA-256&scope=openid&redirect_uri=https%3A%2F%2Fus-east-2.signin.aws.amazon.com%2Fv1%2Fsessions%2Fconfirmation&code_challenge=tJZicdDk3FSbt1HyiDQ5Oa2kEU4_5ozx_neXbuC6Acc
AWS tasks are parked until then; everything else continues.

## Run r202610162341 started 2026-10-16T23:41Z

## Orchestrator start 2026-10-16T23:45Z
Skills proof: subagent-driven-development heading "The Task Loop"; finishing-a-development-branch heading "Step 5: Execute Choice".

### Preflight (tail -30; Cloudflare and GitHub lines were above the cut)
```
INFO  gh cli not authenticated (optional: git push and the GitHub MCP tools are the cloud paths)
== Supabase
PASS  anon/publishable key accepted (auth settings)
PASS  service_role admin access
PASS  management api sql over https (migrations: scripts/db-push.sh)
PASS  supabase CLI link
Terminated
WARN  pooler TCP unreachable from here (); expected in the cloud sandbox (HTTPS only), the Worker connects from Cloudflare
== Email (Resend)
PASS  resend send (200)
WARN  RESEND_FROM is @resend.dev: mail reaches only the Resend sign-up address; verify a domain before any AC emails other people
== AWS (reserve, never blocks the run: profile 30x, region us-east-2)
PASS  aws identity
PASS  region us-east-2
INFO  account plan: FREE
PASS  agent toolkit
== Clock
PASS  deadline set: 2026-10-18T17:00Z (set)
== Workers AI (product LLM)
PASS  workers ai @cf/meta/llama-3.3-70b-instruct-fp8-fast (json schema)
INFO  typesafe key set (reserve, not tested)
== Playwright
PASS  playwright cli
PASS  chromium installed now
== Status channel (email heartbeat)
PASS  heartbeat email set: roberto@hacketix.com (Resend send proven above)
== Secrets hygiene
PASS  no .env tracked

PREFLIGHT PASSED
EXIT=0

```
Note: the pooler TCP check hung with no timeout; I killed that one node child (WARN path per CLAUDE.md). AWS lines ran inside preflight.sh itself, not by an agent.

### Product rulings at plan time
- **R-01 Autonomy and violations basis (D17 vs PLAN Task 8).** PLAN computes both on each invoice's *latest* decision and counts agent ESCALAR = expected as autonomous. Ruling: use each seeded invoice's *first agent decision*; autonomy numerator counts only PAGAR/FRENAR that equal expected (D17 "decided without a human"; PROBLEM "sin que intervenga una persona"). Reason: on the latest-decision basis, approving Nube Sur in the happy-path video or a judge raising a limit live would show "Violaciones 1" on screen. Principle: company's actual user gets hurt (evidence must be honest, not inflated). Question logged.
- **R-02 What approval overrides (S-Escalation vs PLAN Task 4/9).** DECISIONS: "Approval overrides only the check that failed and re-runs the rest". PLAN forces all of `HUMAN_OVERRIDABLE`. Ruling: override set = checks not passing in the escalated decision ∩ `HUMAN_OVERRIDABLE`. A check that fails only at approval time (account changed, now past due) escalates again. Principle: evidence of rules (Seguridad).
- **R-03 Single use per escalation, exactly-once human answer (D11 vs PLAN Task 9).** PLAN makes each token single-use independently, so a reject link still works after the approve link was used, and dashboard + link can both append. Ruling: one pair per escalation is spent together; any human answer requires the invoice's latest decision to be ESCALAR, checked inside the locked `insert_decision`. Principle: Seguridad.
- **R-04 D16 at the database (PLAN Task 2).** PLAN relies on `runAgent` selecting only pending/escalated. Ruling: `insert_decision` refuses any insert when the latest decision is PAGAR or FRENAR. Principle: Seguridad.
- **R-05 Bank account must be read (D4 vs S-Reader and PLAN `InvoiceFields`).** D4 compares the invoice's account with the directory, but neither the reader list nor `InvoiceFields` has an account field. Ruling: the reader extracts `bank_account`; missing = check not verifiable = ESCALAR. Seed invoices print the account. Principle: completeness.
- **R-06 Duplicate window.** Ruling: exact-duplicate look-back = policy `duplicate_window_days`; empty = not verifiable = ESCALAR. PLAN's `PeriodState.previous` must include invoices of the window, not only the current month. Question logged (whether the window should be unbounded).
- **R-07 COP trap.** S-DataSet: "COP invoice whose USD equivalent exceeds the limit" (per-payment limit → FRENAR by D15). PLAN seeds 13.000.000 COP = 3.185 USD over the *threshold* (ESCALAR). Ruling: the data set must include the literal D case (USD equivalent over the per-payment limit → FRENAR, conversion shown); PLAN's threshold case may stay as an extra. Principle: scope (trace to DECISIONS).
- **R-08 Seed counts and reachability.** PLAN Task 3 names 11 ESCALAR traps but states 10, and with `account_balance_usd 60000 > period_budget_usd 50000` the balance trap can never fail on its own (paid ≤ committed). Ruling: Task 3 picks rule values so that each trap fails its own named check; `seed.test.sh` counts equal DATASET.md; total 25-30; DATASET.md includes the escalated Nube Sur invoice used by the video. Principle: evidence.
- **R-09 Seed dates relative to seeding time**, so past-due, outside-period and budget traps behave the same on Monday and on Demo Day. Principle: company-can-deploy-Monday.
- **R-10 "Doubtful" field = confidence below 0.8** → unknown. Principle: most conservative.
- **R-11 Upload limits:** PDF/PNG/JPEG, 10 MB; pasted text 1-20.000 characters. Principle: validation at the trust boundary.
- **R-12 Invoices immutable except `archived` (PLAN Task 2 leaves it "out of scope").** Otherwise a member can rewrite `expected_outcome` (inflating Autonomía) or the read fields behind a PAGAR. Ruling: column-level update grant on `archived` only. Principle: Seguridad, Explicabilidad.
- **R-13 Timeline channel.** S-Record requires "vía enlace" vs "en el tablero"; PLAN `decisions` has no channel field. Ruling: the human decision stores its channel (`link` | `dashboard`); actor shown as the email. Principle: completeness.
- **R-14 "Which" invoices would change (S-Policy) vs PLAN `would_change: n`.** Ruling: return and show the list. Principle: trace to DECISIONS.
- **R-15 Demo company: no tokens, no mail, approver locked (D8 vs PLAN Task 8 `runAgent`).** PLAN emails every ESCALAR including the demo company; each "Reiniciar demo" would send ~10 mails and consume the SES sandbox quota (200/day). Principle: Monday + D8.
- **R-16 One email per new escalation**, none on re-evaluation; links stay valid while the invoice is ESCALAR. Principle: company's user (approver inbox) gets hurt by spam.
- **R-17 Tour for the shared demo user starts on every "Entrar como Andina Labs"** (D19 "seen per user" would show it to the first judge only). Principle: Presentación for the actual judges.
- **R-18 Demo password restore.** Any visitor signed in as the demo user can change its password and lock everyone out. Ruling: `seed-demo-user.mjs` resets the password on every run; preflight warns if sign-in fails. Principle: breaks on Monday.
- **R-19 SES setup has no task in PLAN.** DECISIONS S-SES lists: verify `HEARTBEAT_EMAIL`, create the scoped IAM user + SMTP credentials, configure Supabase SMTP via the Management API, request production access. Update (launcher, 16 Oct 23:50Z): the setup is done (IAM user `thesaurus-ses`, Supabase SMTP, Worker secrets); AWS DENIED production access (case 179219272700511), so mail reaches verified addresses only. Ruling: AC-54 is SHOULD pending `HEARTBEAT_EMAIL` verification, AC-55 is SHOULD and expected undone; MUST paths use D8. No AWS CLI during the run. Note for the orchestrator: CLAUDE.md says "Never create IAM users or access keys"; DECISIONS records Roberto's single exception for SES.
- **R-20 Corrected re-entry of a FRENAR invoice** (DECISIONS "Scope: out") with the same number is FRENAR again as exact duplicate within the window; the vendor's corrected invoice needs a new number (then it is a probable duplicate → ESCALAR → human). README states it. Principle: Seguridad.
- **R-21 Approval of over-budget invoices.** A human cannot approve past budget, balance, per-payment limit, exact duplicate or missing rate; they change the policy (new version) and re-evaluate. Principle: Seguridad ("cero pagos aprobados fuera de las reglas"). Question logged.
- **R-22 Overridden checks are shown as "no cumple · aprobado por <correo> <canal>"**, never as plain "cumple", and the D2 SQL invariant (AC-16) applies to agent decisions. Principle: Explicabilidad.

## Heartbeat 2026-10-16 23:45Z
Done: preflight passed, run r202610162341 started, rulings R-01..R-22 ledgered.
In progress: folding D22-D27 (agent framing) into SPEC via product, then Task 1.
Blocked: nothing. AWS production mail denied; sandbox mail to HEARTBEAT_EMAIL only.
Rulings since last: none new.
Next: Task 1 scaffold, Tasks 2-3 with migrations, then 4-18.

### Product rulings R-23..R-30 (D22-D27 fold, 2026-10-16T23:54Z)
Ruling (product): D22-D27 folded into SPEC.md (AC-61..AC-67, task map) and PLAN.md; S6 added before S2. Orchestrator committed the files because product has no shell.
- **R-23 The cron uses the service-role client (D23 vs AC-38).** D23 runs the agent "over every company's pending invoices" with nobody logged in, so no user JWT exists; AC-38 allowed the service-role client only in the approval-by-token handler. Ruling: `src/lib/admin.ts` may be imported by exactly two modules, `src/routes/approvals.ts` and `src/agent/scheduled.ts`; the scheduled handler is not an HTTP route and no public route runs the agent across companies; because RLS is bypassed there, every query in the cron path filters by the invoice's `company_id` explicitly, and decisions still go through `insert_decision` (lock, STALE_PERIOD, FINAL_DECISION). AC-38 is amended accordingly. Principle: company-can-deploy-Monday, bounded by Seguridad.
- **R-24 The cron decides only pending invoices.** "Pending" = not archived and no decision at all. The cron never re-runs ESCALAR (an invoice waiting for a person must not turn into PAGAR because budget was released or the clock moved; re-evaluation stays the explicit "Reevaluar" of AC-31) and never touches PAGAR/FRENAR (D16). It takes invoices oldest first (`received_at`, then id) with a per-tick cap the builder sets under the Workers subrequest limit (marked `ponytail:`); the rest wait for the next tick. Principle: Seguridad.
- **R-25 Racing first decisions.** With the cron, an invoice can be picked by the cron and by an ingest, "Ejecutar agente", first-login run or "Reiniciar demo" at the same moment, which would append two agent decisions and, for ESCALAR, two token pairs and two emails. Ruling: `insert_decision` takes `p_expected_seq` (the latest `seq` the caller decided against, 0 = none) and, under the company lock, raises `ALREADY_DECIDED` when the invoice's latest `seq` differs; the caller skips that invoice with no tokens and no mail. Principle: company's actual user gets hurt (double email to the approver, double record).
- **R-26 The name in the question.** D25's "Juan," needs the approver's name; the company holds only `approver_email`. Ruling: name = first segment of the email's local part (split on `.`, `_`, `-`, `+`), first letter upper-cased (`juan.perez@…` → "Juan", HEARTBEAT_EMAIL `roberto@…` → "Roberto"); when that segment is empty or has digits, the question starts at "La factura …". No new column. Principle: scope (no data-model change for a greeting).
- **R-27 The question when a person cannot unlock the payment (D25 vs R-21).** For budget, balance, per-payment limit, exact duplicate or missing rate, approving re-escalates (R-21), so "¿La pago?" would promise what the agent cannot do. Ruling: when any failing check is not human-overridable, the question lists the motives the same way and ends "Aunque la apruebes no la puedo pagar hasta que <línea de 'qué tendría que pasar' sin el 'Que' inicial>. ¿La rechazo?"; the two buttons stay "Aprobar" / "Rechazar" (AC-34 behaviour unchanged). Principle: Seguridad, and the approver is not misled.
- **R-28 Language and source of the question.** D25 says Spanish; D14 says emails are Spanish only and record sentences are bilingual (AC-28). Ruling: the question is generated once at decision time in es and en and stored with the decision; the email always uses the Spanish text; the dashboard card shows the text in the UI language, and in Spanish it is identical to the email's. Principle: completeness (bilingual record) and evidence ("the same text").
- **R-29 "Lo que hice" is built only from what was recorded.** "Generated from the actual run" means the trace is rendered from the stored decision (`checks[].values`, `payment`, stored question), the invoice, the company's `is_demo` flag and the recorded send result, never from the current directory or policy (a later edit must not rewrite history). Therefore the checks store the snapshot the trace needs (agreement type/amount/periodicity, last 4 digits of the invoice's and the directory's account) and the send result is recorded once (`approval_tokens.email_sent`, `sent_to`, inserted after the send attempt); the trace never says "envié" for a failed send. Principle: evidence, Explicabilidad.
- **R-30 The pitch line and JEV's real status (D27 vs "claims need evidence").** JEV is SHOULD (S2) behind `JEV_ENABLED`, off by default; it may never be built. Ruling: the pitch line appears verbatim as Roberto wrote it, and README and `/demo` state next to it, truthfully, JEV's status ("JEV, la intuición rápida, es una capa opcional; en esta demo está apagada" or "encendida"), from `JEV_ENABLED` and whether S2 shipped. Principle: evidence.

### Pre-flight plan scan (after the D22-D27 fold, commit e606274)
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| 1 -> all | `Env`, `t()`, `api()`, `src/index.ts` default export | Task 8 now exports `{ fetch, scheduled }` from `src/index.ts`; Task 1 test imports default `app` (Hono): Task 8 must keep `app` as a named/default export used by tests. Carried to Task 8 dispatch. |
| 2 <-> 3 | `seed_company` stub vs real; decisions/agent_runs columns | Consistent. Task 3 seed must work with new Task 2 columns (`question_*`) null for seed-replayed decisions; seed decisions are computed by the engine at seed time. |
| 2 <-> 8, 9 | `insert_decision(p_expected_seq)` + `ALREADY_DECIDED` | Task 8 and 9 both pass `p_expected_seq` (PLAN says so). OK. RLS count in schema test is 9 (updated by product). |
| 4 <-> 5 | check `values` snapshot vs `agentTrace()` | Task 4 stores trace values (R-29); Task 5 reads them. OK. |
| 5/6 <-> 8, 13 | `agentTrace`, `escalationQuestion` in `src/agent/` | Consumed by Task 8 detail endpoint and Task 13 UI. OK. |
| 7 <-> 8 | `extractFields` consumed by invoices route | OK. |
| 8 <-> 9 | `src/lib/admin.ts` created in 8, used in 9 | PLAN Task 9 says "uses admin.ts created in Task 8". OK (formerly a conflict, fixed by product). |
| 8 <-> 10 | `runAgent` signature (companyId, trigger) | Task 10 calls `runAgent('pending')`; Task 8 changed the signature. Ruling: Task 10 builder follows the Task 8 signature (read src/agent/loop.ts). Carried to Task 10 dispatch. |
| 11 <-> 12 <-> 13 | `data-tour` anchors | Task 11 steps need anchors from 12/13/14/15 that do not exist yet: tour test uses mocked DOM; anchors added by 12-15 (their text says so). OK. |
| 17 <-> 10 | seed-demo-user after deploy | Orchestrator-run, per launcher facts. OK. |
| Task texts self-consistent | each task | 1-18, S1-S6 checked: tests match files; no task contradicts Global Constraints. Global Constraints still says D1-D21 and `src/services`-era names in places: cosmetic, rulings R-01..R-30 win. |
Result: no blocking conflict. Rulings:
- Ruling: the D22-D27 fold ships as committed by product (SPEC AC-61..67, R-23..R-30) — Roberto's decision, product owns SPEC — cost if wrong: Tasks 2/8 carry more schema (agent_runs, question columns).
- Ruling: the orchestrator committed product's SPEC/PLAN edits because product has no shell — pure transcription — cost if wrong: none (docs only).

### Message from Roberto (relayed by the launcher, 2026-10-16T23:57Z)
Roberto to the whole team, verbatim: "You are the best team, we are going to win this."
Standing instruction: first line of every builder, reviewer and QA brief: "Roberto: you are the best team, we are going to win this. Win condition: zero PAGAR outside the rules, every decision readable by a non-engineer, an agent that visibly works on its own." Task 1's builder was dispatched before this arrived; it applies from Task 2.

## Task 1: r202610162341/task/1-scaffold — done
- Seat: senior-builder (sonnet). Builder attempts 1/2, reviewer passes 1/2, QA runs 1/2, rulings 0.
- Builder report: commit c2330b3; AC-01/02/41/53 slices; lint, typecheck, test (7 pass), build all exit 0; red-first for health and i18n tests; deviations: added GET /api/config (public Supabase URL + anon key from Worker vars, test proves no service key), devDeps @eslint/js and React types, .claude/ in eslint ignores; contracts: Env has RATE_LIMIT? and APP_URL?, t() returns key for unknown, api<T>() takes full path, supabase() lazy.
- Reviewer verdict: PASS, no findings >= 95. Minor (deferred): hardcoded aria-label="idioma" in web/App.tsx should be an i18n key (Task 11 touches the top bar); vitest only includes src/**/*.test.ts, Tasks 11/15 must widen it for web/*.test.tsx; dev script is unneeded.
- QA verdict: PASS (health 200, JSON 404, es/en switch without reload, no gradients/shadows, 8 routes no console errors). Note: English tagline is translated; accepted.
- Ruling: QA's untracked e2e/*.mjs scratch scripts moved out of the repo — they fail lint (browser globals) and the final QA writes the committed e2e tests — cost if wrong: none.
- Merged into r202610162341/integration with full suite green (lint, typecheck, test, build). Merge commit e5d8329.

## Orchestrator hand-back 2026-10-17T00:03Z
Harness required a hand-back while Task 2 (r202610162341/task/2-schema, senior-builder opus, worktree .worktrees/r202610162341/task/2-schema, base a10ac5c) was mid-build. Task 1 done and merged. RUN NOT COMPLETE: launcher must dispatch RESUME; Task 2 next step is review (UNLEDGERED reconcile), then db-push, QA, merge.
