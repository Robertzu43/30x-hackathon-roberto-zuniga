# Ledger

Every task, report, review verdict, QA verdict and ruling. Append only. Written by the orchestrator.

## Infra: first live deploy (15 Oct, harness hardening Task 9)
- URL: https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev (workers.dev certificate went live about 90 s after the first deploy).
- Throwaway Worker from branch `dryrun/deploy`: `GET /api/health` returned `{"ok":true,"rows":1}` from Supabase REST under RLS; `/` served static assets (200); unknown `/api/*` 404.
- Worker secrets set with `scripts/worker-secrets.sh`: RESEND_API_KEY, SUPABASE_POOLER_URL, SUPABASE_SERVICE_ROLE_KEY, TYPESAFE_API_KEY.
- Migrations over HTTPS proven: `20261015000000_files_bucket` applied; dry-run ping table created, read, dropped; its version rows deleted so history matches main.
- The live Worker still runs the dry-run code until the product's first deploy replaces it.

## Run start 2026-10-15 (dry run, base branch dryrun/e2e plays main)
Skills confirmed preloaded: subagent-driven-development ("The Task Loop"), finishing-a-development-branch ("Step 6: Cleanup Workspace").

Preflight output (PREFLIGHT PASSED):
- PASS Cloudflare deploy scope, KV 30x-hackathon-kv; PASS git push access; PASS Supabase anon, service_role, management API SQL, CLI link
- WARN pooler TCP unreachable (expected in sandbox); PASS Resend send; WARN RESEND_FROM is @resend.dev (relevant to Task 10 recipient)
- WARN AWS LOGIN NEEDED (no AC needs AWS; nothing parked); PASS deadline 2026-10-16T08:00Z; PASS Workers AI; PASS Playwright; PASS heartbeat email

Plan scan (table):
| Rows | Finding |
|---|---|
| T1 vs T6/T7/T8 (web/App.tsx, web/api.ts) | T1 produces placeholders, T6/T7/T8 replace them; consistent |
| T2 vs T5 (csv/format/status) | Interfaces match (parseDeliveriesCsv, canAssign, REASONS); consistent |
| T3 vs T5 (schema) | Column names match Delivery type; consistent |
| T4 vs T5 (requireRole, adminClient) | consistent; T5 test fakeDb mocks db.ts as T4 does |
| T6 vs T7 (Login, App.tsx) | T7 reuses Login from T6, so T6 before T7 (not parallel; single worktree anyway) |
| T8 vs T3 (DEMO_USERS) | T3 exports from .mjs; T8 copies literals; consistent |
| T10 vs T1 (index.ts, email.ts) | T1 says email lib only in T10; consistent. Env has RESEND_FROM |
| Each task self-consistent | T1 needs a build with web/ before dist; T6 needs VITE_ defines in vite.config.ts (T1 file) which T6 does not list: Ruling below |

Ruling: T6 may modify vite.config.ts to add the VITE_SUPABASE_* defines — the plan itself says so in its interface text but omits the file from the file list — if wrong, a trivial extra diff line.
Ruling: execute tasks sequentially (no parallel 2 and 3) — one shared working tree, small plan, avoids merge friction — costs some wall-clock only.
Ruling: GET /api/demo/summary (T8) is a public read of counts only; allowed since R-06 forbids only anonymous writes — if wrong, counts leak (no PII).

Product rulings at plan time (copied verbatim from docs/SPEC.md, AC-25):
- R-01 (phone format, completeness): PROBLEM and D5 require E.164 +57 but do not say what to do with an unparseable phone. Ruling: accept 10-digit numbers starting with 3 (mobile) or 60 (landline), optionally prefixed by `57` or `+57`, ignoring spaces, dashes, dots and parentheses; anything else is skipped as "Teléfono inválido", same treatment as a missing phone under D2. Reason: storing a number a courier cannot call is worse than listing it for Carolina to fix.
- R-02 (valor format, company-can-deploy-Monday): D5 says COP without decimals but not how brands write it. Ruling: strip `$`, spaces and `.` thousand separators; the result must be a non-negative integer, otherwise skip with "Valor inválido". A `,` decimal part (e.g. `45.000,00`) with only zeros is accepted; non-zero decimals are invalid. Reason: never guess money.
- R-03 (entregado cannot be reassigned, scope): D3 lists only `fallido` and `asignado` as reassignable. Ruling: `entregado` is final for everyone; API returns 409.
- R-04 (courier cannot change a marked delivery, conservative default): Not stated. Ruling: once `entregado` or `fallido`, the courier cannot change it; the dispatcher reopens via reassign (D3). Reason: keeps one person (Carolina) accountable for corrections; avoids silent edits to the end-of-day count.
- R-05 (meaning of "pendiente" in end-of-day counts, evidence): Scope asks for counts of entregado / fallido / pendiente, but `asignado` is also an open status. Ruling: the end-of-day `pendiente` count includes both `pendiente` and `asignado`, so the three numbers always add up to the day's total. That matches "qué quedó pendiente" in Carolina's words.
- R-06 (keeping /demo data on "today", company-can-deploy-Monday): The seed must show today's deliveries but Demo Day is days after the build. Ruling: `npm run seed` (idempotent, touches only demo accounts and their deliveries) re-dates the demo data to today's Bogotá date; it is run before Demo Day and documented in README. No public endpoint reseeds data (an anonymous write endpoint is a security hole).
- R-07 (CSV delimiter, company-can-deploy-Monday): PROBLEM says CSV but Colombian Excel exports usually use `;`. Ruling: accept `,` and `;` (detected from the header line), UTF-8 with or without BOM. Upload target date is always today's Bogotá date; no date picker on import.
- R-08 (exact seed mix, evidence): Scope says "mixed statuses" only. Ruling: 2 pendiente, 4 asignado, 4 entregado, 2 fallido (one `no estaba`, one `dirección errada`), split across both couriers, so testers can check exact numbers.
- R-09 (`otro` reason detail, scope): Scope lists four reasons with no free text. Ruling: no free-text note in this build; `otro` is stored as-is. A note field goes to `docs/IDEAS.md` if a builder wants it.
- R-10 (missing rubric, scope): CONTEXT.md has no rubric yet. Ruling: no rubric lines on ACs; MUST/SHOULD decided by company need and the CLAUDE.md demo requirements.

## Heartbeat 2026-10-15 20:28Z
done: preflight passed, plan scanned, rulings R-01..R-10 ledgered | in progress: Task 1 scaffold | blocked: none (AWS login needed but no task uses AWS) | rulings since last: 3 plan-scan rulings | next: T1 to T10 in order

## Task 1: scaffold worker + SPA + toolchain (senior-builder) — done
- Builder (1 attempt): AC-22/AC-27; app.ts/index.ts/SPA shell/styles/configs; lint, typecheck, 3 tests, build all exit 0; commit e421024; no extra deps; 500 handler added returning JSON.
- Reviewer (1 pass): PASS, no findings >= 95. QA (1 run): CONDITIONAL (scaffold only: local routes and health verified; page render and deployed URL are checked by Task 8 happy path).
- Ruling: web/api.ts, omitted from Task 1's file list, is created by Task 6 together with web/supabase.ts (it depends on it) — keeps task files consistent — costs nothing if wrong.
- Ruling: accept QA CONDITIONAL for Task 1 — remaining parts are not checkable before later tasks exist — if wrong, caught at final QA.
- Merged task/1-scaffold into integration at e421024.

## Task 2: domain logic (junior-builder)
- Skill proof (Step 0): subagent-driven-development "Rulings, not stalls"; finishing-a-development-branch "Step 5: Execute Choice". Resumed at Task 2 after container restart; preflight PASSED (AWS warn only, no AC needs AWS).
- Builder attempt 1: commit 0f24342, 39 tests. Reviewer pass 1: CHANGES (parseCOP('$45,000') -> 45, AC-10/R-02, conf 100).
- Ruling: comma + exactly 3 digits = thousands separator ('$45,000' -> 45000); comma + 1-2 digits = decimal, only if zeros — PLAN Review Focus 1 expects '$45,000' to parse and R-02 forbids guessing money — if wrong, a brand writing '45,000' meaning 45 decimal is misread (very unlikely in COP).
- Builder attempt 2 (fresh builder, report file carried): commit 2408b5f, 47 tests. Reviewer pass 2: ADDRESSED, no new findings.
- QA (1 run): CONDITIONAL, all ACs pass. Gaps: empty pedido and valor 0 accepted (no AC).
- Ruling: accept CONDITIONAL, put empty-pedido/valor-0 in docs/IDEAS.md — no AC requires rejection, R-02 allows non-negative — if wrong, a blank order number imports; fix is one line.
- Note for T5/T6: skipped[].line counts data rows from 1 (header excluded).
- Merged task/2-domain into integration; full suite green.
