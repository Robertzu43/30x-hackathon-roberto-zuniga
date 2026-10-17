# UX QA, run 1 (Task 28, D31, AC-82, AC-91)

Run r202610162341. Target: the deployed finance app https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev on 17 Oct 2026 (current product, before the D28-D35 screens). Chromium (/opt/pw-browsers/chromium), demo access ("Entrar como Andina Labs"), 1440 x 900 and 390 x 844, es and en, plus the gate harness at all five widths. Nothing was sent to the deployed data: no `--mutate`, no "Reiniciar demo", no "Ejecutar agente", no new invoice, no Save.

Screens covered: login, tour, inbox, new-invoice (file, email, chat), detail-pagar, detail-frenar, detail-escalar, policy, beneficiaries, period, approve (invalid token), demo, and the inbox / beneficiaries / period empty, error and offline states.
Not covered (not deployed or outside the brief): `ask`, the whole vendor experience (`portal`, `portal-reply`, `portal-error`, `status`, `status-invalid`), every D28-D35 screen. `detail-unread` could not be tested (see Harness notes).

Gate run: `npm run ux:gate -- --base <url> --screens login,tour,inbox,new-invoice,detail-pagar,detail-frenar,detail-escalar,detail-unread,policy,beneficiaries,period,approve,demo` finished with `UX GATE FAILED: 165 items`, exit 1. The full table is kept as `docs/ux/qa/gate-finance-qa-run1.md` (the 240 gate screenshots were not kept; the ones that evidence a finding are in `docs/ux/qa/`).

Status of every entry: open. Source: "hands" = seen by hand in Chromium, "gate" = measured by the harness only, "both".

## Index

| Id | Screen | Width | Lang | Category | Severity | Source | Status |
|---|---|---|---|---|---|---|---|
| UX-01 | inbox | 1440, 390 | en | confusing copy | high | both | open |
| UX-02 | detail-pagar / frenar / escalar | 1440, 390 | en | confusing copy | high | both | open |
| UX-03 | tour (step 1) | 390 | es, en | broken state | medium | hands | open |
| UX-04 | every screen | all | es, en | broken state | medium | gate | open |
| UX-05 | every screen | 390 (and 360) | es, en | broken state | medium | both | open |
| UX-06 | inbox, new-invoice, policy, beneficiaries, period, detail-escalar | 390 (and 360) | es, en | broken state | medium | gate | open |
| UX-07 | every screen | all | es, en | broken state | medium | both | open |
| UX-08 | inbox, new-invoice | 390, 1440 | es, en | layout jump | medium | both | open |
| UX-09 | policy | 390, 1440 | es, en | layout jump | medium | both | open |
| UX-10 | policy | 360 | es, en | broken state | low | both | open |
| UX-11 | detail-frenar | 1440, 390 | es, en | broken state | low | both | open |
| UX-12 | detail-frenar | 768 | es | layout jump | low | gate | open |
| UX-13 | period (error and offline) | 1440, 390 | es, en | broken state | high | both | open |
| UX-14 | period, beneficiaries (empty) | 1440, 390 | es, en | broken state | low | both | open |
| UX-15 | beneficiaries (Editar) | 1440, 390 | es, en | loading without feedback | medium | hands | open |
| UX-16 | policy, beneficiaries (Save buttons) | 390 | es | loading without feedback | low | gate | open |
| UX-17 | approve (invalid token) | 1440, 390 | es, en | confusing copy | medium | both | open |
| UX-18 | detail (unknown invoice) | 1440, 390 | es, en | broken state | low | both | open |
| UX-19 | period, beneficiaries, new-invoice | 1440, 390 | es | confusing copy | low | hands | open |
| UX-20 | new-invoice (file tab) | 1440, 390 | es, en | confusing copy | low | hands | open |
| UX-21 | inbox, tour, demo, detail-escalar | all | es, en | broken state | low | gate | open |
| UX-22 | period | 390 | es, en | broken state | medium | gate | open |
| UX-23 | inbox with the new-invoice form open | 390, 1440 | es, en | confusing copy | low | hands | open |
| UX-24 | policy | 1440, 390 | es, en | confusing copy | low | hands | open |

## Entries

### UX-01 Inbox shows Spanish sentences and mixed badges on the English screen
- Screen: inbox. Width: 1440 and 390. Language: en.
- Steps: open /demo, click "English", then "Sign in as Andina Labs", skip the tour, look at the inbox list.
- Expected: one language per screen: the row text, the badge and the date all in English (AC-91 item 5).
- Actual: the badge says "STOP" / "PAY" / "ESCALATE" but the row text next to it says "FRENAR · 10.000 BRL a Ana Souza: duplicado exacto de la factura #AS-0087 y 1 motivo más", "PAGAR · 160 USD a Northstar Group, horas de octubre, dentro de reglas". Amounts use Spanish separators ("10.000 BRL"). Gate: 5.mixed finds 31 Spanish-dictionary strings and 5.locale 29 numbers not in en-US, in 5 of 10 cells (all en).
- Note: the sentences are stored data written in Spanish. AC-91 item 5 excepts "stored seed data", so product must rule whether this is a defect; as a user on the en screen it reads as a half-translated product.
- Screenshot: docs/ux/qa/inbox-1440-en.png
- Category: confusing copy. Severity: high. Status: open.

### UX-02 Decision detail pages are in Spanish on the English screen
- Screen: detail-pagar, detail-frenar, detail-escalar. Width: 1440 and 390. Language: en.
- Steps: switch to en, open any invoice from the inbox.
- Expected: headings and the whole record ("What I did", "What I decided") in English.
- Actual: headings and labels are English ("What I did", "What I read", "READ", "CHECK", "DECIDE") but the content is Spanish: the title "ESCALAR · 640 USD a Lumbrera Estudio Grafico S.A.S.: beneficiario nuevo...", the steps "Leí el correo y encontré a...", "Verifiqué 13 reglas: 9 cumplen, 2 no cumplen", "Decidí ESCALAR: ...", and every rule line ("Beneficiario permitido: ... → no cumple"). Gate 5.mixed: 33, 35 and 37 Spanish strings on the three details.
- Note: same stored-data cause and the same ruling question as UX-01. A visitor who picks English sees Spanish in the main part of the product.
- Screenshot: docs/ux/qa/detail-escalar-1440-en.png
- Category: confusing copy. Severity: high. Status: open.

### UX-03 Tour step 1 covers the thing it points at on a phone
- Screen: tour, step "1 de 7 / 1 of 7 Bandeja / Inbox". Width: 390 (1440 is fine). Language: es and en.
- Steps: at 390 x 844 sign in as the demo user; the tour opens by itself.
- Expected: the card does not hide the highlighted area.
- Actual: the card (es: y 407 to 812) sits on top of the highlighted block (es: y 300 to 644), so "Nueva factura" and "Ejecutar agente" are cut in half behind the card and the highlight is mostly hidden. en: card y 432 to 812, highlight y 258 to 538, the same overlap. Steps 2 to 7 do not overlap.
- Screenshot: docs/ux/qa/tour-step1-390-es.png
- Category: broken state. Severity: medium. Status: open.

### UX-04 No logo on any screen
- Screen: login, tour, inbox, new-invoice, details, policy, beneficiaries, period, approve, demo (and their states). Width: all five. Language: es and en.
- Steps: run the gate; look at any screen.
- Expected: the logo is visible (AC-91 item 6, AC-80).
- Actual: gate 6.logo fails in 10 of 10 cells on every screen: "no [data-logo], logo-labelled element or logo image". The header is the plain word "Thesaurus".
- Note: AC-80 belongs to the D28-D35 work that is not deployed yet; listed so it is not forgotten.
- Screenshot: docs/ux/qa/inbox-390-es.png
- Category: broken state. Severity: medium. Status: open.

### UX-05 Touch targets under 44 px on a phone
- Screen: every screen with the top bar, the login and the demo. Width: 390 (gate also 360). Language: es and en.
- Steps: 390 x 844, measure interactive elements (gate 2.targets plus `getBoundingClientRect`).
- Expected: every interactive element at least 44 x 44 (AC-91 item 2).
- Actual (hands, 390): the section links "Bandeja / Política / Beneficiarios / Periodo" are 22 px tall; the "es" and "en" buttons are 42 x 44; "Nueva factura" 32 px tall; the filter selects 37 px; "Editar" 32 px; "Volver a la bandeja" 22 px; "Abrir el documento" 20 px. On login and /demo the "Español" / "English" links are 22 px tall and "Ver el recorrido en video" 26 px. Gate: 7 to 16 failing targets per logged-in screen, 2 to 3 on login and demo, 4 of 4 cells each.
- Screenshot: docs/ux/qa/login-390-en.png, docs/ux/qa/inbox-390-es.png
- Category: broken state. Severity: medium. Status: open.

### UX-06 Form fields use 14 px text on a phone
- Screen: inbox filters, new-invoice (email and chat textarea), policy (17 fields), beneficiaries form (7), period month field, detail-escalar field. Width: 390 (gate also 360). Language: es and en.
- Steps: gate 2.inputs; the computed font-size of each field.
- Expected: at least 16 px so iOS does not zoom the page when a field is tapped (AC-91 item 2).
- Actual: every field is 14 px ("17 of 17 inputs under 16 px" on policy, "7 of 7" on the beneficiaries form, "3 of 3" on new-invoice email and chat).
- Screenshot: docs/ux/qa/new-invoice-file-390-en.png
- Category: broken state. Severity: medium. Status: open.

### UX-07 Grey helper text fails the contrast rule
- Screen: every screen (tagline, user email, hints, labels). Width: all. Language: es and en.
- Steps: gate 3.axe and 3.contrast; contrast calculated from the approved colours.
- Expected: axe reports no serious violation; text 4.5:1 (AC-91 item 3).
- Actual: axe `color-contrast` (serious) on 10 of 10 cells of every screen, 7 to 66 elements per page (".topbar > .muted", "header > .muted"). The grey #787774 measures 4.48:1 on white, 4.32:1 on the page background #fbfbfa and 3.89:1 on #f1efe9. Because the palette is frozen (AC-53, AC-81) this needs a product ruling, not a quiet colour change.
- Screenshot: docs/ux/qa/inbox-390-es.png
- Category: broken state. Severity: medium. Status: open.

### UX-08 Inbox list jumps when the data arrives
- Screen: inbox and the three new-invoice tabs. Width: 390 and 1440. Language: es and en.
- Steps: sign in, open /; I measured layout shift with a PerformanceObserver on a reload.
- Expected: shift 0.01 or less, space reserved (AC-91 item 4).
- Actual: 390 es 0.0337, 390 en 0.0397 (gate: 0.0397, 9 of 12 cells), 1440 0.0070. While loading, only "Loading invoices..." is shown and the "Beneficiario" filter is narrower than after load, then the list pushes the page.
- Screenshot: docs/ux/qa/inbox-390-es.png (loaded state)
- Category: layout jump. Severity: medium. Status: open.

### UX-09 Policy page jumps when it loads
- Screen: policy. Width: 390 and 1440. Language: es and en.
- Steps: open /policy from the menu or by URL.
- Expected: shift 0.01 or less.
- Actual: gate 0.0891 at 390/es (6 of 12 cells fail); by hand 0.0348 at 1440/en.
- Screenshot: none (a shift is not visible in a still); numbers above.
- Category: layout jump. Severity: medium. Status: open.

### UX-10 Policy scrolls sideways at 360
- Screen: policy. Width: 360 (AC-91 width; 390 is fine). Language: es and en.
- Steps: 360 x 800, open /policy.
- Expected: `scrollWidth <= innerWidth`.
- Actual: scrollWidth 364 vs 360; the title, intro and three cards end at x = 364. Gate 1.scroll and 1.offscreen fail in 2 of 10 cells.
- Screenshot: docs/ux/qa/policy-360-es.png
- Category: broken state. Severity: low. Status: open.

### UX-11 "Abrir el documento" is a default blue link
- Screen: detail-frenar (and any detail with a document). Width: 1440, 390. Language: es and en.
- Steps: open an invoice that has a file, look under the document preview.
- Expected: the link uses the product's colours.
- Actual: browser-default blue #0000ee, underlined, the only blue on the page (gate 6.palette, 10 of 10 cells).
- Screenshot: docs/ux/qa/detail-frenar-1440-es.png
- Category: broken state. Severity: low. Status: open.

### UX-12 Document image shifts the detail page at 768
- Screen: detail-frenar. Width: 768 (AC-91 width, outside the two hands-on widths). Language: es.
- Steps: gate.
- Expected: reserved space; image sharp.
- Actual: gate 4.cls 0.0367 at 768/es (2 of 12 cells); gate 6.images: the preview is 860 px wide shown at 704 px (not 2x).
- Screenshot: none.
- Category: layout jump. Severity: low. Status: open.

### UX-13 Period error and offline show raw technical text and no next step
- Screen: period, forced error and offline. Width: 1440 and 390. Language: es and en.
- Steps: open /period; go offline in the browser, open Periodo from the menu. For the error, the gate makes the data request answer 500.
- Expected: a designed message with a next step, in the chosen language (AC-91 item 4, 5), like the inbox has ("No pude cargar las facturas. Recarga la página para intentar de nuevo.").
- Actual: offline shows "Failed to fetch" (English browser text, also on the es screen) under the month field, nothing else. Error shows only the raw server text ("gate" in the forced test) with no retry. Gate: 4.state fails for period-error and period-offline, 5.words "Failed to fetch". The inbox and beneficiaries error and offline states pass.
- Screenshot: docs/ux/qa/period-offline-390-es.png, docs/ux/qa/period-offline-1440-en.png, docs/ux/qa/period-error-390-es.png
- Category: broken state. Severity: high. Status: open.

### UX-14 Empty states without a next step
- Screen: period (no invoices) and beneficiaries (no beneficiaries). Width: 1440 and 390. Language: es and en.
- Steps: the gate answers the lists with empty data.
- Expected: a message and a next step (AC-91 item 4).
- Actual: period shows zeros, dashes and "No payments this month." with nothing to do next; beneficiaries shows "Todavía no hay beneficiarios." and the add form further down. Gate 4.state: "empty: nothing shown and 0 next-step controls", 10 of 10 cells for both. The inbox empty state passes.
- Screenshot: docs/ux/qa/period-empty-390-en.png
- Category: broken state. Severity: low. Status: open.

### UX-15 "Editar" on a beneficiary looks like it does nothing
- Screen: beneficiaries. Width: 1440 and 390. Language: es and en.
- Steps: open Beneficiarios, click "Editar" on the first row (Ana Souza). Nothing was saved.
- Expected: the edit form is brought into view or focused.
- Actual: the form opens below the table: top of the first field at y 1068 on 1440 x 900 and y 1575 on 390 x 844. scrollY stays 0 and focus does not move, so in the viewport nothing changes. On a phone the user must scroll about two screens to find it. The form also shows no "demo is read-only" notice, unlike the Policy page.
- Screenshot: docs/ux/qa/beneficiaries-edit-click-390-es.png (what the user sees after the click), docs/ux/qa/beneficiaries-edit-form-1440-es.png (where the form is)
- Category: loading without feedback. Severity: medium. Status: open.

### UX-16 Save buttons show no pressed or busy state
- Screen: policy, beneficiaries. Width: 390. Language: es.
- Steps: gate 4.busy (Tab to the primary action, Enter), request answered after 600 ms.
- Expected: disabled, aria-busy or a progress element within 100 ms.
- Actual: "no disabled, aria-busy or progress state within 150 ms" on both screens. Not repeated by hand because it would write to the demo data.
- Screenshot: none.
- Category: loading without feedback. Severity: low. Status: open.

### UX-17 Invalid approval link: no next step and a console error
- Screen: approve with a bad token (/approve/invalid-token-qa). Width: 1440 and 390. Language: es and en.
- Steps: open the URL logged out.
- Expected: a friendly message that says what to do (for example ask for a new link), and no console error.
- Actual: the heading "Aprobar este pago / Approve this payment" is followed by "Este enlace no es válido o venció" and nothing else, on a nearly empty page: no link, no contact, no way back. The browser console logs `error: Failed to load resource: the server responded with a status of 404`; gate 6.console fails (10 of 10 cells). The heading promises an action that is not there.
- Screenshot: docs/ux/qa/approve-invalid-390-es.png
- Category: confusing copy. Severity: medium. Status: open.

### UX-18 Unknown invoice page logs a console error
- Screen: detail with an id that does not exist. Width: 1440 and 390. Language: es and en.
- Steps: signed in, open /invoices/00000000-0000-0000-0000-000000000000.
- Expected: the friendly message ("No encontré esta factura." / "I could not find this invoice.") with the back link, and a clean console.
- Actual: message and back link are right, but the console shows a 404 error (gate 6.console, 10 of 10 cells, seen on the gate's `detail-unread`).
- Screenshot: docs/ux/qa/detail-unread-1440-es.png
- Category: broken state. Severity: low. Status: open.

### UX-19 Browser-made widgets ignore the app language
- Screen: period (month field), beneficiaries edit form (date field), new-invoice file tab (file chooser). Width: 1440 and 390. Language: es.
- Steps: with the app in Spanish look at the month field, the "Vigente hasta" date and the file field.
- Expected: one language.
- Actual: the month field shows "October 2026", the date "10/17/2027" (US order), and the file field "Choose File / No file chosen", all next to Spanish labels. This follows the browser's language (headless Chromium is en-US), so a Spanish browser may look right; the app language switch does not change them.
- Screenshot: docs/ux/qa/period-month-390-es.png, docs/ux/qa/new-invoice-file-390-en.png (file chooser, same text on the es screen)
- Category: confusing copy. Severity: low. Status: open.

### UX-20 Empty file submit says "format not supported"
- Screen: new-invoice, tab "Subir PDF o imagen". Width: 1440 and 390. Language: es and en.
- Steps: open "Nueva factura", press "Enviar al agente" with no file chosen. (The request was blocked in my test; nothing was sent.)
- Expected: "choose a file first" or similar.
- Actual: "Formato no admitido: sube un PDF, PNG o JPG de hasta 10 MB" / "Unsupported format: upload a PDF, PNG or JPG of up to 10 MB", as if a wrong file had been chosen. The two text tabs say "Pega un texto de 1 a 20.000 caracteres." and are fine.
- Screenshot: docs/ux/qa/new-invoice-empty-file-390-es.png
- Category: confusing copy. Severity: low. Status: open.

### UX-21 Colours outside the approved palette
- Screen: inbox, tour, demo (the ESCALAR chip), detail-escalar (the "?" mark). Width: all. Language: es and en.
- Steps: gate 6.palette.
- Expected: only approved colours.
- Actual: #956400 on #fbf3db (amber) in the ESCALAR chip and the "?" mark, 10 of 10 cells. (The deployed app may predate the palette decision; it is listed because the gate fails.)
- Screenshot: docs/ux/qa/inbox-1440-en.png
- Category: broken state. Severity: low. Status: open.

### UX-22 The period table cannot be scrolled with the keyboard
- Screen: period, "Por beneficiario" table. Width: 390 (gate: 10 of 10 cells). Language: es and en.
- Steps: gate 3.axe.
- Expected: no serious axe violation.
- Actual: axe `scrollable-region-focusable` (serious) on `.table-wrap`: a scrolling container the keyboard cannot reach.
- Screenshot: none.
- Category: broken state. Severity: medium. Status: open.

### UX-23 Several dark buttons compete when the new-invoice form is open
- Screen: inbox with "Nueva factura" open. Width: 390 and 1440. Language: es and en.
- Steps: click "Nueva factura".
- Expected: one primary button per view (AC-91 item 6; judged by eye).
- Actual: three solid dark controls at once: "Ejecutar agente", the selected tab ("Subir PDF o imagen") and "Enviar al agente". The selected tab looks like an action button.
- Screenshot: docs/ux/qa/new-invoice-file-390-en.png
- Category: confusing copy. Severity: low. Status: open.

### UX-24 Policy version list has no limit
- Screen: policy. Width: 1440 and 390. Language: es and en.
- Steps: scroll to "Versiones".
- Expected: a readable history.
- Actual: 34 rows "Política general, versión N, 17/10/2026", all the same name and date, so the page is very long and the list says nothing. (Earlier test runs created these; a fresh demo company would show fewer.)
- Screenshot: none.
- Category: confusing copy. Severity: low. Status: open.

## Checked and fine (evidence, not defects)

- No sideways scroll at 390 or 1440 on any screen (`scrollWidth` 390/390 and 1440/1440); the beneficiaries and period tables scroll inside their own card (table 556 px in a 356 px card).
- `html lang` follows the chosen language on every screen (gate 3.lang pass); language switch works on the detail page and the labels change at once.
- Focus ring and Enter on the primary action pass on all screens except those in UX-16 (gate 3.focus, 3.enter).
- Inbox error and offline states, and the "Loading invoices..." message with data held 2.5 s, are designed and in the right language ("No pude cargar las facturas. Recarga la página para intentar de nuevo.").
- Filters work (31 rows to 15 with "PAGAR"; combined filter shows the expected row); browser Back from a detail returns to the inbox; an unknown URL signed out goes to login, signed in goes to the inbox.
- The video link on /demo answers 200 `video/webm`.
- First view on fresh browsers: /demo, /login and /approve heading visible in 0.5 to 0.8 s at both widths (3 runs each).

## Harness notes (not product defects, for the builder of the gate)

- `detail-unread` opens an invoice that does not exist ("No encontré esta factura"), so its 7.usable and 6.console fail comes from the harness choosing a missing id; the demo has no invoice without an outcome, so this screen was not truly tested.
- `detail-pagar` 5.words flags "160" three times as a developer word; it is the amount "160 USD", not a code.
- `demo` 7.usable measured 3739 ms in one of 12 cells (390/en); three fresh runs by hand gave 0.6 to 0.8 s, so it looks like a one-off. Re-run before treating it as a defect.
- The gate writes about 240 screenshots next to its table; only the ones above were kept.
