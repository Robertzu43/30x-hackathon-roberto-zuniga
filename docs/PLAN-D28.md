# Tasks D28-D35 (+ D36-D38): Thesaurus delta plan

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
