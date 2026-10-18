# Copy deck (D47 (4), product, 18 Oct ~06:30Z)

Owner: product (R-185). Applied by Task 61, except the rows under «Owned by Task 60», which Task 60 applies with AC-121. Disputes about wording come to product, as product questions. The binding ACs are AC-118, AC-119 and AC-120 in `docs/SPEC.md`, section 13i.

## How to read this deck
- Each table row is: priority, key, language, before, after.
  - «before» is the value on `r202610162341/integration` when this deck was written, before Tasks 58 and 59 merged. If a task changed a value since then, the «after» column still binds.
  - `(new)` in «before»: Task 61 adds the key.
  - `(removed)` in «after»: Task 61 deletes the key and the one line that renders it. Rendering a replacement key is a key-reference change, not a logic change.
- Priority:
  - P1 is never cut.
  - P2 is cut first if Task 61 runs out of time (R-188). A P2 row that is cut is listed in the ledger, and its «before» value stays.
- `src/i18n/copy.test.ts` (Task 61) parses every table in this file except two: the one under a heading that says «not a dictionary», and the one under «Owned by Task 60». For each row it checks that `ui[lang][key]` equals «after», or that the key is absent when «after» is `(removed)`. A P2 row that is cut is skipped only if the ledger names it. Task 60's own tests check its rows, so the result is the same whichever of 60 and 61 merges first.
- Quotes and ellipses are literal: «», “”, and the single character `…` (U+2026).

## Voice (one voice for every screen and email)
1. The app speaks to the reader as «tú» in es-CO and "you" in en. Thesaurus speaks in the first person singular («No pude…», «Leí…»), never as «nosotros».
2. Short sentences, verb first. One idea per sentence. At most two sentences in a tour step.
3. No vendor or model names and no internal jargon outside the places AC-118 allows. The banned words are: Bedrock, Nova, AWS, Amazon, Yahoo, Workers AI, Cloudflare, Supabase, LLM, JEV, modelo / model, tabla de consecuencias / consequence table, herramientas / tools, percibe / perceives, and «→».
4. The three outcomes are always PAGAR, FRENAR and ESCALAR (PAY, STOP, ESCALATE) when the outcome itself is meant.
5. The screens are always Bandeja, Detalle de factura, Política, Beneficiarios and Periodo (Inbox, Invoice detail, Policy, Beneficiaries, Period). In finance-facing English, the person paid is a "beneficiary", never a "payee".
6. A retry button reads «Reintentar» / "Try again".
7. Numbers, money and percentages come from `Intl` in the tab's locale (R-164, R-174). A dictionary never holds a hand-written number format.
8. Benefit first: say what the screen is for and what to do on it. Never say how the product is built.

## Brand: the slogan and the descriptor (one i18n place: `src/i18n/features/brand.ts`, new; AC-119)
The headline and sub-line are provisional (Q24, R-184). If Roberto picks another slogan, only `brand.ts` and the README's top lines change. Tests import the dictionary and never repeat the literal.

Where each key is shown:
- the top bar descriptor (web/App.tsx) is `brand.descriptor`;
- the /demo h1 is `brand.headline`, with `brand.subline` as the paragraph right under it;
- the login screen's lead (web/pages/Login.tsx) is `brand.subline`;
- the /demo footer reads `{app.name} · {brand.built_for}`, which renders as «Thesaurus · Construido para Blinka».

| P | key | lang | before | after |
|---|---|---|---|---|
| P1 | brand.headline | es | (new) | Paga lo que debes. Frena lo que no. Pregunta cuando dudes. |
| P1 | brand.headline | en | (new) | Pay what you owe. Stop what you don't. Ask when in doubt. |
| P1 | brand.subline | es | (new) | El agente de cuentas por pagar que decide con tus reglas. |
| P1 | brand.subline | en | (new) | The accounts payable agent that decides by your rules. |
| P1 | brand.descriptor | es | (new) | Agente de cuentas por pagar |
| P1 | brand.descriptor | en | (new) | Accounts payable agent |
| P1 | brand.built_for | es | (new) | Construido para Blinka |
| P1 | brand.built_for | en | (new) | Built for Blinka |
| P1 | app.tagline | es | un agente de pagos construido para Blinka | (removed) |
| P1 | app.tagline | en | a payments agent built for Blinka | (removed) |
| P1 | demo.title | es | Un agente que decide qué facturas pagar. | (removed) |
| P1 | demo.title | en | An agent that decides which invoices to pay. | (removed) |
| P1 | login.lead | es | Un agente de pagos construido para Blinka. Lee cada factura, la verifica contra tus reglas y decide: PAGAR, FRENAR o ESCALAR. | (removed) |
| P1 | login.lead | en | A payments agent built for Blinka. It reads each invoice, checks it against your rules and decides: PAY, STOP or ESCALATE. | (removed) |

## Guided tour (`src/i18n/features/auth.ts`; AC-117, AC-118)
The tour is written for the finance lead who will use the app. The step titles are the names of the screens and controls. `tour.count` («Paso {n} de {total}») belongs to Task 58 and does not change here.

| P | key | lang | before | after |
|---|---|---|---|---|
| P1 | tour.inbox.body | es | Dónde actúa la IA: lee cada factura (Amazon Nova Lite en AWS Bedrock) y responde tus preguntas sobre el registro («Pregúntale a Thesaurus»). Dónde decide el código: las 13 reglas, la tabla de consecuencias y la tasa de cambio del día; solo el código puede escribir PAGAR. | Aquí llegan todas tus facturas, cada una con lo que decidió Thesaurus. Empieza por las que necesitan tu respuesta. |
| P1 | tour.inbox.body | en | Where the AI acts: it reads each invoice (Amazon Nova Lite on AWS Bedrock) and answers your questions about the record ("Ask Thesaurus"). Where code decides: the 13 rules, the consequence table and the day's exchange rate; only code can write PAY. | All your invoices land here, each with what Thesaurus decided. Start with the ones that need your answer. |
| P1 | tour.inbox.loop | es | Con cada factura, Thesaurus percibe → lee → consulta sus herramientas → decide → actúa → rinde cuentas. | (removed) |
| P1 | tour.inbox.loop | en | With every invoice, Thesaurus perceives → reads → consults its tools → decides → acts → accounts for it. | (removed) |
| P1 | tour.new-invoice.body | es | Sube un PDF o una imagen, o pega un correo o un chat. El agente la lee y la decide en el momento. | Sube un PDF o una imagen, o pega el texto de un correo o un chat. Thesaurus la lee y la decide en el momento. |
| P1 | tour.new-invoice.body | en | Upload a PDF or an image, or paste an email or a chat. The agent reads it and decides it right away. | Upload a PDF or an image, or paste the text of an email or a chat. Thesaurus reads it and decides it right away. |
| P1 | tour.run-agent.body | es | Pide al agente que decida ahora las facturas pendientes. Al terminar ves cuántas quedaron en PAGAR, FRENAR y ESCALAR. | Pídele a Thesaurus que decida ahora tus facturas pendientes. Al terminar ves cuántas quedaron en PAGAR, FRENAR y ESCALAR. |
| P1 | tour.run-agent.body | en | Ask the agent to decide pending invoices now. When it finishes you see how many ended in PAY, STOP and ESCALATE. | Ask Thesaurus to decide your pending invoices now. When it finishes, you see how many ended in PAY, STOP and ESCALATE. |
| P1 | tour.invoice-row.title | es | Detalle de decisión | Detalle de factura |
| P1 | tour.invoice-row.title | en | Decision detail | Invoice detail |
| P1 | tour.invoice-row.body | es | Abre una factura para ver lo que hizo el agente paso a paso, cada regla que verificó y qué tendría que pasar para pagarla. «Leído por IA» dice qué modelo la leyó y en qué línea del documento encontré cada dato. En «Pregúntale a Thesaurus» le preguntas al registro; la respuesta nunca aprueba ni paga nada. | Abre una factura para ver qué leyó Thesaurus, cada regla que revisó y por qué decidió así. Si dudas, pregúntale ahí mismo. |
| P1 | tour.invoice-row.body | en | Open an invoice to see what the agent did step by step, every rule it checked and what would have to change to pay it. "Read by AI" says which model read it and on which line of the document I found each value. In "Ask Thesaurus" you ask the record; the answer never approves or pays anything. | Open an invoice to see what Thesaurus read, every rule it checked and why it decided that way. If in doubt, ask it right there. |
| P1 | tour.policy.body | es | Tus reglas: límite por pago, umbral de aprobación, presupuesto. Cada cambio guarda una versión nueva y puedes reevaluar las facturas pendientes. | Define tus reglas: el límite por pago, el monto que requiere tu aprobación y el presupuesto del mes. Cada cambio se guarda como una versión nueva. |
| P1 | tour.policy.body | en | Your rules: per-payment limit, approval threshold, budget. Every change saves a new version and you can re-evaluate pending invoices. | Set your rules: the per-payment limit, the amount that needs your approval and the month's budget. Each change is saved as a new version. |
| P1 | tour.beneficiaries.body | es | A quién se le paga: cuenta, ruta y acuerdo. Una factura de alguien que no está aquí, o con otra cuenta, nunca se paga sola. | Registra a quién le pagas, su cuenta y lo acordado. Si llega una factura de alguien que no está aquí, o con otra cuenta, Thesaurus no la paga sin preguntarte. |
| P1 | tour.beneficiaries.body | en | Who gets paid: account, route and agreement. An invoice from someone not listed here, or with another account, is never paid on its own. | Record who you pay, their account and what you agreed. If an invoice comes from someone not listed here, or with another account, Thesaurus won't pay it without asking you. |
| P1 | tour.period.title | es | Periodo y escalado | Periodo |
| P1 | tour.period.title | en | Period and escalation | Period |
| P1 | tour.period.body | es | El presupuesto del mes, lo pagado, lo comprometido y la autonomía del agente. Lo que no puede decidir solo lo escala: pregunta al aprobador y la respuesta, Aprobar o Rechazar, queda en el detalle de la factura. | Mira cuánto llevas pagado y comprometido este mes frente a tu presupuesto, y cuántas facturas decidió Thesaurus sin ayuda. |
| P1 | tour.period.body | en | The month's budget, paid, committed and the agent's autonomy. What it cannot decide alone it escalates: it asks the approver, and the answer, Approve or Reject, is recorded on the invoice detail. | See how much you have paid and committed this month against your budget, and how many invoices Thesaurus decided without help. |

## Login (`src/i18n/features/auth.ts`)
| P | key | lang | before | after |
|---|---|---|---|---|
| P1 | login.verify | es | Entrar | Verificar código |
| P1 | login.verify | en | Sign in | Verify code |
| P1 | login.sent | es | Te enviamos un código de 6 dígitos a {email}. | Te envié un código de 6 dígitos a {email}. |
| P1 | login.sent | en | We sent a 6-digit code to {email}. | I sent a 6-digit code to {email}. |
| P1 | login.send_failed | es | No pudimos enviar el código. Revisa el correo e intenta de nuevo. | No pude enviar el código. Revisa tu correo e intenta de nuevo. |
| P1 | login.send_failed | en | We could not send the code. Check the email and try again. | I couldn't send the code. Check your email address and try again. |

The `login.verify` rows are R-179's, and Task 59 already applies them. They are listed here so the deck covers the whole screen.

## Decision detail and «Pregúntale a Thesaurus» (`src/i18n/features/ask.ts`; AC-118)
`detail.read_by` («Leído por IA · {provider}») does not change. It is the one line on Detalle that names the reader, and D47 (2) allows it.

| P | key | lang | before | after |
|---|---|---|---|---|
| P1 | ask.label | es | Respuesta generada por IA ({provider}) a partir del registro; puede equivocarse: el registro manda. | Respuesta generada por IA a partir del registro. Puede equivocarse: el registro manda. |
| P1 | ask.label | en | AI-generated answer ({provider}) based on the record; it can be wrong: the record prevails. | AI-generated answer based on the record. It can be wrong: the record prevails. |

## Política (`src/i18n/features/policy.ts`; AC-118, Q25)
The market-rates table keeps its «Fuente» column. That column shows the recorded source of each rate as data (Q25).

| P | key | lang | before | after |
|---|---|---|---|---|
| P1 | policy.fx.source | es | Fuente de tasas: Yahoo Finance (respaldo: open.er-api.com). Tu empresa puede conectar otra fuente —su banco, su proveedor de tesorería o la tasa de Blinka— agregando un proveedor; ver README, sección «Tasas de cambio». | Las tasas de mercado vienen de una fuente pública y se guardan con la fecha en que se consultaron. Tu empresa puede conectar la suya: su banco, su tesorería o la tasa de Blinka (ver README, «Tasas de cambio»). |
| P1 | policy.fx.source | en | Rate source: Yahoo Finance (fallback: open.er-api.com). Your company can connect another source (its bank, its treasury provider or Blinka's rate) by adding a provider; see README, section "Tasas de cambio". | Market rates come from a public source and are stored with the date they were fetched. Your company can connect its own: its bank, its treasury or Blinka's rate (see README, "Tasas de cambio"). |
| P2 | policy.account_balance_usd.hint | es | Plata disponible para pagar hoy. | Dinero disponible para pagar hoy. |
| P2 | policy.fx.retry | en | Retry | Try again |

## /demo (`src/i18n/features/demo.ts`)
D47 (2) allows the technology to appear in the «Cómo funciona» section of /demo. Its stage words (AC-66), the «Dónde actúa la IA» sentence (AC-79) and the pitch line with JEV's status (R-30) stay as they are.

| P | key | lang | before | after |
|---|---|---|---|---|
| P1 | demo.loop.title | es | Cómo trabaja | Cómo funciona |
| P2 | demo.stage.lee.text | es | El LLM extrae a quién, cuánto, en qué moneda y para cuándo. | La IA lee la factura y extrae a quién, cuánto, en qué moneda y para cuándo. |
| P2 | demo.stage.lee.text | en | The LLM extracts who, how much, in which currency and by when. | The AI reads the invoice and extracts who, how much, in which currency and by when. |

## Bandeja, Periodo, trial, approval, shared (various files)
| P | key | lang | before | after |
|---|---|---|---|---|
| P2 | dash.search | en | Search by payee, number or concept | Search by beneficiary, number or concept |
| P2 | period.unread | en | Payee not read | Beneficiary not read |
| P2 | period.retry | es | Intentar de nuevo | Reintentar |
| P2 | app.retry | es | Intentar de nuevo | Reintentar |
| P2 | trial.approver | es | Las empresas de prueba no envían correos; las escalaciones esperan en el tablero. | Tu empresa de prueba no envía correos: lo que necesite tu respuesta te espera en la Bandeja. |
| P2 | trial.approver | en | Trial companies send no email; escalations wait on the dashboard. | Your trial company sends no email: anything that needs your answer waits for you in the Inbox. |
| P2 | approve.payee | en | Payee | Beneficiary |
| P2 | approve.error.not_found | es | Factura no encontrada | No encontré esta factura |
| P2 | approve.error.not_found | en | Invoice not found | I couldn't find this invoice |

## Vendor portal (`src/i18n/features/portal.ts`; a portal change means the `facturas` Worker is deployed too)
| P | key | lang | before | after |
|---|---|---|---|---|
| P2 | portal.greeting | es | Hola, soy Thesaurus, el agente de pagos de {company}. Envíame tu factura o cuenta de cobro. | Hola, soy Thesaurus, el agente de cuentas por pagar de {company}. Envíame tu factura o cuenta de cobro. |
| P2 | portal.greeting | en | Hi, I'm Thesaurus, {company}'s payments agent. Send me your invoice or bill. | Hi, I'm Thesaurus, {company}'s accounts payable agent. Send me your invoice or bill. |

## Owned by Task 60 (AC-121; checked by Task 60's own tests; copy.test.ts skips this table)
| P | key | lang | before | after |
|---|---|---|---|---|
| P1 | dash.kpi.deciding | es | (new) | Decidiendo… {n} de {m} |
| P1 | dash.kpi.deciding | en | (new) | Deciding… {n} of {m} |
| P1 | entry.deciding | es | Decidiendo tus facturas pendientes… {n} de {m}. Las cifras se actualizan con cada decisión. | Decidiendo tus facturas pendientes… {n} de {m}. Las cifras aparecen al terminar. |
| P1 | entry.deciding | en | Deciding your pending invoices… {n} of {m}. The figures update with each decision. | Deciding your pending invoices… {n} of {m}. The figures appear when it finishes. |

## README and SUBMISSION (not a dictionary; checked by grep, AC-119)
- P1. README line 3, `<br><b>Thesaurus</b>, un agente de pagos construido para Blinka`, becomes two lines. The first is `<br><b>Thesaurus</b> · Paga lo que debes. Frena lo que no. Pregunta cuando dudes.` The second is `<br>El agente de cuentas por pagar que decide con tus reglas. Construido para Blinka.`
- P1. Every other «un agente de pagos construido para Blinka» in README.md, including «Equipo y créditos» (AC-110 item 14), becomes «el agente de cuentas por pagar, construido para Blinka». The English summary's "a payments agent built for Blinka's challenge" becomes "an accounts payable agent built for Blinka's challenge". After the change, `grep -n "agente de pagos\|payments agent" README.md` prints nothing.
- P2. In docs/SUBMISSION.md, the same replacement. `wc -m` on the description stays at 5000 or less.

## Reviewed, unchanged (and why)
- Decision record templates: in `src/i18n/es.ts` and `en.ts`, `outcome.*`, `verdict.*`, `channel.*`, `value.*`, `field.*`, `agreement.*`, `headline.*`, `check.*`, `motive.*`, `fix.*`, `trace.*`, `question.*`, `email.*`, `lector.*`, `nota_credito.*` and `total_no_cuadra.*`; also `src/i18n/features/fx.ts` and `trial-record.ts`.
  - These are the record and the escalation email. D24 and D25 quote them verbatim, and AC-64, AC-65 and AC-39 test them word for word. They already follow the voice: first person, plain, the outcome words.
  - A record that has been written is never rewritten (append-only), so changing a template would make old and new records read differently.
- Vendor status words, `portal.status.*` (R-90): the fixed set a vendor may see.
- AC-116's verbatim step-card copy, written by product for Task 58, and the six AC-66 stage words.
- The /demo pitch line and JEV's status line (R-30, D27): Roberto's words, inside the «Cómo funciona» section, where D47 allows them.
- `email_in.*`, the intake reply to vendors: already plain, first person.
- Plurals written «factura(s)» in `policy.header_*`, `policy.unread_pending`, `run.errors_*` and `period.violations_alert`. Fixing them needs plural selection, which is logic, so they stay. The idea is in docs/IDEAS.md.
- The English mix of "I could not" and "I couldn't". es-CO is the working language, and the mix does not change meaning. The idea is in docs/IDEAS.md.
- Keys that Task 58 adds after this deck (the /demo stage-card sentences, its labels): Task 62's fresh UX reviewer reads them against the voice rules above. A finding there is a product question.
