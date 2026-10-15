# Spec: Rutas del Norte, despacho de domicilios (DRY RUN)

Written by `product` from `docs/CONTEXT.md`, `docs/PROBLEM.md`, `docs/DECISIONS.md` and the CLAUDE.md demo requirements. Nothing here reinterprets those files; gaps are ruled at the bottom and logged in `docs/QUESTIONS.md`.

Format: `AC-NN [MUST|SHOULD]: When <situation>, the system <observable behaviour>. Evidence: <what a tester runs or clicks>. [trace]`

Rubric: `docs/CONTEXT.md` has no evaluation rubric yet (placeholder `<paste here>`). Until Roberto pastes it, every AC is justified by company need ("we could run this on Monday", CONTEXT.md) and its trace. When the rubric arrives, product adds a rubric line per AC; no AC is added or removed for that.

Order of work: all MUST in dependency order (auth -> CSV -> board -> courier -> end-of-day -> demo/deploy). SHOULD only after every MUST has passed QA.

## Shared values testers check against

- Routes (D6): dispatcher `/`, courier `/mensajero`, demo `/demo`, API `/api/*`. One Worker, one URL.
- CSV columns (PROBLEM): `pedido, cliente, telefono, direccion, barrio, valor`.
- Statuses (D3): `pendiente`, `asignado`, `entregado`, `fallido`.
- Failure reasons (Scope): shown in the UI as `no estaba`, `dirección errada`, `rechazado`, `otro`; the API stores and accepts the codes `no_estaba`, `direccion_errada`, `rechazado`, `otro` (R-11).
- API routes (R-11): status change is `PATCH /api/deliveries/<id>/status`, assign is `PATCH /api/deliveries/<id>/assign`. Wherever an AC evidence line says `PATCH /api/deliveries/<id>`, read it as the `/status` route (or `/assign` for AC-13/14).
- CSV skip reasons and the end-of-day summary are returned by the API as codes (`falta_telefono`, `falta_direccion`, `duplicado`, `telefono_invalido`, `valor_invalido`) and separate `pendiente` / `asignado` counts; the UI shows the Spanish texts and the summed pendiente count (R-05, R-11).
- "Today" (D4): the current date in America/Bogota (UTC-5, no DST), not the server's UTC date.
- Phones (D5): stored E.164 `+57XXXXXXXXXX`. Money (D5): COP integer, shown es-CO without decimals, e.g. `$ 45.000`. Dates (D5): shown `dd/mm/yyyy`.
- UI copy is Spanish (PROBLEM constraints, CONTEXT). Code and commits in English.
- Demo seed (Scope): 2 couriers, 1 dispatcher, 12 deliveries dated today: 2 `pendiente`, 4 `asignado`, 4 `entregado`, 2 `fallido` (one `no estaba`, one `dirección errada`). Seed counts are fixed so testers can verify numbers (ruling R-08).

## 1. Auth and access

AC-01 [MUST]: When the dispatcher opens `/` without a session, the system shows a Spanish email + password login form with no sign-up link; valid dispatcher credentials open the dispatcher board, and a wrong password shows "Correo o contraseña incorrectos" and stays on the login form. Evidence: open `/` in an incognito window, try the demo dispatcher with a wrong password, then the right one. [D1, D6]

AC-02 [MUST]: When a courier logs in at `/mensajero`, the system shows that courier's list for today; when a courier session opens `/`, the system redirects to `/mensajero` and never shows the dispatcher board; when a dispatcher session opens `/mensajero`, the system redirects to `/`. Evidence: log in with each demo account and visit both routes. [D1, D6]

AC-03 [MUST]: When any `/api/*` endpoint that reads or changes deliveries, couriers or imports is called without a valid session token, the system returns HTTP 401 and no data. Evidence: `curl -i <URL>/api/deliveries` and `curl -i -X POST <URL>/api/import/confirm` with no Authorization header both print `401`. [D1; CLAUDE.md "never cut auth"]

AC-04 [MUST]: When a courier's token calls a dispatcher endpoint (CSV preview/confirm, list all deliveries, assign/reassign, end-of-day summary, list couriers), the system returns HTTP 403 and changes nothing. Evidence: obtain the demo courier token (login via API or browser devtools) and `curl -i` each dispatcher endpoint with it; each prints `403`; the board is unchanged afterwards. [D1; CLAUDE.md "never cut auth"]

AC-05 [MUST]: When courier A reads or updates the status of a delivery assigned to courier B, the system returns HTTP 403 and the delivery is unchanged; courier A's list never contains courier B's deliveries. Evidence: with courier A's token, `curl -i -X PATCH <URL>/api/deliveries/<id of a courier B delivery>` with `{"status":"entregado"}` prints `403`; reload the dispatcher board and the delivery still shows its prior status. [D1, Scope "see my deliveries"]

AC-06 [MUST]: When anyone queries any table in the `public` schema directly with the Supabase anon key, the system returns no rows, because every table has Row Level Security enabled from its first migration. Evidence: in Supabase SQL editor run `select tablename, rowsecurity from pg_tables where schemaname='public';` and every row shows `true`; `curl "<SUPABASE_URL>/rest/v1/deliveries?select=*" -H "apikey: <anon key>"` returns `[]`. [CLAUDE.md Infrastructure "Every table has RLS on"]

## 2. CSV import (dispatcher)

AC-07 [MUST]: When the dispatcher uploads a CSV with header `pedido,cliente,telefono,direccion,barrio,valor` (header names case-insensitive, comma or semicolon delimiter, UTF-8 with accents), the system shows a preview listing the valid rows and a separate list of skipped rows with their row number and reason, and writes nothing until the dispatcher clicks "Confirmar"; after confirming, the valid rows appear on the board as `pendiente` with today's Bogotá date. Evidence: upload `docs/demo/pedidos-ejemplo.csv` (committed fixture), reload the board before confirming (no new rows), click "Confirmar", reload (rows present, status `pendiente`). [Scope "preview-then-confirm", D2, D3, D4]

AC-08 [MUST]: When a CSV row is missing `telefono` or `direccion`, the system lists it in the preview as skipped with reason "Falta teléfono" or "Falta dirección" and still imports every valid row on confirm. Evidence: upload a fixture with 5 valid rows plus 1 row without telefono and 1 without direccion; preview shows 5 valid and 2 skipped with those reasons; confirm imports exactly 5. [D2]

AC-09 [MUST]: When a CSV row has a `pedido` that already exists for today, or repeats within the same file, the system lists it as skipped with reason "Pedido duplicado" and imports only the first occurrence. Evidence: confirm a fixture, then upload the same file again: preview shows 0 valid rows and all rows skipped as "Pedido duplicado". [D2]

AC-10 [MUST]: When a CSV row's `telefono` is `3001234567`, `573001234567`, `+57 300 123 4567` or `300-123-4567`, the system stores `+573001234567`; when the phone cannot be normalised to a 10-digit Colombian number, the row is skipped with reason "Teléfono inválido". When `valor` is `45000`, `45.000` or `$45.000`, the system stores `45000`; when it is not a whole COP amount, the row is skipped with reason "Valor inválido". Evidence: upload the fixture `docs/demo/pedidos-formatos.csv` covering these cases and check the preview; unit tests for the normaliser pass in `npm test`. [D5; ruling R-01, R-02]

AC-11 [MUST]: When the uploaded file is not a CSV or lacks any of the six required columns, the system shows a Spanish error naming the missing columns (e.g. "Faltan columnas: barrio, valor"), shows no "Confirmar" button and imports nothing. Evidence: upload a CSV without `barrio` and `valor`; read the message; board unchanged. [PROBLEM constraints "columns", D2; CLAUDE.md "never cut validation"]

## 3. Dispatcher board

AC-12 [MUST]: When the dispatcher is logged in at `/`, the system shows today's Bogotá date as `dd/mm/yyyy` and a table of only today's deliveries with pedido, cliente, telefono, direccion, barrio, valor (as `$ 45.000`), status, courier and failure reason; deliveries from other dates are not shown. Evidence: log in after the demo seed; the board shows the 12 seeded deliveries with those columns; a delivery inserted with yesterday's date (seed or SQL) does not appear. [Scope "see today's deliveries", D4, D5]

AC-13 [MUST]: When the dispatcher picks a courier for a `pendiente` delivery, the system sets it to `asignado` with that courier's name, and it persists after reload. Evidence: on the board, choose "Mensajero 1" for a `pendiente` row, reload, see `asignado` / "Mensajero 1". [Scope "assign", D3]

AC-14 [MUST]: When the dispatcher reassigns an `asignado` or `fallido` delivery to another courier, the system sets it to `asignado` with the new courier, clears the failure reason, removes it from the old courier's `/mensajero` list and shows it on the new courier's list; an `entregado` delivery shows no reassign control and the API returns HTTP 409 if asked to reassign it. Evidence: reassign one seeded `fallido` and one seeded `asignado` delivery, then log in as each courier; `curl -i -X PATCH` the assign endpoint on an `entregado` id with the dispatcher token prints `409`. [D3, PROBLEM constraint "reassign during the day"; ruling R-03]

AC-15 [SHOULD]: When the dispatcher types a `pedido` number in the board's search box, the system shows only matching deliveries for today, so Carolina can answer a brand's customer-service question without opening any chat. Evidence: type a seeded pedido; only that row remains. [PROBLEM "customer-service person asks for the status of one order"]

## 4. Courier (phone)

AC-16 [MUST]: When a courier is logged in at `/mensajero` on a 360 px wide phone viewport, the system shows only that courier's deliveries for today (status `asignado`, `entregado` or `fallido`), each with pedido, cliente, telefono as a tap-to-call `tel:+57...` link, direccion, barrio, valor and status, with no horizontal scrolling. Evidence: Chrome devtools device mode 360x740, log in as demo courier 1, count rows against the board filtered to that courier; tap a phone link and see the dialer prompt. [Scope "Courier web (phone)", PROBLEM "cheap Android phones", D5]

AC-17 [MUST]: When a courier taps "Entregado" on an `asignado` delivery and confirms, the system marks it `entregado` and the dispatcher board shows `entregado` after reload. Evidence: do it on the phone viewport, then reload `/` as dispatcher. [Scope, D3]

AC-18 [MUST]: When a courier taps "Fallido", the system requires choosing exactly one reason from `no estaba`, `dirección errada`, `rechazado`, `otro` before saving, marks the delivery `fallido` and the dispatcher board shows that reason; the API returns HTTP 400 for `fallido` with a missing or unknown reason. Evidence: try to save without a reason (blocked), pick `rechazado`, save, reload dispatcher board; `curl -i -X PATCH` with `{"status":"fallido","reason":"lluvia"}` prints `400`. [Scope reasons, D3]

AC-19 [MUST]: When a delivery is already `entregado` or `fallido`, the courier sees no status buttons on it and the API returns HTTP 409 if the courier tries to change it; only the dispatcher's reassign (AC-14) reopens it. Evidence: on the phone viewport, a marked delivery has no buttons; `curl -i -X PATCH` with the courier token on that id prints `409`. [D3; ruling R-04]

## 5. End of day

AC-20 [MUST]: When the dispatcher opens "Cierre del día" on `/`, the system shows today's counts of `entregado`, `fallido` and `pendiente` (where `pendiente` counts every delivery not yet `entregado` or `fallido`, i.e. `pendiente` + `asignado`), the three counts sum to today's total, and below them the list of `fallido` deliveries with pedido, cliente, direccion, courier and reason. Evidence: right after the demo seed the screen reads entregado 4, fallido 2, pendiente 6, and lists 2 failed deliveries with reasons `no estaba` and `dirección errada`; mark one more fallido as a courier and the numbers become 4 / 3 / 5. [Scope "End-of-day view", PROBLEM "a las 6pm vea en una sola pantalla"; ruling R-05]

AC-21 [SHOULD]: When the dispatcher picks a past date in "Cierre del día", the system shows that date's counts and failed list, proving history stays in the database. Evidence: insert or seed a delivery dated yesterday, pick yesterday's date, see it counted. [D4 "history stays in the database"]

## 6. Demo, README, deploy

AC-22 [MUST]: When anyone opens the deployed Cloudflare Worker URL in a clean incognito window, `/`, `/mensajero` and `/demo` load over HTTPS with no setup, and the URL is printed in README. Evidence: open the three routes from the README link in a fresh incognito window. [D6; CLAUDE.md demo requirements; CONTEXT "deployed URL must work on a shared screen"]

AC-23 [MUST]: When anyone opens `/demo`, the system shows (without login) in Spanish: what the product does in two sentences, the demo dispatcher and both courier credentials, links to `/` and `/mensajero`, and today's seeded counts; those credentials log in successfully and show the seed described above (2 couriers, 12 deliveries: 2 pendiente, 4 asignado, 4 entregado, 2 fallido). Running `npm run seed` resets only the demo accounts' deliveries to that state dated today. Evidence: open `/demo`, copy each credential, log in; run `npm run seed` and reload the board. [Scope "/demo page", D1; ruling R-06]

AC-24 [MUST]: When a non-technical decision maker opens `README.md`, the first 10 lines explain in Spanish what problem Rutas del Norte had and what the product does, and the file contains sections: the problem in the company's words (Carolina's quote), what was built, how to run locally, how to deploy, demo credentials and deployed URL, and what is not done. Evidence: read README; each section heading is present and the "no hecho" list is honest (includes every SHOULD not shipped). [CLAUDE.md demo requirements, CONTEXT "README in first 10 lines", D1]

AC-25 [MUST]: When a non-engineer opens `docs/LEDGER.md`, every product ruling (including R-01..R-08 below) and every debate (builder position, reviewer position, ruling, loser's best argument) is present in plain language. Evidence: for each R-xx below and each disputed finding in the run, find its ledger entry. [CLAUDE.md demo requirements]

AC-26 [MUST]: When the run finishes, `docs/demo/happy-path.webm` exists, recorded by a committed Playwright script against the deployed URL, showing Carolina's workflow start to finish: dispatcher logs in, uploads a CSV, sees the preview with a skipped row, confirms, assigns deliveries to a courier; courier logs in on a phone viewport, marks one `entregado` and one `fallido` with a reason; dispatcher opens "Cierre del día" and sees the counts and the failed reason. Evidence: play the video; run the script command named in README and it produces the file again. [CLAUDE.md "one recorded happy path"; PROBLEM "What working means on Monday"]

AC-27 [MUST]: When a developer runs `npm run lint`, `npm run typecheck` and `npm test` on `main`, all three exit 0, and the tests cover AC-03..AC-05, AC-07..AC-11, AC-14, AC-18..AC-20. Evidence: run the three commands on a fresh clone after `npm ci`. [CLAUDE.md Code rules "lint, typecheck and test scripts", "never cut tests"]

## 7. SHOULD: email

AC-28 [SHOULD]: When the clock reaches 18:00 America/Bogota (Worker cron `0 23 * * *` UTC), the system emails the dispatcher (address from the dispatcher's profile) a Spanish summary with subject "Cierre del día dd/mm/yyyy", the entregado / fallido / pendiente counts and the failed list with reasons, sent only through `src/lib/email.ts` (Resend). Evidence: `wrangler.toml` shows the cron; a test invokes the scheduled handler with the email helper mocked and asserts recipient, subject and counts; on the deployed Worker, trigger the cron once (`wrangler` dev `--test-scheduled` or dashboard) and the email arrives. [Scope SHOULD line; CLAUDE.md "email through src/lib/email.ts"]

## Count

28 ACs: 25 MUST, 3 SHOULD (AC-15, AC-21, AC-28). Cut order if time runs out: AC-28, then AC-21, then AC-15.

## Product rulings at plan time

The orchestrator copies these into `docs/LEDGER.md`. Each matches an item in `docs/QUESTIONS.md`. Principle named per ruling. Roberto may overrule; until then they stand.

- R-01 (phone format, completeness): PROBLEM and D5 require E.164 +57 but do not say what to do with an unparseable phone. Ruling: accept 10-digit numbers starting with 3 (mobile) or 60 (landline), optionally prefixed by `57` or `+57`, ignoring spaces, dashes, dots and parentheses; anything else is skipped as "Teléfono inválido", same treatment as a missing phone under D2. Reason: storing a number a courier cannot call is worse than listing it for Carolina to fix.
- R-02 (valor format, company-can-deploy-Monday): D5 says COP without decimals but not how brands write it. Ruling: strip `$`, spaces and `.` thousand separators; the result must be a non-negative integer, otherwise skip with "Valor inválido". A `,` decimal part (e.g. `45.000,00`) with only zeros is accepted; non-zero decimals are invalid. Reason: never guess money.
- R-03 (entregado cannot be reassigned, scope): D3 lists only `fallido` and `asignado` as reassignable. Ruling: `entregado` is final for everyone; API returns 409.
- R-04 (courier cannot change a marked delivery, conservative default): Not stated. Ruling: once `entregado` or `fallido`, the courier cannot change it; the dispatcher reopens via reassign (D3). Reason: keeps one person (Carolina) accountable for corrections; avoids silent edits to the end-of-day count.
- R-05 (meaning of "pendiente" in end-of-day counts, evidence): Scope asks for counts of entregado / fallido / pendiente, but `asignado` is also an open status. Ruling: the end-of-day `pendiente` count includes both `pendiente` and `asignado`, so the three numbers always add up to the day's total. That matches "qué quedó pendiente" in Carolina's words.
- R-06 (keeping /demo data on "today", company-can-deploy-Monday): The seed must show today's deliveries but Demo Day is days after the build. Ruling: `npm run seed` (idempotent, touches only demo accounts and their deliveries) re-dates the demo data to today's Bogotá date; it is run before Demo Day and documented in README. No public endpoint reseeds data (an anonymous write endpoint is a security hole).
- R-07 (CSV delimiter, company-can-deploy-Monday): PROBLEM says CSV but Colombian Excel exports usually use `;`. Ruling: accept `,` and `;` (detected from the header line), UTF-8 with or without BOM. Upload target date is always today's Bogotá date; no date picker on import.
- R-08 (exact seed mix, evidence): Scope says "mixed statuses" only. Ruling: 2 pendiente, 4 asignado, 4 entregado, 2 fallido (one `no estaba`, one `dirección errada`), split across both couriers, so testers can check exact numbers.
- R-11 (API contract vs UI wording, Task 5 QA, scope/Monday): API routes are `/:id/status` and `/:id/assign`; API uses snake_case codes for failure reasons, CSV skip reasons, and separate pendiente/asignado counts; Spanish wording and the R-05 sum apply at the UI level (Task 6 owns the mapping and must be tested there). Loser's best argument (SPEC literal wording): "testers read the evidence lines verbatim and the API should return the exact Spanish strings and the summed pendiente." Rejected: no user sees the API; the UI AC check is where wording is verified. Seed: `npm run seed` must also delete today's Bogotá-dated deliveries (all of them, demo flows and CSV imports) before inserting, so the AC-20/R-08 counts are exact; owner Task 8, SHOULD-risk none, it is MUST because R-08 numbers are tested.
- R-09 (`otro` reason detail, scope): Scope lists four reasons with no free text. Ruling: no free-text note in this build; `otro` is stored as-is. A note field goes to `docs/IDEAS.md` if a builder wants it.
- R-10 (missing rubric, scope): CONTEXT.md has no rubric yet. Ruling: no rubric lines on ACs; MUST/SHOULD decided by company need and the CLAUDE.md demo requirements.
