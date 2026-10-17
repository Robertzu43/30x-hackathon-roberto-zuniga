# Open questions for Roberto

Agents append here only under the confusion protocol. Roberto answers inline and moves resolved items to DECISIONS.md.

## 16 Oct, product (SPEC.md); each has a provisional ruling in docs/SPEC.md and the ledger
- Q1 (data model, D17): Does "Autonomía" count correct escalations, or only invoices the agent closed alone (PAGAR/FRENAR)? And is it measured on the first agent decision or the latest? Provisional (R-01): only PAGAR/FRENAR matching `expected_outcome`, on each seeded invoice's first agent decision, so approvals and live rule changes never show as violations.
- Q2 (missing company context, S-Policy): what does the "duplicate window" bound? Provisional (R-06): the look-back of the exact-duplicate check (same beneficiary + same number). Should duplicates be caught at any age instead?
- Q3 (missing company context, S-Escalation): may a human approve a payment that exceeds the period budget, the account balance or the per-payment limit? Provisional (R-21): no; they change the policy (new version) and re-evaluate.
- Q5 (architecture, S-Auth vs D2; 17 Oct, QA on Task 2): with the public demo login, a member could write a PAGAR outside the rules straight into the database through Supabase REST. Closing that means the Worker writes decisions, approval tokens/uses and agent runs with the service-role client from one more module (`src/agent/record.ts`), beyond S-Auth's "one module used by one handler" (already widened to the cron by R-23). Provisional (R-32, R-33): yes. Members lose write access to those four tables, and the database refuses any PAGAR whose checks break the rules. Is that acceptable?
- Q4 (data model, S-DataSet): "COP invoice whose USD equivalent exceeds the limit": the per-payment limit (FRENAR) or the approval threshold (ESCALAR, as PLAN seeds it)? Provisional (R-07): per-payment limit, threshold case kept as an extra.
