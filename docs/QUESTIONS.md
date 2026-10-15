# Open questions for Roberto

Agents append here only under the confusion protocol. Roberto answers inline and moves resolved items to DECISIONS.md.

## From product at plan time (15 Oct 2026). Each has a provisional ruling in docs/SPEC.md "Product rulings at plan time"; it stands until Roberto overrules.

- Q-01 (missing company context): What should happen to a CSV row whose telefono cannot be turned into a +57 number? Provisional R-01: skip it with "Teléfono inválido", like a missing phone (D2).
- Q-02 (data model): How do brands write `valor` (45.000 / $45.000 / 45000,00)? Provisional R-02: strip $ and thousand dots; non-integer or unparseable rows are skipped with "Valor inválido". Never guess money.
- Q-03 (destructive scope): Can the dispatcher reassign an `entregado` delivery? Provisional R-03: no, D3 only lists asignado and fallido; API returns 409.
- Q-04 (destructive scope): Can a courier correct a delivery after marking it? Provisional R-04: no; Carolina reopens it via reassign.
- Q-05 (missing company context): Does the end-of-day "pendiente" count include `asignado`? Provisional R-05: yes, pendiente = not entregado and not fallido, so counts add up to the day's total.
- Q-06 (missing company context): Demo Day (19-20 Oct) is after the build day; how does /demo keep "today's" data? Provisional R-06: `npm run seed` re-dates demo data to today; no public reseed endpoint.
- Q-07 (missing company context): Do the brands' CSVs use comma or semicolon? Provisional R-07: accept both; UTF-8 with or without BOM; import always targets today's Bogotá date.
- Q-08 (missing company context): Exact seed mix for "mixed statuses"? Provisional R-08: 2 pendiente, 4 asignado, 4 entregado, 2 fallido.
- Q-09 (data model): Does `otro` need a free-text explanation? Provisional R-09: no free text this build; idea goes to IDEAS.md.
- Q-10 (missing company context): Evaluation rubric not yet in CONTEXT.md. Provisional R-10: ACs prioritised by company need until it is pasted.
