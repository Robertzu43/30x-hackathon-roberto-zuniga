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
