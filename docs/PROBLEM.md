# The problem (Roberto wrote this at kickoff, 16 Oct 2026)

## Company
Blinka (blinka.co, Blinka Tech Corp, Delaware; founders Juan Pablo and Sebastián Linares; Y Combinator F26). "The banking platform for global companies": USD accounts (Portage Bank, FDIC pass-through), global payments (ACH, wire, SWIFT to 200+ countries, local rails COP/BRL Pix/MXN/ARS CBU/CLP/PEN/BOB/CRC/EUR/ZAR, USDC on Base/Ethereum/Polygon/Celo/Solana via Mural Pay), Visa Infinite cards (Third National), treasury (Atomic Invest), and a back office with invoicing, vendor ("counterparty") management and QuickBooks accounting. Named customers: Bricksave, Braven, Dapta, Creditop, Zolvo, Gol Ventures. Blinka set the challenge and judges it. Challenge page: HackRadar "Reto Blinka: Agentes que pagan por la empresa". Area: Producto. Type: Crear algo nuevo. Deliverable: Agente funcionando.

## The problem in their words
"Construir un agente que revise las cuentas de una empresa y decida cuáles pagar por ella, dentro de las reglas que la empresa define, y que le pida permiso a una persona cuando algo se sale de esas reglas."

How it works today: "Llega una factura o cuenta de cobro por correo, PDF o chat. Alguien de finanzas la revisa, la compara con lo acordado y busca los datos de quien cobra. Pide aprobación por chat o correo. Entra a la plataforma y crea el pago a mano, muchas veces en otra moneda y hacia otro país. Concilia en una hoja de cálculo qué se pagó y por qué. Todo eso es manual, se repite cada mes y depende de que una persona esté disponible."

Why now: "Cada vez más empresas están armando sus propios agentes y quieren que también se encarguen de pagar. Lo que falta resolver es la confianza: que el agente pague solo lo que debe, explique cada decisión y nunca se pase de los límites que le pusieron."

Where the flow ends: "El reto termina cuando el agente decide qué hacer con cada factura: pagarla, frenarla o escalarla a una persona. No hay que mover dinero real ni conectarse a una plataforma de pagos: basta con que el agente tome la decisión, la registre y explique por qué."

In scope (their list): "Leer una factura y extraer a quién, cuánto, en qué moneda y para cuándo. Decidir si se paga según reglas configurables, como límites por pago y por periodo, beneficiarios permitidos y aprobación humana por encima de cierto monto. Dejar un registro de cada decisión: pagó, frenó o escaló, y por qué."

Out of scope (their list): "Ejecutar pagos reales o mover dinero. Abrir cuentas. Verificar la identidad de las empresas. Decisiones de cumplimiento o fraude. El diseño de la app de Blinka."

Data: "No hay API ni facturas de ejemplo: cada equipo arma su propio set de datos. Pueden crear facturas simuladas (PDF, imagen, correo o mensaje de chat) [...] junto con las reglas de pago de una empresa ficticia. Incluyan casos normales y casos trampa, por ejemplo: un cobro duplicado; un beneficiario nuevo que no está en la lista permitida; una factura que no cuadra con lo acordado; un monto que supera el límite y necesita aprobación humana; saldo o presupuesto insuficiente para el periodo."

Expected deliverable: "Un agente funcionando sobre su set de facturas, con una pantalla simple donde la empresa define sus reglas y ve qué decidió pagar el agente, qué frenó, qué dejó pendiente de aprobación y por qué."

Restrictions: "Ningún dato real de clientes ni de empresas. El agente nunca aprueba un pago fuera de las reglas sin aprobación humana. Cada decisión tiene que poder explicarse después. Libertad total de modelo, lenguaje y framework."

How success looks (the rubric, verbatim):
- "Autonomía: qué tanto de su set de facturas decide el agente correctamente sin que intervenga una persona."
- "Seguridad: cero pagos aprobados fuera de las reglas. Aprobar un pago indebido descalifica."
- "Explicabilidad: cualquier persona entiende por qué el agente pagó, frenó o escaló cada factura leyendo su registro, sin abrir el código."

## Who uses the result and how often
"Empresas constituidas en EE. UU. que operan en varios países, con equipo, proveedores y contratistas en Latinoamérica y otras regiones. Sus equipos de finanzas hacen decenas de pagos al mes." The user is the finance person (or founder acting as one) of such a company: a few times a week, from a laptop, when invoices arrive; the approver answers escalations from the phone (email). Judges at Demo Day: Blinka's team, on a shared screen, remote.

## What they do today
Email/PDF/chat inbox -> manual check against the agreement -> look up the payee's bank details -> ask approval by chat/email -> create the payment by hand in the platform, often cross-currency and cross-border -> reconcile in a spreadsheet.

## What "working" means to them on Monday
"El agente pagó solo lo que debía, explicó cada decisión y nunca se pasó de los límites que le pusimos": they can drop their invoice set and rules into it, every normal invoice is decided without them, every trap is held or escalated with a reason a non-engineer reads, and zero invoices outside the rules are marked as paid.

## Constraints they mentioned
- No real money, no payment platform integration, no Blinka API (none exists publicly). The output is a recorded, explained decision.
- No real customer or company data: simulated invoices and a fictional company.
- "El agente nunca aprueba un pago fuera de las reglas sin aprobación humana."
- Free choice of model, language and framework.
- The challenge is in Spanish; Blinka's product is in English and its customers are LATAM companies with US entities: the product must work in both languages.
- Mentor/judge expectation (inferred, see docs/DECISIONS.md): they will create a trap invoice live, change a rule live and re-run, and read one decision record without help.

## Existing systems we may need to understand
None. Blinka's app is behind login and has no public API; the challenge explicitly excludes connecting to it. No REA analysis task.
