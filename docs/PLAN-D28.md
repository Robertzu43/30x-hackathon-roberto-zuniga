# Tasks D28-D35 (+ D36-D38): Thesaurus delta plan

> 17 Oct ~18:00Z: Tasks 39-51 for D39-D41 are appended at the end of this file, in the section "D39-D41". Their clock and cut order (R-126) replace the clock and the R-95 checkpoints below.
>
> For agentic workers: the orchestrator runs this with subagent-driven-development, one task per builder, in the waves below. Tasks 1-19 (docs/PLAN.md) are done and merged and keep their numbers. The ACs and rulings live in `docs/SPEC.md` (section 13d, AC-73..AC-91, AC-67 now MUST, AC-50 amended, R-85..R-95). Where this file and a ruling differ, the ruling wins. The same list is the section "Tasks D28-D35" at the end of `docs/SPEC.md`.

## Rules for every task in this plan
- TDD, then lint, typecheck, test, build and `bash scripts/tests/run.sh` green. Then a commit on `r202610162341/task/<n>-<slug>` and a 5-line report. Builders never deploy or db-push.
- Tests never call Bedrock, Workers AI, Yahoo or open.er-api.com: fakes and recorded fixtures only (R-94). Each task says what QA checks live and when.
- **D38 gate (AC-91, R-93).** Every task that changes a screen ends by running `npm run ux:gate -- --screens <its screens> --base <qa-server URL>` (after Task 27 exists) and attaching `docs/ux/gate-*.md` to its report. After the code reviewer, the orchestrator dispatches a fresh UX reviewer (a `reviewer` seat briefed with `design-taste-frontend` and `minimalist-ui`, never the builder). It reads only the screenshots, the gate table and the axe and console output. A failed item blocks the merge, whatever its confidence. The task gets 2 UX passes. A screen that fails twice goes to product to simplify it.
- New UI or record strings go in a new `src/i18n/features/<feature>.ts`, in es and en. The one-line registration in `src/i18n/es.ts` / `en.ts` is a declared shared edit.
- Migration numbers are fixed: `20261017000600_fx_rates.sql` (Task 21), `20261017000700_ai_usage.sql` (Task 23), `20261017000800_portal.sql` (Task 25). All additive, RLS on, no drop, delete or truncate (AC-07).
- Clock: deadline 2026-10-18T17:00Z, FREEZE 2026-10-18T11:00Z. The R-95 checkpoints are 2026-10-18T00:00Z (AC-81 becomes SHOULD if any of 20-26 is unmerged) and 02:00Z (AC-78 becomes SHOULD if 33 and 34 have not started). The cut order is AC-88 (already SHOULD), then AC-81, then AC-78. Never cut D28, D29(a)(b), D34, D36, the D38 gate or the video.

## Tasks

**Task 20: Bedrock Nova Lite primary, Workers AI fallback (D36).** Seat: senior-builder.
- ACs: AC-89; AC-12, AC-13 and AC-39 Clarified; AC-67 (`answerQuestion`); AC-77 (provider recorded at read).
- Files: `src/lib/llm.ts`, `src/lib/llm.test.ts`, `src/prompts/extract.ts` (keep the payee rule), `src/prompts/ask.ts` (new: the grounded-answer prompt for AC-67), `src/env.ts`, `wrangler.toml` (`BEDROCK_MODEL_ID`, `BEDROCK_REGION` vars), `src/lib/__fixtures__/bedrock-*.json`.
- Exports for later tasks:
  - `extractFields` and `documentToText` keep their signatures and add `read_by: { provider: string }` to the fields.
  - `answerQuestion(env, context: string, question: string, lang): Promise<{ answer: string } | { reason: 'ai_quota' | 'failed' }>`.
- Dependencies: none. Run first.
- Parallel: yes with 21, 22, 25, 26 and 27. Shared files: `wrangler.toml` and `src/env.ts` (merge first; 21, 25 and 30 rebase onto it). It is the only owner of `llm.ts` and `src/prompts/*`; nobody else edits them in this plan.
- Now (mocks): every AC-89 test. Live right after the deploy: 2 Bedrock reads (an email paste and `03.png`). After 00:00Z: one fallback read on the qa-server (R-94).
- Deploy point D1: merge, then deploy the main Worker. The Bedrock secrets are already set.
- Estimate: 2.5 h.

**Task 21: Market FX backend (D28).** Seat: senior-builder.
- ACs: AC-73, AC-74, AC-75; AC-18, AC-22 and AC-30 Clarified; AC-38 (`fx_rates` writer); AC-68 Clarified; AC-10.
- Files:
  - `supabase/migrations/20261017000600_fx_rates.sql`: the table; `create or replace` of `seed_company` and `reset_demo_company` with `fx_rates: {}` and any adjusted amounts.
  - `src/lib/fx.ts` and its test, with recorded JSON fixtures of both endpoints.
  - `src/engine/{types,checks,decide,explain}.ts` and their tests; `src/engine/__fixtures__/seed.ts` (fixture rates dated 17 Oct).
  - `src/agent/{loop,tools,scheduled,record,question}.ts` and their tests.
  - `src/routes/approvals.ts`, `src/routes/policy.ts` (preview on stored rates), `src/routes/fx.ts` (new, `GET /api/fx`), `src/index.ts` (mount).
  - `wrangler.toml` (crons `["*/5 * * * *", "0 11 * * *"]`, `FX_PROVIDER = "yahoo"`), `src/env.ts`.
  - `src/i18n/features/fx.ts`.
  - `docs/demo/DATASET.md`, `scripts/gen-invoices.mjs` and `web/public/demo/invoices/*`, only if amounts change.
  - `scripts/tests/schema.test.sh`, `seed.test.sh`.
- Dependencies: none (rebase onto 20 for `wrangler.toml` and `env.ts`).
- Parallel: yes with 20, 22, 25, 26 and 27. Shared files:
  - `wrangler.toml`, `src/env.ts`, `src/index.ts`: merge order 20 → 21 → 23 → 25 → 30.
  - `src/agent/record.ts` and `src/agent/loop.ts`: additive exports; merge 21 before 23 and 25, which rebase.
  - `src/agent/trace.ts`: 21 before 25.
  - It is the only owner of `src/engine/*` and the seed.
- Now (no AI involved): everything, including live Yahoo after the deploy.
- Deploy point D2: `bash scripts/db-push.sh` (000600), deploy the main Worker, `GET /api/fx` live, "Reiniciar demo", then check Periodo «Violaciones 0» and the R-35 sequence on market rates.
- Estimate: 4 h.

**Task 22: FX on Política (D28).** Seat: junior-builder.
- ACs: AC-76, AC-30 Clarified, AC-91 (gate on `policy`).
- Files: `web/pages/Policy.tsx`, `web/Policy.test.tsx`, `src/i18n/features/policy.ts`.
- Dependencies: the `GET /api/fx` contract in AC-76 (mock it). Merge after 21. QA needs 21 deployed.
- Parallel: yes, with no shared file. The gate runs once Task 27 is merged.
- Now: mocked API. Live after D2: no AI needed.
- Estimate: 1.5 h.

**Task 23: "Pregúntale a Thesaurus" backend + reading provenance (D29 a, b).** Seat: senior-builder.
- ACs: AC-67 (route, caps, messages, quota writer), AC-77 (`src/lib/snippet.ts`, `raw_text` for files, `reading` in `GET /api/invoices/:id`), AC-38, AC-68 Clarified.
- Files: `supabase/migrations/20261017000700_ai_usage.sql`, `src/routes/ask.ts` and its test, `src/lib/snippet.ts` and its test, `src/routes/invoices.ts` and `routes.test.ts`, `src/agent/record.ts` (quota export), `src/index.ts` (mount), `src/i18n/features/ask.ts`, `scripts/tests/schema.test.sh`.
- Dependencies: Task 20 merged (`answerQuestion`, `read_by`).
- Parallel: yes with 22, 24, 25 and 26. Shared files: `record.ts` and `src/index.ts` (after 21, before 25). It is the only owner of `src/routes/invoices.ts`.
- Now: the fake provider. Live after D4: at most 5 questions (R-94).
- Deploy point D4: db-push 000700, then deploy.
- Estimate: 3 h.

**Task 24: AI on screen: the chat, «Leído por IA», where AI acts and where code decides (D29 a, b, d).** Seat: senior-builder.
- ACs: AC-67 (web), AC-77 (web), AC-79, AC-66, AC-91 (gate on `inbox`, `detail-*`, `ask`, `demo`, `tour`).
- Files: `web/components/AskThesaurus.tsx` and `web/AskThesaurus.test.tsx`, `web/components/ReadingPanel.tsx`, `web/pages/InvoiceDetail.tsx`, `web/pages/Inbox.tsx` (the ask box only), `web/pages/Demo.tsx` (the AI/code block), `web/tour-steps.ts`, `src/i18n/features/{detail,inbox,demo,ask}.ts`, web tests.
- Dependencies: the contracts in AC-67 and AC-77, so it can start at once on mocks. Merge after 23 and 26.
- Parallel: yes with 20-23 and 25. Shared files: `Demo.tsx` with 26 (26 merges first); `Inbox.tsx` and `InvoiceDetail.tsx` with 29 (24 merges first; 29 starts after).
- Now: a mocked API. Live after D4: the chat and the reading panel on 23's deployed API.
- Deploy point D6.
- Estimate: 3.5 h.

**Task 25: Vendor portal (D34).** Seat: senior-builder.
- ACs: AC-83, AC-84, AC-85, AC-86 (API `GET /api/portal-link`, trace step 1 by channel, slug), AC-90; AC-07, AC-38, AC-63 and AC-68 Clarified; AC-91 (gate on the vendor screens).
- Files:
  - `supabase/migrations/20261017000800_portal.sql`: `invoices.origin`, `sender`, `sender_note` with insert forcing; `companies.portal_slug` with a random default and no member update; `portal_status_tokens`; `intake_rate_limits` and its function; `agent_runs.via`.
  - `src/agent/intake.ts` and its test; `src/portal-api.ts` (`PortalApi` WorkerEntrypoint) and its test; `src/routes/portal-link.ts`.
  - `src/agent/record.ts` (run `via`), `src/agent/loop.ts` (origin/via passthrough), `src/agent/trace.ts` and its test.
  - `src/index.ts` (export `PortalApi`, mount), `src/env.ts`, `wrangler.toml` (`PORTAL_URL`).
  - `portal/wrangler.toml`, `portal/src/index.ts` and its test, `portal/public/{index.html,app.js,styles.css,brand/*}`.
  - `scripts/seed-demo-user.mjs` (slug `andina-labs`), `src/i18n/features/portal.ts`, `vitest.config.ts`, `tsconfig.json` and `eslint.config.js` (include `portal/`), `scripts/tests/schema.test.sh`.
- Dependencies: none to start. Before review, rebase onto 20, 21 and 23, and onto 26 for the logo files (until then ship a text wordmark).
- Parallel: yes with 20-24 and 26. Shared files: `record.ts`, `loop.ts`, `trace.ts`, `src/index.ts`, `wrangler.toml`, `env.ts` (merge after 21 and 23); the config files with 27 (trivial). It does not edit `src/routes/invoices.ts` or `llm.ts`; `intake.ts` calls `documentToText`, `extractFields` and `runAgent`.
- Now: the fake binding, db and provider, plus every abuse case. Live after D5: QA on the deployed portal with 1 Bedrock read and every abuse case (no AI needed).
- Deploy point D5: db-push 000800; deploy the main Worker first; then `npx wrangler deploy -c portal/wrangler.toml`; then `node scripts/seed-demo-user.mjs <URL>`.
- Estimate: 5 h.

**Task 26: Logo and brand (D30, D37).** Seat: junior-builder.
- ACs: AC-80, AC-91 (logo item).
- Files: `web/public/brand/{thesaurus-mark.svg,thesaurus-logo.svg,thesaurus-logo.png}`, `web/public/favicon.svg`, `index.html` (favicon link), `web/components/Logo.tsx`, `web/App.tsx` (top bar), `web/pages/Login.tsx`, `web/pages/Demo.tsx` (header only), `web/pages/Approve.tsx` (header), the escalation email template (`escalationEmail`, wherever it lives today) and `src/lib/email.test.ts`, `web/styles.css` (logo sizing only, no new colours).
- Dependencies: none.
- Parallel: yes. Shared files: `Demo.tsx` (merge before 24), `styles.css` (before 31 and 32). Task 25 copies the brand files into `portal/public/brand/` after this merges.
- Now: everything. Run the gate once 27 exists.
- Deploy point D3.
- Estimate: 2 h.

**Task 27: UX gate harness (D38).** Seat: junior-builder.
- ACs: AC-91 (the measuring script).
- Files: `scripts/ux-gate.mjs` (Playwright with `/opt/pw-browsers/chromium`; 5 widths × es/en; screenshots to `docs/ux/<screen>-<width>-<lang>.png`; axe-core; console capture; scroll, overflow, overlap and clip checks; 44 px targets; 16 px inputs; `lang`; busy within 100 ms; CLS; long tasks; first usable view; forced empty, error and offline states; dev-word and other-language-string scans; `--palette` colour audit against `web/styles.css` at 6d34830), `scripts/ux-gate.test.mjs` with a fixture page that has one known violation per item, `package.json` (`ux:gate` script, `axe-core` devDependency), `docs/ux/README.md` (the checklist, verbatim from D38).
- Dependencies: none. Highest priority junior task, because every UI task ends with it.
- Parallel: yes. Shared files: `package.json` with 30 (27 merges first).
- Now: everything. No AI.
- Estimate: 2.5 h.

**Task 28: D31 UX QA pass.** Seat: qa.
- ACs: AC-82.
- Files written: `docs/UX-QA.md`, plus screenshots under `docs/ux/qa/`.
- Dependencies: 27 merged. Run 1 starts at once on the deployed product (finance screens). Run 2, after 24, 25 and 29 are deployed, adds the new screens and the vendor experience, and re-verifies 31's fixes.
- Parallel: yes (read-only).
- Now: the reader-unavailable states are reachable on the qa-server with the bad-model vars.
- Estimate: 1.5 h per run.

**Task 29: Bandeja: portal card, origin labels, activity panel (D34, D29 c).** Seat: junior-builder.
- ACs: AC-86 (web), AC-78, AC-91 (gate on `inbox`).
- Files: `web/components/PortalLinkCard.tsx`, `web/components/AgentActivity.tsx` and `web/AgentActivity.test.tsx`, `web/pages/Inbox.tsx`, `web/pages/InvoiceDetail.tsx` (origin label), `src/routes/agent.ts` (`GET /api/agent/activity`) and `routes.test.ts`, `src/i18n/features/{inbox,activity}.ts`.
- Dependencies: 24 and 25 merged.
- Parallel: yes with 30, 31 and 35. It shares no file with them.
- Do the AC-86 part first. R-95 checkpoint 2 may drop the activity part.
- Now: mocks. Live: the cron decision playing in the panel on the deployed URL (no AI needed for REST inserts that carry fields).
- Deploy point D6.
- Estimate: 3 h.

**Task 30: Email intake (D35).** Seat: senior-builder.
- ACs: AC-87 (AC-88 stays SHOULD).
- Files: `src/email/inbound.ts` and its test, `src/email/reply.ts` (vendor reply template with the logo), `src/email/__fixtures__/*.eml` (the 10 fixtures of AC-87), `src/index.ts` (export `email`), `src/env.ts` and `wrangler.toml` (`INBOUND_EMAIL_DOMAIN = ""`), `src/routes/portal-link.ts` (fill `email_address` when the var is set), `package.json` (`postal-mime`).
- Dependencies: 25 merged (`intake.ts`).
- Parallel: yes with 29, 31 and 35. Shared files: `src/index.ts`, `wrangler.toml`, `env.ts` (last in the merge order), `package.json` (after 27).
- Now: `.eml` fixtures only. Live: only when Roberto adds a domain (AC-88).
- Deploy point D6 (the handler is inert without a domain).
- Estimate: 3 h.

**Task 31: UX fixes A.** Seat: junior-builder.
- ACs: AC-82, AC-91.
- Files: only screens no open task owns when it is dispatched. Today that is `web/pages/Period.tsx`, `web/pages/Beneficiaries.tsx`, `web/components/{ChecksTable,Timeline,RunProgress,NewInvoice,OutcomeChip}.tsx` and their tests, and `web/styles.css` after 26 merged. The orchestrator names the exact list in the brief.
- Dependencies: run 1 of 28.
- Parallel: yes with 29 and 30. Never at the same time as 32.
- Gate: yes, on its screens.
- Estimate: 2.5 h.

**Task 32: UX fixes B + taste refinement (D31, D37, D30).** Seat: senior-builder.
- ACs: AC-82 (every open `UX-nn`), AC-91, AC-81 (refine, never restyle; R-95 checkpoint 1 may cut this part).
- Files: any `web/` or `portal/public/` file, `src/i18n/features/*`, and `docs/UX-QA.md` (status column). No backend.
- Dependencies: 22, 24, 25, 26, 29 and 31 merged; run 2 of 28.
- Parallel: with 35 only.
- Gate: yes, on every screen it touched.
- Deploy point D7.
- Estimate: 3 h.

**Task 33: UX gate: the finance user experience (D37 (1), D38).** Seat: reviewer (a fresh UX reviewer) running the gate on the deployed URL.
- ACs: AC-91, AC-82, AC-53.
- Output: `docs/ux/gate-finance.md`, screenshots, and a verdict. Every failed item becomes a fix brief for a senior-builder on the same task, within the 2-round rule.
- Dependencies: D7.
- Parallel: with 34.
- Estimate: 1.5 h, plus fixes.

**Task 34: UX gate: the vendor portal experience (D37 (2), D38).** Seat: reviewer (a fresh UX reviewer).
- ACs: AC-91, AC-90 (including QA's timed run under 60 s), AC-82.
- Output: `docs/ux/gate-vendor.md`.
- Dependencies: D7.
- Parallel: with 33.
- Estimate: 1 h, plus fixes.

**Task 35: README + SUBMISSION delta.** Seat: junior-builder.
- ACs: AC-49 and AC-51 Clarified; AC-76, AC-79 and AC-87 (README parts); AC-13 Clarified (README item 10).
- Files: `README.md`, `docs/SUBMISSION.md` (description at most 5000 characters).
- Dependencies: 20, 21, 23, 25 and 30 merged.
- Parallel: yes with 31 and 32 (no shared file). Allowed in FREEZE.
- Estimate: 1.5 h.

**Task 36: Final delta review.** Seat: reviewer, over the whole branch since 6d34830.
- ACs: every AC of section 13d, plus AC-16 and AC-38 (greps) and AC-68.
- Dependencies: 33, 34 and 35 done.
- Estimate: 1 h, plus a fix task if needed.

**Task 37: Happy-path video (D32).** Seat: senior-builder.
- ACs: AC-50 Amended.
- Files: `scripts/record-happy-path.mjs` (captions injected; the step sequence of AC-50; ffmpeg cut and speed when `which ffmpeg` succeeds), `web/public/demo/happy-path.webm` (or `.mp4`), `docs/demo/`. The video URL goes into `docs/SUBMISSION.md`.
- Dependencies: after 2026-10-18T00:00Z; Task 36 passed; "Reiniciar demo" just before. At most 3 takes (R-94).
- Deploy point D8: redeploy with the video.
- Estimate: 2 h.

**Task 38: QA happy path + merge to main.** Seats: qa, then the orchestrator.
- ACs: AC-50, AC-48, AC-01, AC-16 (R-83 queries), AC-75 (live seed check).
- Dependencies: D8. The orchestrator then merges `r202610162341/integration` into `main` (full suite green and QA happy path passed) and writes `RUN COMPLETE` at the end.
- Estimate: 1.5 h.

## Waves (what can run at the same time)
- **Wave 1, now:** 20, 21, 25 (senior); 26, 27, 22 (junior); 24 (senior) if a fourth senior seat is free, otherwise first in wave 2.
- **Wave 2:** 23, after 20 merges; 28 run 1, after 27 merges; 24, if not yet started.
- **Wave 3:** 29, after 24 and 25 merge; 30, after 25; 31, after 28 run 1.
- **Wave 4:** 28 run 2; 32, after it; 35 in parallel with 32.
- **Wave 5:** 33 and 34 in parallel, on the deployed URL after D7.
- **Wave 6:** 36; 37 (after 00:00Z); 38; merge to main before FREEZE 11:00Z.

## Shared-file conflicts (merge in the order shown; the later task rebases before review)
| File | Tasks, in merge order |
|---|---|
| `wrangler.toml`, `src/env.ts` | 20 → 21 → 25 → 30 |
| `src/index.ts` | 21 → 23 → 25 → 30 |
| `src/agent/record.ts`, `src/agent/loop.ts` | 21 → 23 → 25 (additive exports only) |
| `src/agent/trace.ts`, `src/agent/question.ts` | 21 → 25 |
| `src/lib/llm.ts`, `src/prompts/*` | 20 only |
| `src/engine/*`, seed migration, DATASET.md, `/demo/invoices` | 21 only |
| `src/routes/invoices.ts` | 23 only |
| `src/routes/portal-link.ts` | 25 → 30 |
| `web/pages/Demo.tsx` | 26 → 24 → 32 |
| `web/pages/Inbox.tsx`, `web/pages/InvoiceDetail.tsx` | 24 → 29 → 32 |
| `web/pages/Policy.tsx` | 22 → 32 |
| `web/App.tsx`, `web/pages/Login.tsx`, `index.html` | 26 → 32 |
| `web/styles.css` | 26 → 31 → 32 (31 and 32 never in parallel) |
| `package.json` | 27 → 30 |
| `vitest.config.ts`, `tsconfig.json`, `eslint.config.js` | 27 → 25 |
| `src/i18n/es.ts`, `en.ts` | registration lines only, any order |
| migrations | 21: 000600, 23: 000700, 25: 000800 |
| `README.md`, `docs/SUBMISSION.md` | 35 only (37 sets the video URL) |

## Deploy points (the orchestrator only, from integration, after a green full suite)
- D1 (20): deploy; 2 live Bedrock reads.
- D2 (21): db-push 000600, deploy, `GET /api/fx`, "Reiniciar demo", Violaciones 0.
- D3 (22, 26): deploy.
- D4 (23): db-push 000700, deploy; at most 5 live questions.
- D5 (25): db-push 000800, deploy main, deploy `portal/`, run `seed-demo-user.mjs`.
- D6 (24, 29, 30, 31): deploy.
- D7 (32): deploy; gates 33 and 34 run here.
- D8 (37): deploy with the video. Then 38 and the merge to main.

## Clock (target, UTC)
- 17 Oct 13:30: wave 1.
- ~17:00: 20, 21, 26, 27 and 22 merged.
- ~19:00: 23, 24 and 25 merged.
- ~22:00: 29, 30 and 31 merged.
- 18 Oct ~01:00: 32 merged (R-95 checkpoint 1 at 00:00).
- ~02:30: 33 and 34 pass (checkpoint 2 at 02:00).
- ~03:30: 36.
- ~05:30: 37.
- ~07:30: 38 and merge to main.

That leaves 3.5 h of buffer to FREEZE at 11:00. Nothing is cut at plan time beyond AC-88 (SHOULD by nature, Roberto's domain step).

---

# D39-D41: Tasks 39-51 (product, 17 Oct ~18:00Z)

> These tasks fold Roberto's D39 (richer UI), D40 (speed) and D41 (jury access). The ACs are AC-92..AC-106 in `docs/SPEC.md` section 13e, the rulings are R-115..R-126, and Q15-Q19 are in `docs/QUESTIONS.md`. Where this section and a ruling differ, the ruling wins. This section replaces the clock and checkpoints above; R-126 replaces R-95's checkpoints.

## Binding order and rules
- The order is D41 → D40 → D39 (R-126):
  - D41 is the jury's door and is never cut. Every free builder seat serves it first.
  - D40's targets are never cut, because a miss is a blocking D38 finding.
  - D39 is MUST but cuttable, in the order below.
- Every rule from the top of this file still holds:
  - TDD, then the full suite and `bash scripts/tests/run.sh` green.
  - Tests never call a real model, FX source or Supabase Auth.
  - The D38 gate and a fresh UX reviewer on every screen a task touches (AC-91).
  - Builders never deploy, run db-push or change Auth config.
  - Branches are `r202610162341/task/<n>-<slug>`.
- Migrations, numbers fixed now (AC-07 Clarified):
  - `20261017000900_trial_access.sql` (Task 39);
  - `20261017001000_screen_functions.sql` (Task 42);
  - `20261017001100_dashboard_functions.sql` (Task 45).
  All are additive, with no drop, delete or truncate, and nothing touches `auth.users` beyond the existing trigger. Anonymous users are real Auth users and are never deleted.
- Guardrails that do not move: AC-07, AC-16 and AC-69 (no model writes PAGAR), AC-38 (one writer), AC-68.
- Sequencing with the tasks in flight (R-125):
  - Task 32a owns `web/**` except `Demo.tsx`, `Login.tsx` and `portal/**`. Task 32b owns those three. Both merge first and are not cancelled.
  - Every task below starts at once in new files only. Edits to files 32a or 32b own wait for their merge, then go in as a small final mount commit after a rebase.
  - A 32a item still open at its merge goes to the D39 task that owns that page.
- Seat priority when seats are short:
  - Seniors: 39, then 40, then 42, then 43, then 45, then 47, then 48.
  - Juniors: 44, then 46, then 41, then 49, then 50, then 51, then 35b.

## Tasks

**Task 39: D41 backend: trial workspace, guest identity, no mail, ingest cap, Auth config (AC-92..AC-96 backend).** Seat: senior-builder, first priority, now.
- Files:
  - `supabase/migrations/20261017000900_trial_access.sql`:
    - `companies.is_trial boolean not null default false`, kept out of the member update grant;
    - `create sequence trial_company_seq`;
    - `create or replace function handle_new_user()`. When `new.is_anonymous`, the company is «Empresa de prueba <n>», `is_trial = true` and `approver_email` null. Otherwise the behaviour is unchanged. It is the same seed for both.
  - `scripts/auth-config.sh`:
    - with no flag, it PATCHes the Auth config over the Management API: `external_anonymous_users_enabled true`, `rate_limit_anonymous_users 30`, `mailer_autoconfirm true`, `password_min_length 8`, and `sessions_timebox` and `sessions_inactivity_timeout` 0;
    - `--check` prints those keys only, never a secret.
  - `src/lib/auth.ts`: expose `is_anonymous` and the user id on the request.
  - `src/routes/approvals.ts`: the guest identity `invitado:<8 hex>` (R-116).
  - `src/agent/loop.ts`: no `notify` and no tokens when `is_trial` (R-115).
  - `src/agent/trace.ts` and its test: the trial step 5 and the guest name, es and en.
  - `src/routes/invoices.ts` (POST only): the trial ingest cap through the existing quota function, key `ingest:<user id>`, 30 per UTC day, 429 text (AC-96).
  - `src/routes/policy.ts`: 403 on `approver_email` for a trial company.
  - `src/i18n/features/trial-record.ts`.
  - `scripts/tests/schema.test.sh`: the trigger, the grant, and no `deleteUser` or `delete from auth.users` anywhere.
  - Route and agent tests.
- The live probe (AC-95, R-118). The builder writes `scripts/probe-save-access.mjs`. The orchestrator runs it once after E1 on a throwaway anonymous user: `signInAnonymously`, then `updateUser({ email: 'qa-probe-<random>@example.com', password })`, then it reports `email_confirmed_at` and `is_anonymous`. If the email is not confirmed at once, Task 39b adds `POST /api/account/save` (the Admin API on the caller's own id only, only while `is_anonymous`, with tests) before Task 41 merges.
- Dependencies: none.
- Merge order: first on `auth.ts`, `invoices.ts` and `policy.ts`. Tasks 42 and 45 rebase onto it.
- Deploy E1, by the orchestrator:
  1. `bash scripts/db-push.sh` (000900).
  2. `bash scripts/auth-config.sh`, then `--check`.
  3. Deploy the main Worker.
  4. The probe.
  5. One anonymous sign-in by curl: the company row is «Empresa de prueba <n>», with 8 beneficiaries.
- Estimate: 2.5 h.

**Task 40: D41 door (web) (AC-92, AC-93 web, AC-94, AC-40 and AC-45 Clarified).** Seat: senior-builder, second priority.
- New files, started now:
  - `web/trial.ts`: `startTrial`; `isTrial`; `guardLeave`, the one guard every leaving action calls.
  - `web/components/TrialButton.tsx`: the door, plus «Volver a mi empresa de prueba».
  - `web/components/LeaveTrialWarning.tsx`.
  - `web/Trial.test.tsx`.
  - `src/i18n/features/trial.ts`.
- Mount commit, after 32b and 32a merge:
  - `web/pages/Login.tsx` and `web/pages/Demo.tsx`: the door becomes the one primary, and «Enviar código» and «Entrar como Andina Labs» become secondary.
  - `web/App.tsx`: the top bar shows the company name, «Acceso sin guardar» and «Guardar mi acceso» (the button opens Task 41's dialog; until 41 merges it is hidden behind `false`). The sign-out guard goes here too.
  - `web/auth.tsx`: the anonymous session.
  - `web/pages/Policy.tsx`: one line, the read-only approver field for a trial company.
- The first run reuses the first-login call loop (R-120), then Bandeja and the tour.
- Gate: `login`, `demo`, `trial`, `leave-trial`, and `inbox` as a trial user at 360 and 1440, es and en (screen ids from Task 44).
- Dependencies: the mounts wait for 32a and 32b. It merges after 39, which provides the guest approval, no mail and the trial name.
- Deploy E2: the door is live, target 21:30Z. Right after it, a QA run on AC-92, AC-93 and AC-94 (at most 2 live reads and 1 question).
- Estimate: 2.5 h.

**Task 41: «Guardar mi acceso» + «Entrar con contraseña» (AC-95).** Seat: junior-builder.
- Files:
  - `web/components/SaveAccess.tsx`;
  - `web/SaveAccess.test.tsx`;
  - `src/i18n/features/account.ts`;
  - the mount: the password form on `web/pages/Login.tsx` (secondary «Entrar con contraseña») and the button wiring in `web/App.tsx`.
- It calls `supabase.auth.updateUser`, or `POST /api/account/save` if 39b exists.
- Dependencies:
  - new files now;
  - the mount after Task 40 merges;
  - the probe result from E1 decides which call is used.
- Gate: `save-access` (success and errors) and `login-password`.
- Deploy E3.
- Estimate: 1.5 h.

**Task 42: D40 backend: one round trip per screen (AC-98, AC-99 placement).** Seat: senior-builder, third priority.
- Files:
  - `supabase/migrations/20261017001000_screen_functions.sql`:
    - `screen_inbox(p_lang)`, `screen_period()`, `screen_beneficiaries()`, `screen_policy()`, `screen_detail(p_id)` and `screen_demo_overview()`;
    - each is `security invoker`, `stable` and read-only, takes the company from `auth.uid()`, returns `jsonb`, and has execute revoked from `anon` and `public`;
    - the numbers equal today's endpoints'.
  - `src/routes/screen.ts` (new: `/api/screen/inbox|period|beneficiaries|policy`).
  - `src/routes/invoices.ts` (GET `/:id` collapsed into one RPC).
  - `src/routes/demo.ts` (one function, and the Workers Cache API for 60 s).
  - `src/lib/auth.ts`: local JWT verification by JWKS, or by `SUPABASE_JWT_SECRET` if the orchestrator has it to `wrangler secret put`. Otherwise it keeps `/auth/v1/user` and states so in the report.
  - `src/index.ts` (mount).
  - `wrangler.toml` (`[placement] mode = "smart"`) and `src/env.ts`.
  - `scripts/tests/schema.test.sh` (security invoker, no anon execute).
  - Route tests that count db calls.
- Dependencies: none to start. It rebases onto 39 before review.
- Merge order: 39 → 42 → 45 on `invoices.ts`, `auth.ts` and the screen functions.
- Deploy E3: db-push 001000, then deploy. Then Task 44 runs the API part of `perf.mjs`.
- Estimate: 3 h.

**Task 43: D40 web: delivery (AC-99, AC-100, AC-97 web).** Seat: senior-builder, fourth priority.
- Files:
  - `web/main.tsx`;
  - `web/App.tsx` (lazy route per page, plus a placeholder route `/beneficiaries/:id` for Task 50);
  - `web/api.ts` (screen loaders, per-tab cache, prefetch on hover and focus);
  - `vite.config.ts` (chunks);
  - the loader lines and skeletons of every page (`web/pages/*.tsx`), switched to `/api/screen/*`;
  - the approve and reject pending state in `web/pages/InvoiceDetail.tsx`. It shows no outcome until the server answers (R-122);
  - `public/_headers`, or the Worker's asset headers, for immutable hashed assets.
- Dependencies: it starts after 32a merges, on mocks of AC-98's contract. It merges after 42 (real endpoints) and after 40 and 41 (`App.tsx`, `Login.tsx`).
- Every D39 page task mounts after this merges.
- Gate: every page, for CLS and skeletons.
- Deploy E4.
- Estimate: 2.5 h.

**Task 44: Perf harness and the measured table (AC-97, AC-91 Clarified).** Seat: junior-builder, first junior priority, now.
- Files:
  - `scripts/perf.mjs` and `scripts/perf.test.mjs` (median, p95 and gz sum on fixtures);
  - `docs/perf.md`;
  - `package.json` (`perf` script);
  - `scripts/ux-gate.mjs`: the new screen ids `trial`, `login-password`, `save-access`, `leave-trial`, `beneficiary` and `beneficiary-empty`, with one anonymous session per gate run.
- Runs:
  - The baseline at once on the deployed URL, with the 17:40Z numbers as row 0.
  - Again after E3 (the API part).
  - The final table at checkpoint C (E6), committed before the video.
  - The trial row needs E2.
- Estimate: 1.5 h, plus 0.5 h per run.

**Task 44b: Perf harness follow-up (AC-97 Clarified, R-140).** Seat: junior-builder, next free junior seat, before the post-E3 perf run.
- Files: `scripts/perf.mjs`, `scripts/perf.test.mjs`, `docs/perf.md` (regenerated by the run, not edited by hand).
- What:
  - Add the row `demo overview (cache miss)`. It takes the median of 3 requests to `/api/demo/overview`, waiting more than 60 s between samples. Each sample's cache header (`cf-cache-status`, or the Worker's own cache header) must not be `HIT`; a sample that is `HIT` is retried after a further wait. The status is `INFO`, never PASS or FAIL, and the all-PASS check skips INFO rows.
  - The `login` row counts the page as usable when the heading and the one primary action («Probar con mi propia empresa») are visible and enabled, the same definition as AC-91 item 7. The E2 "not usable in 15 s" artifact must not recur when the door is usable by hand.
- Tests: on fixtures, the miss median, INFO excluded from the all-PASS verdict, a `HIT` sample rejected, and the login readiness selector matching the door button.
- Then the orchestrator runs `node scripts/perf.mjs --base <deployed URL>` after the next deploy and commits `docs/perf.md` (R-140's re-measure list).
- Estimate: 0.75 h.

**Task 45: D39 data (AC-101..AC-104 contracts, AC-102 `doc_marks`, AC-106).** Seat: senior-builder, fifth priority.
- Files:
  - `supabase/migrations/20261017001100_dashboard_functions.sql`:
    - new `dash_inbox()`, `dash_period()` and `screen_beneficiary(p_id)`, all `security invoker` with R-124's definitions;
    - `create or replace` of `screen_inbox` and `screen_period`, embedding those as `dashboard` and `charts`.
  - `src/routes/screen.ts` (`/api/screen/beneficiary/:id`).
  - `src/lib/snippet.ts` (document offsets) and `src/routes/invoices.ts` (`doc_marks`).
  - SQL fixture tests in `scripts/tests/`, and route tests with hand-computed values.
- Dependencies: the new SQL can start now. It merges after 42.
- Deploy E4: db-push 001100, then deploy.
- Estimate: 2.5 h.

**Task 46: Chart primitives (AC-106).** Seat: junior-builder, now.
- Files:
  - `web/charts/{StackedBars,HBars,Line,Sparkline,Kpi,Segments}.tsx` and `web/charts/charts.css`;
  - `web/charts/*.test.tsx`;
  - `src/i18n/features/charts.ts`.
- Built with the `dataviz` skill, with the approved palette swapped in (R-123). Each chart has its summary sentence, text values, a designed empty state with reserved height, and locale formats. No library unless justified.
- Owned by this task only; Tasks 47-50 import it.
- Estimate: 1.5 h.

**Tasks 47-51: the D39 screens.** Each one is built in new component files on AC-101..AC-105's mocked contracts as soon as a seat is free. It mounts into its page in one commit after Task 43 merges, uses real data after Task 45 deploys, and ends with the gate on its screens.
- **47 Bandeja dashboard (AC-101).** Senior.
  - Files: `web/dashboard/*.tsx` and `web/dashboard/dashboard.css` (new), `web/pages/Inbox.tsx`, `web/pages/inbox.css`, `src/i18n/features/dashboard.ts`, `web/Inbox.test.tsx`.
  - Gate: `inbox` and its states, as the demo user and as a trial user.
  - Estimate: 2.5 h.
- **48 Detalle (AC-102).** Senior.
  - Files: `web/components/{DocumentPanel,RuleChecklist,FxCard}.tsx` (new), `web/components/Timeline.tsx` (avatars), `web/components/ChecksTable.tsx` (if replaced by the checklist), `web/pages/InvoiceDetail.tsx`, `web/pages/detail.css`, `src/i18n/features/detail-viz.ts`, `web/InvoiceDetail.test.tsx`.
  - Gate: `detail-*`.
  - Estimate: 2 h.
- **49 Periodo (AC-103).** Junior.
  - Files: `web/pages/Period.tsx`, `web/pages/period.css`, `src/i18n/features/period-viz.ts`, `web/Period.test.tsx`.
  - Gate: `period` and its states.
  - Estimate: 2 h.
- **50 Beneficiarios profile (AC-104).** Junior.
  - Files: `web/pages/Beneficiary.tsx` (new), `web/pages/Beneficiaries.tsx` (row links), the route line in `web/App.tsx` (replacing 43's placeholder; a declared shared edit), `src/i18n/features/beneficiary.ts`, `web/Beneficiaries.test.tsx`.
  - Gate: `beneficiaries`, `beneficiary` and `beneficiary-empty`.
  - Estimate: 2 h.
- **51 Política cards + diff list (AC-105).** Junior.
  - Files: `web/pages/Policy.tsx`, `web/policy.css`, `src/i18n/features/policy-cards.ts`, `web/Policy.test.tsx`.
  - Gate: `policy`, with R-108..R-111 still holding.
  - Estimate: 1.5 h.

**Task 35b: README + SUBMISSION refresh (AC-49 and AC-51 Clarified).** Seat: junior-builder.
- The ledgered 17:30Z SES correction, plus D41's two doors in the first 10 lines, «Para el jurado», «Velocidad» (a link to `docs/perf.md`), and the not-done items of AC-49 Clarified.
- After checkpoint C. It is allowed in FREEZE.
- Estimate: 1 h.

Then the existing tasks, unchanged except for their start: 33 and 34 (the gates) at checkpoint C on E6, then 36, 37 (the video, after 00:00Z and after 33 and 34 pass), and 38 (merge to main).

## Shared files (merge in this order; the later task rebases)
| File | Order |
|---|---|
| migrations | 39: 000900 → 42: 001000 → 45: 001100 |
| `src/lib/auth.ts` | 39 → 42 |
| `src/routes/invoices.ts` | 39 (POST) → 42 (GET collapse) → 45 (`doc_marks`) |
| `src/routes/policy.ts` | 39 → 42 |
| `src/routes/approvals.ts`, `src/agent/loop.ts`, `src/agent/trace.ts`, `scripts/auth-config.sh` | 39 only |
| `src/routes/screen.ts`, `src/index.ts` | 42 → 45 (39 touches `index.ts` only if 39b's route is needed: 39b → 42) |
| `src/lib/snippet.ts` | 45 only |
| `wrangler.toml`, `src/env.ts` | 42 only |
| `scripts/perf.mjs`, `scripts/ux-gate.mjs`, `package.json` | 44 only |
| `web/pages/Login.tsx` | 32b → 40 → 41 → 43 |
| `web/pages/Demo.tsx` | 32b → 40 → 43 |
| `web/App.tsx`, `web/auth.tsx` | 32a → 40 → 41 → 43 → 50 (one route line) |
| `web/main.tsx`, `web/api.ts`, `vite.config.ts` | 43 only |
| `web/pages/Inbox.tsx`, `inbox.css` | 32a → 43 → 47 |
| `web/pages/InvoiceDetail.tsx`, `detail.css`, `Timeline.tsx`, `ChecksTable.tsx` | 32a → 43 → 48 |
| `web/pages/Period.tsx`, `period.css` | 32a → 43 → 49 |
| `web/pages/Beneficiaries.tsx` | 32a → 43 → 50 |
| `web/pages/Policy.tsx`, `web/policy.css` | 32a → 40 (one line) → 43 → 51 |
| `web/charts/*` | 46 only |
| `web/dashboard/*` | 47 only |
| `src/i18n/es.ts`, `en.ts` | registration lines only, any order |
| `README.md`, `docs/SUBMISSION.md` | 35b only (37 sets the video URL) |

## Deploy points (the orchestrator only, from integration, after a green full suite)
- E1 (39): db-push 000900; `scripts/auth-config.sh`, then `--check`; deploy main; the save-access probe; one anonymous sign-in by curl.
- E2 (40): deploy. The door is live. QA on AC-92..AC-94. `perf.mjs` adds the trial row.
- E3 (41, 42, 39b if needed): db-push 001000; deploy; QA on AC-95; `perf.mjs` API run.
- E4 (43, 45): db-push 001100; deploy.
- E5 (47-51, as they merge): deploy, at most two batches.
- E6, at checkpoint C, 2026-10-18T02:00Z: the last UI deploy. `perf.mjs` final table; Tasks 33 and 34 start.
- Then the existing D8 (video) and Task 38.

## Clock (UTC, target)
- 17 Oct 18:15: dispatch 39 (senior), 44 and 46 (junior). Dispatch 40 (senior, new files) and 41 (junior, new files) as soon as a seat is free.
- ~19:30: 32a and 32b merged (in flight now). Then 40's mounts, 42, 43 (on mocks) and 45 start.
- ~20:45: 39 merged → E1.
- ~21:30: 40 merged → E2, and the door is live.
- 22:00: **checkpoint A**. If the door is not live, every free seat goes to D41 and no D39 page task starts.
- ~22:15: 41 and 42 merged → E3.
- ~23:00: 43 and 45 merged → E4. Tasks 47-51 mount; they started on new files from ~20:00 as seats allowed.
- 18 Oct 00:00: **checkpoint B**. R-95 checkpoint 1 still applies to AC-81, and any D39 page task not started is cut.
- ~00:30-01:45: 47-51 merge as they pass → E5.
- 02:00: **checkpoint C, the UI freeze**. E6, the final `docs/perf.md`, and 33 and 34 start. An unmerged D39 task is cut in R-126's order.
- ~03:30: 33 and 34 pass. 35b runs alongside.
- ~04:30: 36.
- ~06:30: 37, the video (after 00:00Z).
- ~08:30: 38, and the merge to main.
- FREEZE at 11:00, which leaves 2.5 h of buffer.

## Cut order (R-126)
- Never cut:
  - D41: AC-92..AC-96;
  - D40: AC-97..AC-99;
  - AC-91 (the gate) and AC-50 (the video);
  - everything on R-95's never-cut list.
- Cut first to last:
  1. AC-88 (already SHOULD).
  2. AC-81 (taste polish beyond the gate).
  3. AC-100 (SHOULD).
  4. AC-105 Política cards (Task 51).
  5. AC-104 Beneficiarios profile (Task 50).
  6. AC-103 Periodo charts (Task 49).
  7. AC-102 Detalle (Task 48).
  8. AC-101 Bandeja dashboard (Task 47).
  AC-106 goes with the last one cut.
- What a cut means: the AC becomes SHOULD and its branch stays unmerged. Its page keeps today's screen plus Task 43's loader change, so D40 still holds there.
- AC-78 (merged) stays unless it fails the gate at checkpoint C. Superseded by D42 (R-143): AC-78 is never cut.
- A never-cut MUST still open at FREEZE goes to product for re-scope then, not before.

# D42: Tasks 52-54 (product, 17 Oct ~23:00Z)

> These tasks fold Roberto's D42: login speed, the logo intro, and the transition into the app. The ACs are AC-107..AC-109 in `docs/SPEC.md` section 13f, with AC-92 and AC-40 Amended, and AC-42, AC-78, AC-91, AC-97 and AC-99 Clarified. The rulings are R-143..R-149, and Q20 is in `docs/QUESTIONS.md`. Where this section and a ruling differ, the ruling wins. R-149 amends R-126's cut order and clock.

## Binding order and rules
- The order is 52 (speed), then 53 (intro), then 54 (transition), as D42 (1), (2), (3) say.
- Task 52 is never cut. It has seat priority over all new work. In-flight fix rounds finish first: 40d, 46b, 46c, and 49, 50 and 51.
- Task 52 may merge after checkpoint C (02:00Z) as a speed fix, until FREEZE. The video (Task 37) waits for it.
- Tasks 53 and 54 must be merged, with the gate passed, by 02:00Z, or they are cut (R-149).
- Every rule at the top of this file still holds:
  - TDD, then the full suite and `bash scripts/tests/run.sh` green;
  - no real Auth, model or FX call in tests;
  - the gate and a reviewer on every touched screen;
  - builders never deploy.
- No migration and no Worker route change. All three tasks are web or scripts work. If Task 52 needs R-141's lever, folding the company name into `screen_inbox`, that is the only backend change allowed: a `create or replace` that keeps every existing key.
- Guardrails that do not move: AC-16 and AC-69 (the web never shows `expected_outcome` as an outcome), R-122, AC-38 and AC-68.

## Tasks

**Task 52: Entry speed: land first, the pass on Bandeja, tour on landing (AC-107, AC-92 Amended, AC-40 Amended, AC-42 Clarified, AC-78 Clarified, AC-99 Clarified).** Seat: senior-builder, first priority, now.
- What to remove from the login path today. These are the awaits before navigation that AC-107 forbids:
  - `web/pages/Login.tsx` `signedIn()`: it awaits `updateUser({ data: { lang } })`, then the whole `runUntilDone('/api/invoices/run')` loop, and only then navigates;
  - `web/trial.ts` `startTrial()`: it awaits the same loop after `signInAnonymously`, and the door button shows «n de m» until it ends.
  After the change, navigation follows the sign-in call alone. The language write is fired and not awaited, with the language applied locally at once.
- Files:
  - New `web/firstRun.tsx`: the app-shell owner of the first-login pass. It holds a tab flag in `sessionStorage`, set by the entry and cleared at the end. It is started by the entry, and resumed after a reload while the flag is set. It exposes the progress and a per-batch signal. It uses the same `runUntilDone` (AC-70), one run per tab. Test file: `web/firstRun.test.tsx`.
  - `web/pages/Login.tsx`: `signedIn()` sets the flag and navigates. The progress text «Entrando…» shows while the sign-in call runs.
  - `web/trial.ts` and `web/components/TrialButton.tsx`: `startTrial()` returns after the sign-in. The flag is set. The button reads «Creando tu empresa de prueba…» and no longer shows «n de m».
  - `web/pages/Demo.tsx`: the busy state «Entrando…» on «Entrar como Andina Labs». The demo email from `/api/config` may be fetched on page load. There is no pass for the demo user.
  - `web/App.tsx`: one mount line for the first-run provider. This waits for 40d's merge on this file.
  - `web/pages/Inbox.tsx`:
    - while the pass runs, RunProgress shows the shell's pass, with AC-107's progress sentence;
    - «Ejecutar agente» is busy as the same run;
    - each batch refreshes the screen data (one request in flight) and AgentActivity.
  - `web/dashboard/Dashboard.tsx` and `web/dashboard/dashboard.css`:
    - the «todavía está decidiendo <n> facturas» text in place of a misleading empty state while the pass runs;
    - fixed boxes for the sections that grow (R-145).
  - `web/dashboard/InvoiceTable.tsx`: rows keep their order and height while the pass runs, and only the chip and headline change.
  - `web/components/Tour.tsx`: re-measure the spotlight after each batch refresh.
  - `src/i18n/features/entry.ts`: the new strings in es and en.
  - Tests: `web/Login.test.tsx`, `web/Trial.test.tsx`, `web/Demo.test.tsx`, `web/Inbox.test.tsx`, `web/AgentActivity.test.tsx` and `web/Tour.test.tsx`, all as AC-107's Evidence lists.
- R-141's lever is pre-authorised only if the first E5a perf run shows an `entry` row over 2.000 ms caused by `/api/company`. The lever is a parallel request, or the company name folded into `screen_inbox`.
- Gate: `login`, `login-password`, `demo`, `trial` (through the pass), and `inbox`, as the demo user and as a trial user, at 360, 390 and 1440, in es and en.
- Merge order:
  - 40d → 52 on `App.tsx`;
  - 52 first on `Login.tsx`, `Demo.tsx`, `TrialButton.tsx`, `trial.ts`, `Inbox.tsx`, `Dashboard.tsx`, `InvoiceTable.tsx` and `Tour.tsx`.
- Deploy E5a by the orchestrator, then the `perf.mjs` entry rows (after 52b) and a QA run on AC-107 through the four doors. The OTP door uses an Admin-API code, and no mail is sent.
- Estimate: 2 h.

**Task 52b: Perf entry rows and gate timing (AC-97 Clarified targets 5 and 6, AC-91 Clarified).** Seat: junior-builder, next free seat.
- Files:
  - `scripts/perf.mjs` and `scripts/perf.test.mjs`. The rows are `entry otp`, `entry password`, `entry trial`, `entry demo` and `entry trial (all decided)`, measured as R-146 sets out:
    - t0 is the click event's `timeStamp`, from a capture listener;
    - t1 is the first frame where AC-97's five conditions hold;
    - for OTP, `/auth/v1/otp` is fulfilled by the script, and the code comes from the Admin API's `generateLink`;
    - the QA users are created if missing, and never deleted;
    - the service-role key comes from the environment and is never printed.
  - `scripts/ux-gate.mjs` and its test:
    - `trial` measures CLS from landing to the end of the pass;
    - `login` and `demo` wait for the logo's animations to finish, up to 1.5 s, before the screenshot and axe, and then run a reduced-motion pass;
    - the new screen id `entry`.
  - `docs/perf.md` is regenerated by the run and never edited by hand.
- Dependencies:
  - `perf.mjs` starts now;
  - the `ux-gate.mjs` edit starts after 46b and 46c merge, because both edit that file;
  - the `entry` gate needs 54, and it reports N/A until 54 merges, or permanently if AC-109 is cut.
- Tests, on fixtures:
  - the t1 predicate (a busy «Ejecutar agente» counts as usable; a skeleton table does not);
  - the median;
  - the 30 s row;
  - the OTP set-up never sends a request to `/auth/v1/otp` upstream.
- Estimate: 1.25 h.

**Task 53: Wordmark intro (AC-108).** Seat: junior-builder, next free seat after 52b.
- New files, started now:
  - `web/components/LogoIntro.tsx`: inline SVG with the mark and 9 `<tspan>` letters, or spans in the logo's font; the letters are `aria-hidden`, and the logo has one accessible name;
  - `web/components/logo-intro.css`: keyframes on `transform` and `opacity`, a delay per letter from a CSS index (40-60 ms), the mark last, all done by 1.200 ms, and `@media (prefers-reduced-motion: reduce)` with no animation;
  - `web/Logo.test.tsx`: AC-108's unit cases.
- The once-per-tab rule (`sessionStorage`, per screen) lives in `LogoIntro.tsx`.
- Mount, after 52 merges: one line each in `web/pages/Login.tsx` and `web/pages/Demo.tsx`. `web/components/Logo.tsx` (the top bar) is unchanged, except an optional export of shared dimensions.
- Gate: `login` and `demo` at five widths, in es and en, after the intro, plus the reduced-motion pass. Screenshots `docs/ux/login-intro-end-1440-es.png` and `docs/ux/demo-intro-end-390-en.png`.
- Merge: 52 → 53 on `Login.tsx` and `Demo.tsx`.
- Deploy: E5a, if it is ready with 52, or E5b.
- Estimate: 1 h.

**Task 54: Transition into the app (AC-109).** Seat: senior-builder, second priority.
- New files, started now:
  - `web/transition.ts`: `enterApp(navigate)` wraps the navigation in `document.startViewTransition` when that exists and reduced motion is off, and otherwise navigates at once;
  - `web/components/transition.css`: the `view-transition-name` rules for the logo, the page and Bandeja, and `::view-transition-*` timing of 300-500 ms, on transform and opacity only;
  - `web/transition.test.ts`.
- Mount, after 52 and 53 merge:
  - `web/pages/Login.tsx`, `web/components/TrialButton.tsx` and `web/pages/Demo.tsx` call `enterApp`;
  - `web/App.tsx` gives the top-bar logo its `view-transition-name`;
  - `web/components/LogoIntro.tsx` gives the page logo its `view-transition-name`;
  - `web/auth.tsx` or `web/App.tsx` starts the tour after the transition's `finished`.
- Gate: `entry`, from `/login` and from `/demo`, at 390 and 1440, in es and en, with the CLS and console items. Screenshot `docs/ux/entry-mid-1440-es.png`.
- Merge: last on `App.tsx`, `auth.tsx`, `Login.tsx`, `Demo.tsx`, `TrialButton.tsx` and `LogoIntro.tsx`.
- Deploy E5b, before 02:00Z.
- Estimate: 1.5 h.

## Shared files with the tasks in flight (merge in this order; the later task rebases)
| File | Order |
|---|---|
| `web/App.tsx` (top bar, tour start) | 40d → 52 (one mount line) → 54 |
| `web/pages/Login.tsx`, `web/pages/Demo.tsx` | 52 → 53 (one line each) → 54 |
| `web/components/TrialButton.tsx`, `web/trial.ts` | 52 → 54 |
| `web/pages/Inbox.tsx`, `web/dashboard/*`, `web/components/Tour.tsx` | 52 only (47 is merged; Tour.tsx waits for 40d if 40d touches it) |
| `web/components/LogoIntro.tsx` | 53 → 54 |
| `web/charts/lazy.tsx` | 46c only. 46c's KPI placeholder fix is a precondition for the `trial` CLS bar, so 52's gate runs after 46c merges |
| `scripts/ux-gate.mjs` | 46b and 46c → 52b |
| `scripts/perf.mjs` | 52b only |
| `scripts/record-happy-path.mjs` | 46c → 37 (the video takes AC-50 Clarified's D42 steps) |
| `web/pages/Policy.tsx`, `Period.tsx`, `Beneficiary*.tsx` | 49, 50, 51 fix rounds only; no D42 task touches them |

## Deploy points
- E5a, after 52 merges (and 53, if ready): deploy, then the `perf.mjs` entry rows (52b), then QA on AC-107.
- E5b, after 54 (and 53, if not in E5a), no later than 02:00Z: deploy, then the gate on `entry`, `login` and `demo`.
- E6 at checkpoint C, unchanged: the binding perf table. If 52 merges after C, its deploy is E7, and the entry rows of the table run after E7.

## Clock (UTC, target)
- 17 Oct ~23:00: dispatch 52 (senior). Dispatch 54 (senior, new files) when a senior seat is free. Dispatch 52b (junior) and then 53 (junior, new files) as junior seats free up.
- ~00:30: 52 merged → E5a. Perf entry rows, then QA AC-107.
- ~01:00: 53 mounted.
- ~01:30: 54 mounted.
- 01:45: E5b.
- 02:00: checkpoint C. 53 and 54, if not merged with the gate passed, are cut (R-149). 52, if not merged, continues as a speed fix.
- After C: gates 33 and 34 include the D42 screens, and the video follows as before.

## Cut order (R-149, amends R-126)
- Never cut: AC-107 (D42 (1)) and AC-78, plus everything already on R-126's list.
- First to last:
  1. AC-88;
  2. AC-81;
  3. AC-109 (Task 54);
  4. AC-108 (Task 53);
  5. AC-105;
  6. AC-104;
  7. AC-103;
  8. AC-102;
  9. AC-101.
- A cut AC becomes SHOULD. Its branch stays unmerged, and the ledger says why. The video then shows the product as it is.
