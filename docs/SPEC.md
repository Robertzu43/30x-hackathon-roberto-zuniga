# Spec: Thesaurus (Reto Blinka: Agentes que pagan por la empresa)

Owner: `product`. Sources: `docs/PROBLEM.md`, `docs/DECISIONS.md` (D1-D21 plus the "Scope: in" bullets, cited as S-Ingest, S-Reader, S-Directory, S-Policy, S-Engine, S-Record, S-Escalation, S-Screens, S-Auth, S-Bilingual, S-Output, S-DataSet, S-Tests, S-Submission, S-SES), `docs/CONTEXT.md` (rubric, submission form), `CLAUDE.md` (demo requirements). The plan is `docs/PLAN.md` (Tasks 1-18 MUST, S1-S5 SHOULD).

Format: `AC-nn (MUST|SHOULD) When <situation>, the system <observable behaviour>. Evidence: <what a tester runs or clicks>.` followed by Trace, Rubric (Impacto 30 / Innovación 20 / V. técnica 20 / V. implementación 20 / Presentación 10), Axis (Autonomía / Seguridad / Explicabilidad) where it applies, and Tasks.

Global definitions used by every AC:
- Outcomes are exactly `PAGAR`, `FRENAR`, `ESCALAR` (D1). Check verdicts are exactly `cumple`, `no cumple`, `no se pudo verificar` (UI) / `cumple`, `no_cumple`, `no_verificado` (data).
- "Deployed URL" = `https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev`.
- "Fresh workspace" = a user created through Supabase Auth (OTP signup or Admin API `createUser`); the trigger seeds it. QA may create users with the Admin API so no AC needs mail delivery.
- "Demo company" = Andina Labs Inc. with `is_demo = true` (D8).
- Product email is AWS SES in sandbox: it delivers only to verified identities (`HEARTBEAT_EMAIL`). No MUST AC depends on mail being delivered to anyone (D9).
- Provisional rulings R-01..R-22 at the end of this file bind every AC that cites them.

---

## 1. Foundations

**AC-01 (MUST)** When the integration branch is checked out, the system passes `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` with exit code 0, and the deployed URL answers `GET /api/health` with 200 `{"ok":true}`. Evidence: run the four scripts; `curl -s <deployed URL>/api/health`.
Trace: CLAUDE.md Code rules, Demo requirements. Rubric: V. técnica. Tasks: 1, 17.

**AC-02 (MUST)** When any UI string or record sentence exists in the Spanish dictionary, the system has the same key in the English dictionary, and placeholders interpolate (`t('es','test.hello',{name:'Ana'})` = `Hola, Ana`). Evidence: `npx vitest run src/i18n` passes, including the "every es key exists in en" test.
Trace: D14, D20, S-Bilingual. Rubric: V. implementación. Tasks: 1, 5.

## 2. Workspaces, isolation, append-only

**AC-03 (MUST)** When a new user is created, the system creates that user's own company (named from the email's local part), a membership row, policy version 1 "Política general", the 8 Andina Labs beneficiaries and every seeded invoice, from a database trigger with no service-role call in the signup path. Evidence: create a user with the Admin API, sign in, `GET /api/invoices` returns every DATASET.md row and `GET /api/beneficiaries` returns 8.
Trace: D8, S-Auth. Rubric: V. implementación. Tasks: 2, 3.

**AC-04 (MUST)** When user A sends a request with A's JWT for any row of company B (companies, policies, beneficiaries, invoices, decisions, approval_tokens, approval_uses, `invoice_current`), the system returns no rows and changes nothing. Evidence: two Admin-API users; Supabase REST `select` with A's JWT filtered on B's `company_id` returns `[]`; an `insert` with B's `company_id` is refused.
Trace: S-Auth (RLS on `company_id`). Rubric: V. técnica. Axis: Seguridad. Tasks: 2.

**AC-05 (MUST)** When a member tries to UPDATE or DELETE a row in `decisions`, `approval_tokens` or `approval_uses` through REST with their JWT, the system changes 0 rows; a human answer only ever appears as a new decision row. Evidence: REST `PATCH` and `DELETE` on a decision id return no affected rows; the row is unchanged on re-read.
Trace: D10, S-Record. Rubric: V. técnica. Axis: Seguridad, Explicabilidad. Tasks: 2.

**AC-06 (MUST)** When a member tries to change an invoice's `fields`, `raw_text`, `expected_outcome`, `received_at` or `source` through REST, the system refuses it; only `archived` is updatable by members. Evidence: REST `PATCH` of `expected_outcome` with a member JWT fails or affects 0 rows; `PATCH` of `archived` succeeds. (R-12)
Trace: PROBLEM "Cada decisión tiene que poder explicarse después", D17. Rubric: V. técnica. Axis: Seguridad, Explicabilidad. Tasks: 2.

**AC-07 (MUST)** When the migrations are read, the system's schema changes are forward-only and additive: every new table has `enable row level security` in its first migration, no migration or seed contains `drop`, `truncate` or `delete from`, and no table reuses `profiles` or `deliveries`. Evidence: `bash scripts/tests/run.sh` (schema.test.sh and seed.test.sh) passes.
Trace: CLAUDE.md Infrastructure. Rubric: V. implementación. Tasks: 2, 3.

**AC-08 (MUST)** When an invoice file is uploaded, the system stores it in the private bucket `files` under `<company_id>/`, and the decision detail serves it through a signed URL that stops working after 5 minutes; a user of another company cannot read it. Evidence: open a PDF invoice's detail, copy the file URL, it opens; after 5 minutes it returns an error; with company B's JWT, `storage.from('files').createSignedUrl('<A company_id>/...')` fails.
Trace: S-Auth (Storage). Rubric: V. técnica. Axis: Seguridad. Tasks: 2, 8, 13.

## 3. Data set (Andina Labs)

**AC-09 (MUST)** When the seed is inspected, the system holds the fictional company "Andina Labs Inc." with 8 beneficiaries (name, country, currency, simulated bank account, Blinka route, agreement type/amount/cap/periodicity/validity) and 25-30 invoices in PDF, image, email text and chat text, in USD, COP, MXN, BRL, ARS and EUR, with at least one invoice for each of the 13 trap kinds of S-DataSet (exact duplicate; duplicate with a different number; new beneficiary; known beneficiary with changed bank account; over per-payment limit; over approval threshold but under limit; does not match the retainer; COP invoice whose USD equivalent exceeds the per-payment limit; exhausts the month's budget; exceeds the account balance; illegible or inconsistent total; past due; outside the period), every invoice carrying `expected_outcome`. `docs/demo/DATASET.md` lists every invoice (id, beneficiary, amount, currency, source, trap, expected outcome, reason), and `/demo/invoices/<NN>.pdf|.png` serves each file-based invoice (PDFs with a text layer, one deliberately blurred PNG). Evidence: open DATASET.md; `bash scripts/tests/run.sh`; open two document URLs on the deployed site. (R-07, R-08)
Trace: S-DataSet, PROBLEM "Data". Rubric: Impacto. Axis: Autonomía, Seguridad. Tasks: 3.

**AC-10 (MUST)** When the agent runs over the seeded invoices of a fresh workspace, on any date and with Workers AI unavailable, the system produces for every seeded invoice an agent outcome equal to its `expected_outcome`; seeded dates are relative to the moment of seeding, and no decision is ever stored by hand. Evidence: `npx vitest run` includes a seed-replay test that runs `decide` over the seed fixtures with the AI binding throwing and asserts outcome = expected for every row; QA: Periodo of a fresh workspace shows "Violaciones 0" and outcome counts equal to DATASET.md. (R-09)
Trace: S-DataSet, S-Reader ("the demo works even if the model is down"), D17. Rubric: V. técnica. Axis: Autonomía, Seguridad. Tasks: 3, 4, 8.

## 4. Reading invoices

**AC-11 (MUST)** When the user opens "Nueva factura", the system offers three tabs, "Subir PDF o imagen", "Pegar correo" and "Pegar chat"; submitting any of them creates an invoice with source `pdf`, `image`, `email` or `chat`, runs the agent on it and opens its decision detail. Evidence: upload `/demo/invoices/01.pdf`, paste an email text, paste a chat message; three new rows in Bandeja, each with an outcome.
Trace: S-Ingest, D12. Rubric: Impacto. Axis: Autonomía. Tasks: 7, 8, 12.

**AC-12 (MUST)** When a document is read, the system extracts payee, amount, currency (ISO), invoice number, issue date, due date, concept and payee bank account, each with a confidence in [0,1]; a field that is absent or has confidence below 0.8 is stored as unknown and shown as "desconocido", never guessed; every model call goes through `src/lib/llm.ts` with a JSON schema and zod validation. Evidence: `npx vitest run src/lib/llm.test.ts`; `grep -rn "AI.run" src` matches only `src/lib/llm.ts`; detail page of an uploaded invoice shows each field with its confidence. (R-05, R-10)
Trace: S-Reader, D3, CLAUDE.md LLM rule. Rubric: Innovación. Axis: Explicabilidad. Tasks: 7.

**AC-13 (MUST)** When reading fails (model error, invalid JSON, 20 s timeout, blurred image), the system still stores the invoice and decides ESCALAR with check "Lectura" = "no se pudo verificar" and a headline that says "ilegible"; reader failure never returns an error to the user. Evidence: upload the blurred seed PNG; unit test with `env.AI.run` throwing returns all-null fields with `concept: 'ilegible'`.
Trace: S-Ingest, S-Reader, D15. Rubric: V. técnica. Axis: Seguridad. Tasks: 7, 8.

**AC-14 (MUST)** When an amount is parsed, the system reads `1.000,00` and `1,000.00` as 1000, `$ 2.500` as 2500, `USD 1,234.5` as 1234.5, and an ambiguous `2.500,5` as unknown; when subtotal + tax differs from the total by more than 0.01 the amount becomes unknown. An unknown amount always yields ESCALAR ("Lectura" not verifiable), never a payment. Evidence: `npx vitest run src/lib/money.test.ts src/lib/llm.test.ts`; the seeded inconsistent-total invoice is ESCALAR.
Trace: S-Engine ("Amount parsing", "total is cross-checked"). Rubric: V. técnica. Axis: Seguridad. Tasks: 4, 7.

**AC-15 (MUST)** When an upload is not a PDF, PNG or JPEG, is larger than 10 MB, or pasted text is empty or longer than 20.000 characters, the system answers 400 with a Spanish message ("Formato no admitido: sube un PDF, PNG o JPG de hasta 10 MB") and stores nothing. Evidence: upload a `.docx` and an 11 MB PDF; Bandeja count unchanged. (R-11)
Trace: CLAUDE.md "Never cut validation". Rubric: V. técnica. Axis: Seguridad. Tasks: 8.

## 5. Decision engine (the disqualifier)

**AC-16 (MUST)** When any check of an invoice is `no cumple` or `no se pudo verificar`, the system never produces PAGAR: PAGAR is only the output of the pure `decide()` when all 13 checks are `cumple`; no prompt, model, JEV answer or route writes PAGAR on its own. Evidence: `npx vitest run src/engine` includes a test that, for each of the 13 checks, forces only that check to `no_cumple` and then to `no_verificado` and asserts outcome ≠ PAGAR; on the live database, `select count(*) from decisions where actor='agent' and outcome='PAGAR' and exists (select 1 from jsonb_array_elements(checks) c where c->>'verdict' <> 'cumple')` returns 0.
Trace: D2, D3, PROBLEM "Seguridad: cero pagos aprobados fuera de las reglas". Rubric: V. técnica, Impacto. Axis: Seguridad. Tasks: 4, 8, 9.

**AC-17 (MUST)** When a check fails, the system applies the fixed consequence table, which no policy field can change: exact duplicate or over the per-payment limit -> FRENAR; new beneficiary, changed bank account, over the approval threshold, period budget, insufficient balance, agreement mismatch, past due, outside the period, illegible or inconsistent reading, missing rule, currency without rate -> ESCALAR. When FRENAR and ESCALAR triggers coincide, FRENAR wins. Evidence: `npx vitest run src/engine/decide.test.ts`: one named test per table row plus one mixed FRENAR+ESCALAR test.
Trace: D15, D1. Rubric: V. técnica. Axis: Seguridad. Tasks: 4.

**AC-18 (MUST)** When a policy rule needed by a check is empty or the company has no policy, the system marks that check "no se pudo verificar" and decides ESCALAR; an empty policy never pays. Evidence: unit tests `rules null -> ESCALAR, every rule check no_verificado` and `empty allowed list -> ESCALAR`; QA: clear "Límite por pago" in Política, save, Reevaluar: pending invoices become ESCALAR with "no se pudo verificar".
Trace: S-Policy ("A rule left empty = no se pudo verificar = ESCALAR"). Rubric: V. técnica. Axis: Seguridad. Tasks: 4.

**AC-19 (MUST)** When the payee is not in the directory, the system decides ESCALAR with "beneficiario nuevo"; when the name matches (ignoring case, punctuation and the suffixes SAS, S.A.S, Ltda, Inc, LLC) but the invoice's bank account differs from the one on file, ESCALAR with "cuenta cambiada"; when the invoice shows no bank account, ESCALAR with "no se pudo verificar la cuenta". Evidence: unit tests for the three cases; seeded "Pixel Lab" and "Laura Méndez cuenta cambiada" invoices. (R-05)
Trace: D4. Rubric: Impacto. Axis: Seguridad. Tasks: 4.

**AC-20 (MUST)** When an invoice has the same beneficiary and the same invoice number as an earlier invoice received within the policy's duplicate window (any outcome), the system decides FRENAR "duplicado exacto"; when it has the same beneficiary, same agreement concept and same month with a different number, ESCALAR "posible duplicado"; a monthly retainer is never flagged against the previous month's invoice. Evidence: unit tests for the three cases; seeded duplicates. (R-06, R-20)
Trace: D13, S-Policy (duplicate window). Rubric: Impacto. Axis: Seguridad. Tasks: 4.

**AC-21 (MUST)** When an invoice's amount does not match the agreement (retainer or subscription outside `agreement_tolerance_pct`; hourly above `cap_usd`), is past its due date by more than `due_grace_days`, or falls outside the current period, the system decides ESCALAR with "no cuadra con lo acordado", "vencida" or "fuera del periodo"; a one-off agreement always passes the agreement check. Evidence: unit tests per case; seeded retainer 3.100 vs 2.500, past-due and outside-period invoices.
Trace: S-Engine, S-Directory, D15. Rubric: Impacto. Axis: Seguridad. Tasks: 4.

**AC-22 (MUST)** When an invoice is not in USD, the system converts it with the policy's fixed rate, `amount × rate` rounded to 2 decimals, compares limits, threshold, budget and balance in USD, and prints the conversion in the record ("1.500.000 COP × 0,000245 = 367,50 USD (tasa de la política v1)"); a currency with no rate decides ESCALAR "moneda sin tasa". Evidence: `npx vitest run src/lib/money.test.ts src/engine`; detail of a seeded COP invoice shows the conversion line.
Trace: D6, S-Engine. Rubric: Impacto. Axis: Seguridad, Explicabilidad. Tasks: 4, 5.

**AC-23 (MUST)** When invoices of one company are decided in arrival order within a calendar month (America/Bogota, by arrival date), the system counts PAGAR plus pending ESCALAR in USD as committed, escalates the invoice that would take committed above the period budget ("presupuesto del periodo"), and escalates an invoice whose payment would exceed the simulated account balance ("saldo insuficiente"). Evidence: unit tests; seeded budget-exhausting and over-balance invoices are ESCALAR with those checks `no cumple`.
Trace: D5, S-Engine, S-Policy. Rubric: Impacto. Axis: Seguridad. Tasks: 4.

**AC-24 (MUST)** When two invoices of the same company are decided at the same moment and together exceed the budget, the system lets at most one of them pass the budget: `insert_decision` holds a per-company advisory lock, rejects a decision computed against a stale committed amount with `STALE_PERIOD`, and the Worker re-decides it (up to 3 retries). Evidence: unit test with a fake db (STALE_PERIOD once -> retried -> succeeds); QA: set the period budget so that two prepared invoices fit only one at a time, send both `POST /api/invoices` in parallel (`curl ... & curl ...`), at most one is PAGAR and the other is ESCALAR "presupuesto del periodo".
Trace: S-Engine ("per-company advisory lock"). Rubric: V. técnica. Axis: Seguridad. Tasks: 2, 8.

**AC-25 (MUST)** When an invoice's latest decision is PAGAR or FRENAR, the system never appends another decision to it, from the agent, a policy re-evaluation, an approval link or the dashboard; the database function refuses it. Evidence: unit test; QA: call the `insert_decision` RPC through REST for a PAGAR invoice, it errors; press "Reevaluar" and the PAGAR/FRENAR rows keep the same timeline. (R-04)
Trace: D16, D1. Rubric: V. técnica. Axis: Seguridad. Tasks: 2, 8, 9.

## 6. Explainability (the decision record)

**AC-26 (MUST)** When the user opens an invoice ("Detalle de decisión"), the system shows, in this order: (1) the headline; (2) two columns, "Lo que leí" (document preview, or the pasted text, beside each extracted field with its confidence) and "Lo que decidí" (one row per check: name, real value, threshold, the arithmetic, verdict "cumple" / "no cumple" / "no se pudo verificar"); (3) for FRENAR and ESCALAR, "Qué tendría que pasar para pagarla" with one line per non-passing check; (4) for PAGAR, the payment block in Blinka's shape: beneficiario, ruta, moneda, monto (and USD equivalent); (5) "Política: <nombre> · versión <n> · <fecha>"; (6) "Historial", every decision event with actor ("Agente", "<correo> vía enlace", "<correo> en el tablero"), outcome and date-time (America/Bogota). Evidence: open the seeded Nube Sur invoice before and after approving it; `npx vitest run web/InvoiceDetail.test.tsx` (headline, 13 check rows, ESCALAR buttons, PAGAR payment block). (R-13, R-22)
Trace: S-Record, S-Output, D1. Rubric: Impacto. Axis: Explicabilidad. Tasks: 5, 8, 13.

**AC-27 (MUST)** When a record sentence is rendered, the system fills a template with real values: headline `<RESULTADO> · <monto> <moneda> a <beneficiario>: <razón>` (e.g. "ESCALAR · 4.200 USD a Nube Sur LLC: supera el umbral de aprobación de 2.500 USD"; "PAGAR · 2.500 USD a Laura Méndez, retainer de octubre, dentro de reglas"); check sentence with value, threshold, arithmetic and verdict (e.g. "Presupuesto de octubre: 42.000 usados + 9.000 = 51.000 > 50.000 USD → no cumple"; "Límite por pago: 2.500 USD ≤ 5.000 USD → cumple"); "qué tendría que pasar" lines (e.g. "Que una persona apruebe el monto sobre el umbral"; "Que se suba el presupuesto del periodo en la política"). Every CheckId × verdict has a template in both languages. Evidence: `npx vitest run src/engine/explain.test.ts`.
Trace: D7, D6, S-Record. Rubric: Impacto. Axis: Explicabilidad. Tasks: 5.

**AC-28 (MUST)** When the language is switched to English, the system renders the same record (headline, check sentences, "what would have to happen", timeline) in English with en-US formats ("1,500,000 COP × 0.000245 = 367.50 USD"); no record text is written by a model. Evidence: open a detail, switch "en" in the top bar; `grep -rn "AI.run" src/engine` returns nothing.
Trace: D7, D14, D20. Rubric: V. implementación. Axis: Explicabilidad. Tasks: 5, 13.

## 7. Bandeja

**AC-29 (MUST)** When the user opens Bandeja, the system lists every non-archived invoice with an outcome chip (PAGAR / FRENAR / ESCALAR / Pendiente) and its one-line headline, filters by outcome and by beneficiary, and "Ejecutar agente" decides every pending invoice and shows "n PAGAR · n FRENAR · n ESCALAR". Evidence: filter ESCALAR, then a beneficiary; upload two invoices via API without running, press "Ejecutar agente", read the summary; `npx vitest run web/Inbox.test.tsx`.
Trace: S-Screens (Bandeja), PROBLEM "Expected deliverable". Rubric: Impacto. Axis: Autonomía, Explicabilidad. Tasks: 8, 12.

## 8. Policy and directory

**AC-30 (MUST)** When the user opens Política, the system shows a form (never raw JSON) with every rule: solo beneficiarios permitidos, límite por pago, umbral de aprobación, presupuesto del periodo, saldo de la cuenta, ventana de duplicados, tolerancia del acuerdo, días de gracia de vencimiento, and one row per FX rate; "Guardar como versión n" stores a new version (name, number, date) and the version list shows all of them; a negative number, a non-number or a rate ≤ 0 shows an inline Spanish error and creates no version (API 400). Evidence: save with "Límite por pago" = 1000, see version n+1 in the list; save with -5, see the error; `npx vitest run web/Policy.test.tsx src/routes`.
Trace: S-Policy, D18 (one active policy), PROBLEM "pantalla simple donde la empresa define sus reglas". Rubric: Impacto. Tasks: 8, 14.

**AC-31 (MUST)** When a new policy version is saved, the system lists which pending and escalated invoices would change outcome (invoice, current outcome → new outcome) without writing any decision, and "Reevaluar pendientes" re-runs only pending and ESCALAR invoices; PAGAR and FRENAR stay untouched, and Bandeja states "Las facturas pagadas o frenadas no se reevalúan; solo las pendientes y escaladas." Evidence: lower "Límite por pago" to 1000, read the list, press Reevaluar, compare Bandeja before/after. (R-14)
Trace: S-Policy, D16. Rubric: Impacto. Axis: Seguridad, Explicabilidad. Tasks: 8, 14.

**AC-32 (MUST)** When the user edits the company section (nombre, correo del aprobador, idioma), the system saves it; for the demo company the approver email stays `HEARTBEAT_EMAIL` and cannot be changed (field disabled, API 403). Evidence: change the approver email in a fresh workspace and reload; try the same as the demo user. (R-15)
Trace: S-Escalation (`approver_email`), D8. Rubric: V. implementación. Axis: Seguridad. Tasks: 8, 14.

**AC-33 (MUST)** When the user opens Beneficiarios, the system lists the directory and lets the user add or edit a beneficiary (name, country, currency, simulated bank account, route from ACH / Wire / SWIFT / Pix / CBU / Transferencia COP / USDC, category, agreement type retainer / por horas con tope / suscripción / único with amount, cap, periodicity and validity); a new beneficiary changes the next decision. Evidence: add "Pixel Lab" with the account printed on its seeded invoice, press Reevaluar, its invoice no longer fails "beneficiario nuevo".
Trace: S-Directory, D4. Rubric: Impacto. Tasks: 8, 14.

## 9. Escalation and human approval

**AC-34 (MUST)** When a person approves an escalated invoice (link or dashboard "Aprobar"), the system overrides only the checks that were not passing in the escalated decision and are human-overridable (umbral de aprobación, beneficiario nuevo, cuenta cambiada, acuerdo, posible duplicado, vencida, fuera del periodo, lectura), re-runs every other check with fresh period state, and appends the result: PAGAR if everything else passes, otherwise ESCALAR again (for example when the budget is gone by then). Budget, balance, per-payment limit, exact duplicate and currency without rate are never overridable; their "qué tendría que pasar" line names the policy change needed. Approval that ends in PAGAR consumes period budget; "Rechazar" appends FRENAR by the human and releases it. Evidence: unit tests (approve after budget exhausted -> ESCALAR; reject -> FRENAR human; override set = failed ∩ overridable); QA: approve Nube Sur from the dashboard, Periodo "comprometido" unchanged and "pagado" up by 4.200; reject another escalated invoice, "comprometido" goes down. (R-02)
Trace: S-Escalation, D2, D5. Rubric: Impacto. Axis: Seguridad. Tasks: 4, 9, 13.

**AC-35 (MUST)** When an approval link is opened with GET (a person or a mail scanner), the system shows the invoice summary, what was read, the broken rule and one "Confirmar" button, and writes nothing; only the POST from "Confirmar" acts. Evidence: unit test "GET calls no insert"; QA: count decisions for the invoice, `curl` the GET twice, count again, unchanged.
Trace: S-Escalation, D11. Rubric: V. técnica. Axis: Seguridad. Tasks: 9, 16.

**AC-36 (MUST)** When an approval token is used, the system accepts it only if its HMAC signature is valid and it is less than 48 hours old, stores only its hash, and treats the approve/reject pair of one escalation as single-use: after either link is confirmed, both answer 409 and the page reads "Este enlace ya se usó"; a tampered or expired token shows "Este enlace no es válido o venció". Evidence: `npx vitest run src/lib/tokens.test.ts src/routes/approvals.test.ts` (round trip, tampered, expired, second POST 409, reject after approve 409); `select` on `approval_tokens` shows no raw token. (R-03)
Trace: D11. Rubric: V. técnica. Axis: Seguridad. Tasks: 6, 9, 16.

**AC-37 (MUST)** When two human answers for the same invoice arrive at once (link and dashboard, or two dashboard clicks), the system records exactly one human decision; any answer arriving when the invoice's latest decision is no longer ESCALAR gets 409 "Esta factura ya fue decidida". Evidence: unit test with two concurrent approvals; QA: two parallel `POST /api/invoices/:id/approve`, the timeline shows one human event. (R-03)
Trace: D11, D16, D10. Rubric: V. técnica. Axis: Seguridad. Tasks: 2, 9.

**AC-38 (MUST)** When the Worker code is searched, the system builds the service-role client in `src/lib/admin.ts` only, and only the approval-by-token handler imports it; every other route, CSV export included, uses the user's JWT. Evidence: `grep -rn "SERVICE_ROLE" src` matches only `src/lib/admin.ts` and `src/env.ts`; `grep -rn "lib/admin" src` matches only `src/routes/approvals.ts`.
Trace: S-Auth. Rubric: V. técnica. Axis: Seguridad. Tasks: 9.

**AC-39 (MUST)** When the agent newly escalates an invoice of a non-demo company (its previous latest decision was not ESCALAR), the system creates one approve/reject token pair and calls `src/lib/email.ts` once with a Spanish message to `approver_email` (headline, "Lo que leí", the broken rules, two links); a failed or unconfigured send is logged and never blocks or changes the decision; re-evaluations do not send it again; the demo company never gets tokens or mail. Evidence: `npx vitest run src/lib/email.test.ts src/services/runAgent.test.ts` (SigV4 header, no-secrets returns `{sent:false}` without fetch, one send per new escalation, zero for `is_demo`); `grep -rn "amazonaws" src` matches only `src/lib/email.ts`. (R-15, R-16)
Trace: S-Escalation, S-SES, D8, D9. Rubric: V. implementación. Axis: Seguridad. Tasks: 6, 8.

## 10. Login, language, guided tour

**AC-40 (MUST)** When a visitor opens `/login`, the system offers "Español | English", an email field with "Enviar código", then a 6-digit code field; a wrong code shows "Código incorrecto o vencido"; a valid code opens Bandeja, and on first login the user's pending invoices are decided once. Evidence: `npx vitest run web` login test with a mocked Supabase client; on the deployed URL, entering an email reaches the "Te enviamos un código de 6 dígitos" state. Code delivery itself is AC-54 (SHOULD).
Trace: S-Auth, D20. Rubric: V. implementación. Tasks: 11.

**AC-41 (MUST)** When the user picks a language on the login screen or in the top bar, the system switches UI, tour, record sentences and number/date formats (es-CO / en-US) without reload and stores the choice per user, so it persists on the next login from another browser. Evidence: switch to "en", log out, clear localStorage, log in: UI is English.
Trace: D20, D14. Rubric: V. implementación. Tasks: 1, 11.

**AC-42 (MUST)** When a user logs in for the first time, or clicks "Ver tutorial" in the top bar, the system runs a 7-step guided tour (Bandeja, Nueva factura, Ejecutar agente, Detalle de decisión, Política, Beneficiarios, Periodo y escalado) in the chosen language: the highlighted element is spotlighted and the rest is dimmed; "Siguiente", "Atrás" and "Saltar" work; finishing or skipping stores "seen" per user so it does not repeat; for the shared demo user it starts on every "Entrar como Andina Labs". No tour library. Evidence: `npx vitest run web/Tour.test.tsx`; QA on the deployed URL: fresh user sees it, reload does not repeat it, "Ver tutorial" restarts it. (R-17)
Trace: D19. Rubric: Presentación, V. implementación. Tasks: 11.

**AC-43 (MUST)** When one user sends more than 60 POST requests to `/api/*` within a minute, the system answers 429 with "Demasiadas solicitudes, intenta en un minuto". Evidence: route test with a fake `RATE_LIMIT` binding.
Trace: S-Auth (Workers ratelimit). Rubric: V. técnica. Axis: Seguridad. Tasks: 8.

## 11. Periodo (the challenge's scoreboard)

**AC-44 (MUST)** When the user opens Periodo, the system shows for the current month: presupuesto, saldo, pagado, comprometido, disponible, a per-beneficiary table, and three figures: "Autonomía n %" with "n de m facturas decididas solas y correctamente", "Violaciones n", "Decisiones explicadas 100 %". Autonomía = seeded invoices whose first agent decision is PAGAR or FRENAR and equals `expected_outcome`, over all non-archived seeded invoices; Violaciones = seeded invoices whose first agent decision is PAGAR while `expected_outcome` is not PAGAR. A human approval or a live policy change never raises Violaciones. The test suite asserts Violaciones 0 and Autonomía = (expected PAGAR + expected FRENAR) / total on the seed. Evidence: open Periodo on a fresh workspace and on the demo company after approving Nube Sur and lowering a limit; `npx vitest run web/Period.test.tsx src/services`. (R-01)
Trace: D17, PROBLEM "How success looks". Rubric: Impacto. Axis: Autonomía, Seguridad. Tasks: 8, 15.

## 12. Demo (judges on a shared screen, no Roberto)

**AC-45 (MUST)** When anyone opens `/demo` in a clean browser session with no account, the system shows a three-line problem statement, Andina Labs' read-only inbox (outcome and one-line reason per invoice), the Periodo figures, the "Entrar como Andina Labs" button and the link to the happy-path video. Evidence: open the deployed `/demo` in a private window.
Trace: D8, CONTEXT ("/demo page with seeded data is a MUST"), CLAUDE.md Demo requirements. Rubric: Presentación. Tasks: 10, 16.

**AC-46 (MUST)** When a judge clicks "Entrar como Andina Labs", the system opens the full dashboard on the demo company with no OTP and no mail, where the judge can create a trap invoice (upload or paste), change a rule and re-evaluate, and approve or reject from the dashboard. If anyone changed the demo user's password, re-running `node scripts/seed-demo-user.mjs <URL>` restores access. Evidence: private window, click, paste a chat invoice from "Pixel Lab", see ESCALAR; lower "Límite por pago", Reevaluar. (R-18)
Trace: D8, PROBLEM (mentors "create a trap invoice live, change a rule live"). Rubric: Presentación, Impacto. Tasks: 10, 16.

**AC-47 (MUST)** When a demo-company member clicks "Reiniciar demo", the system archives the demo company's invoices (no deletes), re-inserts the seed set, restores the seed beneficiaries and policy rules as a new version, re-runs the agent, and Bandeja again matches DATASET.md within 30 seconds; a member of any other company gets 403. Evidence: after AC-46's changes, click "Reiniciar demo", compare counts with DATASET.md; `POST /api/demo/reset` with a fresh user's JWT returns 403.
Trace: D8, CLAUDE.md (upsert-only resets). Rubric: Presentación, V. implementación. Tasks: 3, 10, 16.

## 13. Deliverables

**AC-48 (MUST)** When the orchestrator deploys from `<RUN>/integration`, the system runs at the deployed URL with secrets only from `wrangler secret` (`APPROVAL_HMAC_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and the SES keys when they exist), the demo user exists, and the secret scan finds nothing in the repo. Evidence: `curl <URL>/api/health`; `/demo` shows decisions; `bash .claude/hooks/secret-scan.sh` passes.
Trace: CLAUDE.md Demo requirements, Infrastructure. Rubric: V. implementación. Tasks: 17.

**AC-49 (MUST)** When a non-technical reader opens `README.md`, the system's first 10 lines (Spanish) say Blinka's problem in their words, what Thesaurus does, the three outcomes, the demo URL and how to enter ("Entrar como Andina Labs"); the rest explains how it decides (check list and consequence table), the app's flows and architecture, how to run, how to deploy, how to swap the mail provider (one file, `src/lib/email.ts`), and what is not done. It never presents Thesaurus as Blinka's own product or uses Blinka's logo. Evidence: read the first 10 lines aloud to someone outside the project.
Trace: CLAUDE.md Demo requirements, CONTEXT (submission: "README must explain the app, its flows and its architecture"), DECISIONS product name. Rubric: Presentación. Tasks: 17, 18.

**AC-50 (MUST)** When the "Video demo" URL is opened, the system plays, without login, a recording of the happy path on the deployed URL: `/demo` → "Entrar como Andina Labs" → tour (some steps, then Saltar) → upload an invoice → its decision record → approve the escalated Nube Sur invoice → lower a limit in Política, save, Reevaluar → Periodo. Evidence: open `<URL>/demo/happy-path.webm` in a private window.
Trace: CLAUDE.md "One recorded happy path", CONTEXT submission ("Video demo (URL)"), S-Tests. Rubric: Presentación. Tasks: 18.

**AC-51 (MUST)** When Roberto opens `docs/SUBMISSION.md` on his phone, the system has: project name "Thesaurus", challenge "Reto Blinka: Agentes que pagan por la empresa", a Spanish jury description of at most 5000 characters (problem, what it does, how safety is guaranteed by design, how to try it), the public repo URL, the demo URL and the video URL, and all three links answer 200. Evidence: `wc -m` on the description block; `curl -sI` on the three links.
Trace: CONTEXT submission format, S-Submission. Rubric: Presentación. Tasks: 17, 18.

**AC-52 (MUST)** When a non-engineer reads `docs/LEDGER.md`, the system shows every task result, every debate (both positions) and every ruling with its reason in plain language, and README links to it. Evidence: open the ledger, pick any ruling, it states who decided what and why.
Trace: CLAUDE.md Demo requirements. Rubric: Presentación. Tasks: 17 (README link; the orchestrator writes the ledger).

**AC-53 (MUST)** When any screen is shown, the system follows the `minimalist-ui` rules (warm monochrome, one accent, flat, no gradients, no heavy shadows, editorial type scale); `/demo` and Login follow `design-taste-frontend`; the product is named "Thesaurus, un agente de pagos construido para Blinka". Evidence: `grep -rni "gradient" web` finds nothing; the only `box-shadow` in `web/` is the tour spotlight; visual pass over the 7 screens.
Trace: D21, DECISIONS product name. Rubric: Presentación. Tasks: 1, 11, 12, 13, 14, 15, 16.

## 14. SHOULD (only after every MUST passed QA)

**AC-54 (SHOULD)** When AWS SES is configured (identity `HEARTBEAT_EMAIL` verified, scoped sender credentials as Worker secrets and as Supabase custom SMTP), the system delivers to `HEARTBEAT_EMAIL` the 6-digit OTP (valid 10 minutes) and the Spanish escalation email with working approve/reject links. Evidence: log in with `HEARTBEAT_EMAIL` and receive the code; escalate an invoice in a workspace whose approver is `HEARTBEAT_EMAIL`, click the link, "Confirmar". Until then: tests (AC-39) and the ledger.
Trace: D9, S-SES, S-Auth. Rubric: V. implementación. Tasks: 6, 17. (R-19)

**AC-55 (SHOULD)** When AWS grants SES production access (requested by the agents), the system delivers OTP and escalation mail to any address. Evidence: sign up with an unverified address and receive the code. Until then: the request id in the ledger.
Trace: D9, S-SES. Rubric: V. implementación. Tasks: 17. (R-19)

**AC-56 (SHOULD)** When the user clicks "Exportar CSV" on Periodo, the system downloads one row per decision (fecha, factura, beneficiario, monto, moneda, USD, resultado, titular, versión de política) using the user's JWT. Evidence: download, open in a spreadsheet; route test asserts header and one row.
Trace: S-Output (SHOULD), PROBLEM ("Concilia en una hoja de cálculo"). Rubric: Impacto. Tasks: S1.

**AC-57 (SHOULD)** When `JEV_ENABLED=true` and the deterministic name match fails or the probable-duplicate check passes, the system asks TypeSafe JEV the two typed questions; a "yes" with p ≥ 0.9 adds an ESCALAR check `jev_<id>` and never produces PAGAR; flag off or service down = the deterministic result, never unknown. Evidence: tests with a fake fetch (yes → ESCALAR, error → deterministic, flag off → no call).
Trace: D3, S-Engine (JEV SHOULD). Rubric: Innovación. Axis: Seguridad. Tasks: S2.

**AC-58 (SHOULD)** When a member clicks "Invitar", the system generates an access link for an email and shows it on screen without sending mail. Evidence: click, copy the link, open in a private window.
Trace: D8 (SHOULD). Rubric: V. implementación. Tasks: S3.

**AC-59 (SHOULD)** When a company defines several policies scoped by beneficiary category, the system applies to each invoice the policy chosen from the beneficiary's category in the directory (never by AI), and the strictest one when more than one applies; the record names the policy used. Evidence: two policies, one invoice whose category matches both, record names the stricter one.
Trace: D18, S-Policy (SHOULD). Rubric: Impacto. Tasks: S4.

**AC-60 (SHOULD)** When the user clicks "Exportar política" or "Importar política", the system downloads the rules as JSON or loads a JSON file into the form (validated with the same rules as AC-30) without saving until "Guardar". Evidence: export, change a value in the file, import, see the form updated, save.
Trace: S-Policy (SHOULD). Rubric: V. implementación. Tasks: S5.

---

## Provisional rulings (product, 16 Oct; Roberto may overrule; the orchestrator ledgers them)

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

---

## Task to AC map

| Task | ACs |
|---|---|
| 1 Scaffold | AC-01, AC-02, AC-41, AC-53 |
| 2 Schema, RLS, RPC | AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-24, AC-25, AC-37 |
| 3 Seed data | AC-03, AC-07, AC-09, AC-10, AC-47 |
| 4 Money + engine | AC-10, AC-14, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-34 |
| 5 Explanations | AC-02, AC-22, AC-26, AC-27, AC-28 |
| 6 Email + tokens | AC-36, AC-39, AC-54 |
| 7 Reader | AC-11, AC-12, AC-13, AC-14 |
| 8 API | AC-08, AC-10, AC-11, AC-13, AC-15, AC-16, AC-24, AC-25, AC-26, AC-29, AC-30, AC-31, AC-32, AC-33, AC-39, AC-43, AC-44 |
| 9 Approval flow | AC-16, AC-25, AC-34, AC-35, AC-36, AC-37, AC-38 |
| 10 Demo company | AC-45, AC-46, AC-47 |
| 11 Login + tour | AC-40, AC-41, AC-42, AC-53 |
| 12 Bandeja + Nueva factura | AC-11, AC-29, AC-53 |
| 13 Detalle | AC-08, AC-26, AC-28, AC-34, AC-53 |
| 14 Política + Beneficiarios | AC-30, AC-31, AC-32, AC-33, AC-53 |
| 15 Periodo | AC-44, AC-53 |
| 16 Approve page + /demo | AC-35, AC-36, AC-45, AC-46, AC-47, AC-53 |
| 17 Deploy, README, submission | AC-01, AC-48, AC-49, AC-51, AC-52, AC-54, AC-55 |
| 18 Video + final checks | AC-49, AC-50, AC-51 |
| S1 CSV | AC-56 |
| S2 JEV | AC-57 |
| S3 Invite | AC-58 |
| S4 Scoped policies | AC-59 |
| S5 Policy JSON | AC-60 |
