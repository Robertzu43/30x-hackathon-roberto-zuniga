# Decisions (Roberto only, 16 Oct 2026)

Product name: **Thesaurus**, "un agente de pagos construido para Blinka" (Latin for tesorero). Never use Blinka's logo or present the product as Blinka's own; it is a hackathon prototype built for them.

## Stack
Cloudflare Workers (compute, deploy, KV for rate limits) + Supabase (Postgres with RLS, Auth with email OTP, Storage for invoice files) + Resend (OTP mail via Supabase custom SMTP, escalation mail, heartbeat) + Workers AI (reading only: PDF/image to text, schema-validated field extraction) + TypeSafe JEV (typed judgments in the decision pipeline, through `src/lib/llm.ts`, with fallback to ESCALAR). UI: Vite + React served by the Worker (Static Assets). D1/R2 not used. AWS stays connected as a reserve and is NOT used at runtime: a Worker cannot hold AWS credentials under the new AWS experience (no IAM users or access keys), and the login lasts 12h and needs Roberto's phone. No task may depend on AWS.

## Scope: in
- Ingest an invoice three ways, all through the same reader: upload PDF or image; paste an email (or upload `.eml`); paste a chat message. Live inbound mailbox is SHOULD (see D12).
- Reader: Workers AI turns the document into text and extracts payee, amount, currency, invoice number, issue date, due date, concept, each with a confidence; missing or doubtful fields are marked unknown, never guessed. Seeded invoices carry their extracted fields so the demo works even if the model is down.
- Beneficiary directory ("lo acordado"): name, country, currency, bank details (simulated), Blinka payment route (ACH, wire, SWIFT, Pix, CBU, COP transfer, USDC), agreement type (fixed retainer, hourly with cap, subscription, one-off) with amount, periodicity, validity.
- Policies: named rule sets with scope (beneficiary category, country, currency, amount band). Rules: allowed beneficiaries (by bank account, not only name), per-payment limit, per-period limit and budget, human-approval threshold, duplicate window, agreement match, due date, FX rate table (fixed per policy, shown in the record), JEV confidence thresholds. Policies are JSON documents (JSONB), versioned, import/export as `.json`. Editor with live simulation: before saving, show which existing decisions would change; re-run on demand.
- Decision engine: pure function `decide(invoice, beneficiary, policy, periodState) -> {outcome, checks[]}` with outcomes PAGAR / FRENAR / ESCALAR. Every check records name, actual value, threshold, verdict (PASS / FAIL / UNKNOWN) and a template sentence in es and en. PAGAR only when every check is PASS. FAIL -> FRENAR or ESCALAR as the policy says; UNKNOWN -> ESCALAR. Period limits count PAID plus pending ESCALATED, in arrival order. Currencies are converted to USD with the policy's rate before any comparison.
- JEV judgments (typed questions, one per judgment, each with an "otro"/unknown path): document type (Choice), applicable policy (Choice), matches the agreement concept/period (Noul), possible duplicate of invoice X when numbers differ (Noul), payee name is directory beneficiary Y (Noul), reading reliability (Score). A judgment can only push toward ESCALAR (or FRENAR via a policy rule); it can never produce PAGAR. Probability below the policy threshold = UNKNOWN. TypeSafe down = UNKNOWN.
- Decision record: two columns, "Lo que leí" (extracted fields beside the document) and "Lo que decidí" (each check with value and threshold, each JEV judgment with its probability, the policy version hash). Append-only: human approval/rejection is a new event; the agent's decision is never edited or deleted.
- Escalation: the approver gets an email (Resend) with the invoice summary, what was read and the broken rule, and single-use signed approve/reject links (expiring); same actions in the dashboard. Approval consumes period budget; rejection releases it.
- Screens: Bandeja (inbox with outcome and one-line reason, filters), Detalle de decisión, Políticas (editor + simulation + JSON import/export), Beneficiarios, Periodo (budget, paid, committed, available, by beneficiary; autonomy %, violations = 0), plus `/demo` public showcase and the auth screens.
- Auth: signup and login with email + 6-digit OTP (Supabase Auth, custom SMTP = Resend). Each signup creates its own company workspace seeded with the demo data set, isolated by RLS on `company_id`. OTP rate-limited.
- Bilingual es/en: UI copy, record sentences, emails and seed data in both; locale formats es-CO and en-US; language switch in the top bar.
- Output of a PAGAR decision: a simulated payment order in Blinka's shape (beneficiary, route, currency, amount) and a CSV export of the decision log for reconciliation.
- Data set: fictional company "Andina Labs Inc." (Delaware; team in Colombia, Mexico, Brazil, Argentina; vendors in LATAM, US, EU). 25-30 invoices in PDF, image, email text and chat text; USD, COP, MXN, BRL, ARS, EUR. ~15 normal and 10-12 traps: exact duplicate; duplicate with different number; new beneficiary; known beneficiary with changed bank account; over per-payment limit; over approval threshold but under limit; does not match the retainer; COP invoice whose USD equivalent exceeds the limit; exhausts the month's budget; illegible / inconsistent total; past due; outside the period.
- Tests: the decision engine has a test per trap case and per rule; the full suite runs in pre-commit; one Playwright happy path on the deployed URL.

## Scope: out (explicitly)
- Moving money, any payment API, Blinka integration, opening accounts, KYB/identity, compliance or fraud decisions, Blinka app design (challenge list).
- Multiple roles/permissions: one user per company is both operator and approver in the demo.
- Live FX rates from an external source (rate is a policy rule).
- AWS at runtime (Textract, SES, S3, DynamoDB): see Stack.
- Chat integrations (WhatsApp/Slack bots): chat ingestion is paste-only.
- Editing or deleting decisions.

## Product decisions
- D1: Three outcomes only: PAGAR, FRENAR (final, with reason), ESCALAR (waits for a human). Human answers are events appended to the record.
- D2: PAGAR is produced only by the pure decision function when every check is PASS. No prompt, model or JEV answer can write PAGAR. This is the disqualification guard.
- D3: Hard rules (limits, budget, allowed accounts, exact duplicate, due date, FX conversion) are code. JEV handles judgments (classification, matching, soft duplicate, reading reliability) with thresholds and an unknown path. LLM handles reading only.
- D4: Allowed beneficiary means name AND bank account on file. Same name with a different account escalates ("cuenta cambiada").
- D5: Period limit counts PAID + pending ESCALATED, evaluated in arrival order; the invoice that would exceed the budget escalates.
- D6: FX rates are a fixed table in the policy, printed in every record that used one.
- D7: Explanations come from templates filled with real values, in es and en. An optional AI summary is labeled as such and never replaces the template.
- D8: Every signup gets its own seeded workspace; `/demo` is a public read-only view of the seed company so judges can watch without an account. Live interaction (create a trap invoice, change a rule) needs an account.
- D9: OTP mail goes through Resend as Supabase custom SMTP. Until Roberto verifies a sending domain in Resend (optional, browser, ~5 min), Resend delivers only to HEARTBEAT_EMAIL, so only Roberto's account can sign up; the recorded happy path and `/demo` cover the judges. No MUST AC depends on the domain.
- D10: Decision records and events are append-only, enforced by RLS (no UPDATE/DELETE policies on those tables).
- D11: Escalation links are single-use signed tokens with expiry; the approval screen requires the token or a logged-in session of the same company.
- D12: Live inbound mailbox (Cloudflare Email Routing -> Email Worker -> same reader) is SHOULD: the Worker is built and tested with `.eml` fixtures; it goes live only if Roberto adds a domain to Cloudflare. Paste/upload is the MUST path.
- D13: Duplicate detection: exact (beneficiary + invoice number) is a hard FRENAR; soft (same beneficiary, amount within 1%, date within the policy window, different number) is a JEV judgment that escalates.
- D14: Spanish is the default language of the UI and the demo; English is a first-class switch, not a translation afterthought.

## Mentor feedback incorporated
- (none yet)

## Check-in cadence
Roberto reads heartbeat emails every ~5 hours and checks the phone between sessions of the other hackathon. He never runs commands. Deadline: 2026-10-18T12:00-05:00 (docs/CONTEXT.md).
