-- Task 3 seed: Andina Labs Inc. (AC-03, AC-07, AC-09, AC-10, AC-47; R-05, R-07, R-08, R-09). Forward-only and additive.
-- The data set lives once, in the seed JSON below; scripts/gen-invoices.mjs (documents + docs/demo/DATASET.md),
-- scripts/tests/seed.test.sh and Task 4's seed-replay test read it from this file.
-- Dates are relative to seeding time (R-09), Bogota month M = month of now():
--   received_at = start(M) + (now() - start(M)) * NN / 30, so NN is the arrival order and every invoice is inside M;
--   prev_month invoices: received_at = start(M) - 5 days. issue_date / due_date = Bogota date of received_at + issue / due days.
-- No decision is stored here (AC-10): the agent decides the seeded invoices; expected_outcome is what it must reach.
-- Each non-PAGAR invoice names the one check its trap fails ("check") and the checks that fail with it by construction
-- ("also": amounts above the per-payment limit are also above the threshold; a new or unread payee leaves the
-- directory checks unverifiable). Policy values make the budget and balance traps reachable on their own (R-08):
-- balance 23.000 < budget 42.000 (R-35); #28 fails the balance on paid amounts, #29 (last) fails the budget on commitments,
-- and rejecting #15 then approving Nube Sur #2044 ends in PAGAR (the video's happy path, see docs/demo/DATASET.md).

-- AC-47: a reset hides the beneficiaries a judge added (never deletes them). Directory reads filter `not archived`.
alter table public.beneficiaries add column archived boolean not null default false;

-- Not executable by members (revoked below): only seed_company (signup trigger) and reset_demo_company call it.
create or replace function public.andina_seed(p_company uuid, p_reset boolean) returns void
language plpgsql set search_path = '' as $fn$
declare
  v constant jsonb := $seed$
{
  "rules": {
    "per_payment_limit_usd": 5000, "approval_threshold_usd": 2500, "period_budget_usd": 42000, "account_balance_usd": 23000,
    "duplicate_window_days": 30, "agreement_tolerance_pct": 1, "due_grace_days": 0,
    "fx_rates": { "COP": 0.000245, "MXN": 0.054, "BRL": 0.18, "ARS": 0.00095, "EUR": 1.08, "USD": 1 },
    "allowed_beneficiaries_only": true
  },
  "beneficiaries": [
    { "name": "Laura Méndez", "country": "CO", "currency": "USD", "bank_account": "Bancolombia ahorros 0012-3456-4821", "route": "COP · transferencia", "category": "Desarrollo", "agreement": { "type": "retainer", "amount_usd": 2500, "period": "monthly" } },
    { "name": "Diego Ruiz", "country": "MX", "currency": "MXN", "bank_account": "BBVA México CLABE 012180001534779908", "route": "MXN", "category": "Desarrollo", "agreement": { "type": "hourly", "amount_usd": 45, "cap_usd": 3000, "period": "monthly" } },
    { "name": "Ana Souza", "country": "BR", "currency": "BRL", "bank_account": "Pix chave 11 98765-4302", "route": "Pix", "category": "Diseño", "agreement": { "type": "retainer", "amount_usd": 1800, "period": "monthly" } },
    { "name": "Martín López", "country": "AR", "currency": "ARS", "bank_account": "CBU 0170099220000067853214", "route": "CBU", "category": "Desarrollo", "agreement": { "type": "retainer", "amount_usd": 2200, "period": "monthly" } },
    { "name": "Nube Sur LLC", "country": "US", "currency": "USD", "bank_account": "ACH routing 026009593 cuenta 483920175", "route": "ACH", "category": "Software", "agreement": { "type": "subscription", "amount_usd": 4200, "period": "monthly" } },
    { "name": "Forma Studio", "country": "ES", "currency": "EUR", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332", "route": "SWIFT", "category": "Diseño", "agreement": { "type": "one_off" } },
    { "name": "Contadores Andinos SAS", "country": "CO", "currency": "COP", "bank_account": "Davivienda corriente 4569-8812-0034", "route": "COP", "category": "Contabilidad", "agreement": { "type": "retainer", "amount_usd": 900, "period": "monthly" } },
    { "name": "Northstar Group", "country": "US", "currency": "USD", "bank_account": "ACH routing 121000358 cuenta 990112468", "route": "ACH", "category": "Consultoría", "agreement": { "type": "hourly", "amount_usd": 80, "cap_usd": 2000, "period": "monthly" } }
  ],
  "invoices": [
    { "nn": "01", "source": "pdf", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": { "payee_name": "Laura Méndez", "amount": 2500, "currency": "USD", "invoice_number": "1042", "concept": "Retainer mensual de desarrollo", "bank_account": "Bancolombia ahorros 0012-3456-4821" },
      "reason": "Retainer de 2.500 USD igual al acuerdo, cuenta registrada, 2.500 ≤ umbral 2.500. Presupuesto 0 + 2.500 ≤ 42.000; saldo 0 + 2.500 ≤ 23.000." },
    { "nn": "02", "source": "email", "expected_outcome": "ESCALAR", "trap": "fuera del periodo", "check": "periodo", "also": [], "prev_month": true, "issue": -1, "due": 45,
      "raw_text": "De: Northstar Group <billing@northstar.example>\nAsunto: Factura NS-2188\n\nHola equipo de Andina Labs,\nles enviamos la factura NS-2188 por la auditoría de accesos del mes pasado (2,5 horas a USD 80).\nTotal: USD 200.00\nPago por ACH: routing 121000358 cuenta 990112468.\nVence en 45 días.\n\nSaludos,\nNorthstar Group",
      "fields": { "payee_name": "Northstar Group", "amount": 200, "currency": "USD", "invoice_number": "NS-2188", "concept": "Auditoría de accesos", "bank_account": "ACH routing 121000358 cuenta 990112468" },
      "reason": "Llegó el mes anterior (recibida = inicio del mes − 5 días): solo falla Periodo. Es la más antigua, así que se decide primero, con el mes en 0 USD." },
    { "nn": "03", "source": "image", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": { "payee_name": "Ana Souza", "amount": 10000, "currency": "BRL", "invoice_number": "AS-0087", "concept": "Diseño de producto, retainer mensual", "bank_account": "Pix chave 11 98765-4302" },
      "reason": "10.000 BRL × 0,18 = 1.800 USD = retainer de 1.800. Presupuesto 2.500 + 1.800 ≤ 42.000; saldo 2.500 + 1.800 ≤ 23.000." },
    { "nn": "04", "source": "pdf", "expected_outcome": "FRENAR", "trap": "sobre el límite por pago", "check": "limite_pago", "also": ["umbral_aprobacion", "acuerdo"], "issue": 0, "due": 45, "raw_text": null,
      "fields": { "payee_name": "Nube Sur LLC", "amount": 9800, "currency": "USD", "invoice_number": "2045", "concept": "Licencia anual plan Enterprise", "bank_account": "ACH routing 026009593 cuenta 483920175" },
      "reason": "9.800 USD > límite por pago 5.000: FRENAR. También supera el umbral 2.500 y no es la suscripción de 4.200 (inevitable con ese monto). Presupuesto 4.300 + 9.800 y saldo 4.300 + 9.800 cumplen." },
    { "nn": "05", "source": "chat", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45,
      "raw_text": "[WhatsApp] Diego Ruiz: Hola! Te paso la factura DR-031 por la API de conciliación.\nDiego Ruiz: Total MXN 9.000,00\nDiego Ruiz: Depósito a BBVA México CLABE 012180001534779908. Vence en 45 días. Gracias!",
      "fields": { "payee_name": "Diego Ruiz", "amount": 9000, "currency": "MXN", "invoice_number": "DR-031", "concept": "Desarrollo backend: API de conciliación", "bank_account": "BBVA México CLABE 012180001534779908" },
      "reason": "9.000 MXN × 0,054 = 486 USD; horas del mes 486 ≤ tope 3.000. Presupuesto 4.300 + 486; saldo 4.300 + 486 cumplen." },
    { "nn": "06", "source": "pdf", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": { "payee_name": "Martín López", "amount": 2316000, "currency": "ARS", "invoice_number": "ML-0310", "concept": "Desarrollo frontend, retainer mensual", "bank_account": "CBU 0170099220000067853214" },
      "reason": "2.316.000 ARS × 0,00095 = 2.200,20 USD, a 0,01 % del retainer de 2.200 (tolerancia 1 %). Presupuesto 4.786 + 2.200,20; saldo igual: cumplen." },
    { "nn": "07", "source": "pdf", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": { "payee_name": "Contadores Andinos S.A.S.", "amount": 3673500, "currency": "COP", "invoice_number": "CA-5521", "concept": "Contabilidad y nómina del mes", "bank_account": "Davivienda corriente 4569-8812-0034" },
      "reason": "3.673.500 COP × 0,000245 = 900,01 USD = retainer de 900. El nombre con \"S.A.S.\" coincide con el directorio sin sufijo. Presupuesto 6.986,20 + 900,01 cumple." },
    { "nn": "08", "source": "pdf", "expected_outcome": "FRENAR", "trap": "COP sobre el límite por pago", "check": "limite_pago", "also": ["umbral_aprobacion", "acuerdo"], "issue": 0, "due": 45, "raw_text": null,
      "fields": { "payee_name": "Contadores Andinos S.A.S.", "amount": 25000000, "currency": "COP", "invoice_number": "CA-5530", "concept": "Revisoría fiscal y auditoría anual", "bank_account": "Davivienda corriente 4569-8812-0034" },
      "reason": "25.000.000 COP × 0,000245 = 6.125 USD > límite 5.000: FRENAR (R-07). También supera el umbral y el retainer de 900 (inevitable). Saldo 7.886,21 + 6.125 cumple." },
    { "nn": "09", "source": "pdf", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": { "payee_name": "Forma Studio", "amount": 2000, "currency": "EUR", "invoice_number": "FS-118", "concept": "Identidad visual, fase 1", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332" },
      "reason": "2.000 EUR × 1,08 = 2.160 USD ≤ umbral; acuerdo único. Presupuesto 7.886,21 + 2.160; saldo igual: cumplen." },
    { "nn": "10", "source": "email", "expected_outcome": "FRENAR", "trap": "duplicado exacto", "check": "duplicado_exacto", "also": [], "issue": 0, "due": 45,
      "raw_text": "De: Ana Souza <ana@souza.example>\nAsunto: Factura AS-0087\n\nOi! Reenvío la factura AS-0087 del retainer de diseño de producto, por si no les llegó.\nValor: BRL 10.000,00\nPix chave 11 98765-4302\nVence en 45 días.\n\nAbraço,\nAna",
      "fields": { "payee_name": "Ana Souza", "amount": 10000, "currency": "BRL", "invoice_number": "AS-0087", "concept": "Diseño de producto, retainer mensual", "bank_account": "Pix chave 11 98765-4302" },
      "reason": "Mismo beneficiario y mismo número AS-0087 que la #03, dentro de la ventana de 30 días: FRENAR. Todo lo demás cumple (saldo 10.046,21 + 1.800 ≤ 23.000)." },
    { "nn": "11", "source": "pdf", "expected_outcome": "ESCALAR", "trap": "sobre el umbral de aprobación", "check": "umbral_aprobacion", "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": { "payee_name": "Nube Sur LLC", "amount": 4200, "currency": "USD", "invoice_number": "2044", "concept": "Suscripción mensual plataforma de datos", "bank_account": "ACH routing 026009593 cuenta 483920175" },
      "reason": "La del video (D25): 4.200 USD > umbral 2.500 y ≤ límite 5.000; es la suscripción acordada. Presupuesto 10.046,21 + 4.200; saldo 10.046,21 + 4.200: cumplen." },
    { "nn": "12", "source": "email", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45,
      "raw_text": "De: Northstar Group <billing@northstar.example>\nAsunto: Factura NS-2207\n\nHola,\nadjuntamos la factura NS-2207: consultoría de seguridad en la nube, 15 horas a USD 80.\nTotal: USD 1,200.00\nPago por ACH: routing 121000358 cuenta 990112468.\nVence en 45 días.\n\nNorthstar Group",
      "fields": { "payee_name": "Northstar Group", "amount": 1200, "currency": "USD", "invoice_number": "NS-2207", "concept": "Consultoría de seguridad en la nube", "bank_account": "ACH routing 121000358 cuenta 990112468" },
      "reason": "1.200 USD, horas del mes 1.200 ≤ tope 2.000. Presupuesto 14.246,21 + 1.200; saldo 10.046,21 + 1.200: cumplen." },
    { "nn": "13", "source": "chat", "expected_outcome": "ESCALAR", "trap": "beneficiario nuevo", "check": "beneficiario_permitido", "also": ["beneficiario_cuenta", "acuerdo"], "issue": 0, "due": 45,
      "raw_text": "[Slack] Pixel Lab: Buenas, somos Pixel Lab. Les compartimos la factura PX-0007 por la landing page.\nPixel Lab: Total USD 2.400\nPixel Lab: Banco de Bogotá ahorros 112-45009-8. Vence en 45 días.",
      "fields": { "payee_name": "Pixel Lab", "amount": 2400, "currency": "USD", "invoice_number": "PX-0007", "concept": "Desarrollo de landing page", "bank_account": "Banco de Bogotá ahorros 112-45009-8" },
      "reason": "Pixel Lab no está en el directorio: beneficiario nuevo. Sin ficha no se pueden comparar cuenta ni acuerdo (no verificables). Montos dentro de umbral, presupuesto y saldo." },
    { "nn": "14", "source": "email", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45,
      "raw_text": "De: Diego Ruiz <diego@ruiz.example>\nAsunto: Factura DR-032\n\nHola, va la factura DR-032 por la corrección de errores en pagos recurrentes.\nTotal: MXN 7.000,00\nBBVA México CLABE 012180001534779908\nVence en 45 días.\n\nDiego",
      "fields": { "payee_name": "Diego Ruiz", "amount": 7000, "currency": "MXN", "invoice_number": "DR-032", "concept": "Corrección de errores en pagos recurrentes", "bank_account": "BBVA México CLABE 012180001534779908" },
      "reason": "7.000 MXN × 0,054 = 378 USD; horas del mes 864 ≤ 3.000. Presupuesto 17.846,21 + 378; saldo 11.246,21 + 378: cumplen." },
    { "nn": "15", "source": "email", "expected_outcome": "ESCALAR", "trap": "cuenta cambiada", "check": "beneficiario_cuenta", "also": [], "issue": 0, "due": 45,
      "raw_text": "De: Laura Méndez <laura.mendez@correo.example>\nAsunto: Factura 1043 y nueva cuenta\n\nHola equipo,\nles envío la factura 1043 por las integraciones (hito 2). Cambié de banco: por favor paguen a Nequi 300-555-7310.\nTotal: USD 2.500\nVence en 45 días.\n\nGracias,\nLaura",
      "fields": { "payee_name": "Laura Méndez", "amount": 2500, "currency": "USD", "invoice_number": "1043", "concept": "Desarrollo de integraciones, hito 2", "bank_account": "Nequi 300-555-7310" },
      "reason": "Laura Méndez existe, pero la cuenta de la factura termina en 7310 y la registrada en 4821: cuenta cambiada. Monto igual al retainer, dentro de umbral, presupuesto y saldo." },
    { "nn": "16", "source": "email", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45,
      "raw_text": "De: Forma Studio <facturas@forma.example>\nAsunto: Factura FS-121\n\nHola,\nadjuntamos la factura FS-121 por las plantillas de presentación comercial.\nImporte: EUR 1.900,00\nIBAN ES91 2100 0418 4502 0005 1332 (SWIFT CAIXESBBXXX)\nVence en 45 días.\n\nUn saludo,\nForma Studio",
      "fields": { "payee_name": "Forma Studio", "amount": 1900, "currency": "EUR", "invoice_number": "FS-121", "concept": "Plantillas de presentación comercial", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332" },
      "reason": "1.900 EUR × 1,08 = 2.052 USD ≤ umbral; acuerdo único. Presupuesto 20.724,21 + 2.052; saldo 11.624,21 + 2.052: cumplen." },
    { "nn": "17", "source": "email", "expected_outcome": "ESCALAR", "trap": "duplicado con otro número", "check": "duplicado_probable", "also": [], "issue": 0, "due": 45,
      "raw_text": "De: Martín López <martin@lopez.example>\nAsunto: Factura ML-0311\n\nHola, les paso la factura ML-0311 del retainer de desarrollo frontend.\nTotal: ARS 2.316.000,00\nCBU 0170099220000067853214\nVence en 45 días.\n\nSaludos,\nMartín",
      "fields": { "payee_name": "Martín López", "amount": 2316000, "currency": "ARS", "invoice_number": "ML-0311", "concept": "Desarrollo frontend, retainer mensual", "bank_account": "CBU 0170099220000067853214" },
      "reason": "Mismo beneficiario, mismo concepto y mismo mes que la #06, con otro número (ML-0311 vs ML-0310): posible duplicado. Monto y cuenta cumplen." },
    { "nn": "18", "source": "image", "expected_outcome": "ESCALAR", "trap": "ilegible", "check": "lectura", "also": ["beneficiario_permitido", "beneficiario_cuenta", "acuerdo", "duplicado_exacto", "duplicado_probable", "limite_pago", "umbral_aprobacion", "presupuesto_periodo", "saldo_cuenta", "vencimiento", "moneda"], "issue": null, "due": null, "raw_text": null,
      "fields": { "payee_name": null, "amount": null, "currency": null, "invoice_number": null, "concept": "ilegible", "bank_account": null },
      "reason": "Foto borrosa: no se lee ningún campo, Lectura no se pudo verificar. Todo control que necesita un campo queda no verificable; solo Periodo (por fecha de llegada) cumple." },
    { "nn": "19", "source": "chat", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45,
      "raw_text": "[WhatsApp] Diego Ruiz: Te mando la DR-033, migración de base de datos.\nDiego Ruiz: MXN 11.000,00 a la CLABE 012180001534779908. Vence en 45 días.",
      "fields": { "payee_name": "Diego Ruiz", "amount": 11000, "currency": "MXN", "invoice_number": "DR-033", "concept": "Migración de base de datos", "bank_account": "BBVA México CLABE 012180001534779908" },
      "reason": "11.000 MXN × 0,054 = 594 USD; horas del mes 1.458 ≤ 3.000. Presupuesto 24.976,41 + 594; saldo 13.676,21 + 594: cumplen." },
    { "nn": "20", "source": "pdf", "expected_outcome": "ESCALAR", "trap": "no cuadra con el retainer", "check": "acuerdo", "also": ["umbral_aprobacion"], "issue": 0, "due": 45, "raw_text": null,
      "fields": { "payee_name": "Laura Méndez", "amount": 3100, "currency": "USD", "invoice_number": "1044", "concept": "Retainer mensual y horas adicionales", "bank_account": "Bancolombia ahorros 0012-3456-4821" },
      "reason": "3.100 USD contra retainer de 2.500 (24 % > tolerancia 1 %): no cuadra con lo acordado. 3.100 también supera el umbral 2.500 (inevitable, D25 fija el umbral). Saldo 14.270,21 + 3.100 cumple." },
    { "nn": "21", "source": "image", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": { "payee_name": "Forma Studio", "amount": 1500, "currency": "EUR", "invoice_number": "FS-124", "concept": "Fotografía de producto", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332" },
      "reason": "1.500 EUR × 1,08 = 1.620 USD. Presupuesto 28.670,41 + 1.620; saldo 14.270,21 + 1.620: cumplen." },
    { "nn": "22", "source": "pdf", "expected_outcome": "ESCALAR", "trap": "COP sobre el umbral de aprobación", "check": "umbral_aprobacion", "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": { "payee_name": "Forma Studio", "amount": 13000000, "currency": "COP", "invoice_number": "FS-126", "concept": "Stand para feria en Bogotá", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332" },
      "reason": "13.000.000 COP × 0,000245 = 3.185 USD > umbral 2.500 y ≤ límite 5.000 (el caso extra de R-07). Acuerdo único. Saldo 15.890,21 + 3.185 = 19.075,21 ≤ 23.000." },
    { "nn": "23", "source": "chat", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45,
      "raw_text": "[Slack] Northstar Group: Factura NS-2214, revisión de infraestructura, 5 h.\nNorthstar Group: USD 400.00 por ACH routing 121000358 cuenta 990112468. Vence en 45 días.",
      "fields": { "payee_name": "Northstar Group", "amount": 400, "currency": "USD", "invoice_number": "NS-2214", "concept": "Revisión de infraestructura", "bank_account": "ACH routing 121000358 cuenta 990112468" },
      "reason": "400 USD; horas del mes 1.600 ≤ tope 2.000. Presupuesto 33.475,41 + 400; saldo 15.890,21 + 400: cumplen." },
    { "nn": "24", "source": "email", "expected_outcome": "ESCALAR", "trap": "vencida", "check": "vencimiento", "also": [], "issue": -40, "due": -10,
      "raw_text": "De: Contadores Andinos S.A.S. <cartera@contadoresandinos.example>\nAsunto: Factura CA-5498 vencida\n\nBuenos días,\nles recordamos la factura CA-5498 por la contabilidad y nómina del mes anterior, que venció hace 10 días.\nValor: COP 3.673.500\nDavivienda corriente 4569-8812-0034\n\nCordialmente,\nContadores Andinos",
      "fields": { "payee_name": "Contadores Andinos S.A.S.", "amount": 3673500, "currency": "COP", "invoice_number": "CA-5498", "concept": "Contabilidad y nómina del mes anterior", "bank_account": "Davivienda corriente 4569-8812-0034" },
      "reason": "Vence 10 días antes de llegar (gracia 0): vencida. Llegó este mes, monto = retainer de 900, concepto distinto del de la #07. Presupuesto y saldo cumplen." },
    { "nn": "25", "source": "email", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45,
      "raw_text": "De: Diego Ruiz <diego@ruiz.example>\nAsunto: Factura DR-034\n\nHola, adjunto la DR-034 por las pruebas automatizadas del módulo de pagos.\nTotal: MXN 12.000,00\nBBVA México CLABE 012180001534779908\nVence en 45 días.\n\nDiego",
      "fields": { "payee_name": "Diego Ruiz", "amount": 12000, "currency": "MXN", "invoice_number": "DR-034", "concept": "Pruebas automatizadas del módulo de pagos", "bank_account": "BBVA México CLABE 012180001534779908" },
      "reason": "12.000 MXN × 0,054 = 648 USD; horas del mes 2.106 ≤ 3.000. Presupuesto 34.775,42 + 648; saldo 16.290,21 + 648: cumplen." },
    { "nn": "26", "source": "pdf", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": { "payee_name": "Forma Studio", "amount": 1300, "currency": "EUR", "invoice_number": "FS-127", "concept": "Ilustraciones para el sitio web", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332" },
      "reason": "1.300 EUR × 1,08 = 1.404 USD. Presupuesto 35.423,42 + 1.404 = 36.827,42; saldo 16.938,21 + 1.404 = 18.342,21: cumplen." },
    { "nn": "27", "source": "chat", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45,
      "raw_text": "[Slack] Northstar Group: Última del mes: NS-2219, soporte de incidentes, 2 h.\nNorthstar Group: USD 160.00, ACH routing 121000358 cuenta 990112468. Vence en 45 días.",
      "fields": { "payee_name": "Northstar Group", "amount": 160, "currency": "USD", "invoice_number": "NS-2219", "concept": "Soporte de incidentes", "bank_account": "ACH routing 121000358 cuenta 990112468" },
      "reason": "160 USD; horas del mes 1.760 ≤ 2.000. Presupuesto 36.827,42 + 160 = 36.987,42; saldo 18.342,21 + 160 = 18.502,21: cumplen." },
    { "nn": "28", "source": "pdf", "expected_outcome": "ESCALAR", "trap": "supera el saldo de la cuenta", "check": "saldo_cuenta", "also": ["umbral_aprobacion"], "issue": 0, "due": 45, "raw_text": null,
      "fields": { "payee_name": "Forma Studio", "amount": 4300, "currency": "EUR", "invoice_number": "FS-129", "concept": "Rediseño del sitio web", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332" },
      "reason": "4.300 EUR × 1,08 = 4.644 USD. Pagado 18.502,21 + 4.644 = 23.146,21 > saldo 23.000: saldo insuficiente. Comprometido 36.987,42 + 4.644 = 41.631,42 ≤ presupuesto 42.000 (cumple). 4.644 también supera el umbral 2.500 y no el límite 5.000; acuerdo único (R-35)." },
    { "nn": "29", "source": "chat", "expected_outcome": "ESCALAR", "trap": "agota el presupuesto del mes", "check": "presupuesto_periodo", "also": [], "issue": 0, "due": 45,
      "raw_text": "[WhatsApp] Diego Ruiz: Última del mes, DR-035: integración con la pasarela de pagos.\nDiego Ruiz: MXN 15.000,00 a la CLABE 012180001534779908. Vence en 45 días.",
      "fields": { "payee_name": "Diego Ruiz", "amount": 15000, "currency": "MXN", "invoice_number": "DR-035", "concept": "Integración con la pasarela de pagos", "bank_account": "BBVA México CLABE 012180001534779908" },
      "reason": "15.000 MXN × 0,054 = 810 USD. Comprometido (pagado + escalado pendiente) 41.631,42 + 810 = 42.441,42 > presupuesto 42.000. Pagado 18.502,21 + 810 = 19.312,21 ≤ saldo 23.000 (cumple); horas 2.916 ≤ 3.000." }
  ]
}
$seed$;
  v_start constant timestamptz := date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota';
begin
  if p_reset then
    update public.invoices set archived = true where company_id = p_company and not archived;
    update public.beneficiaries set archived = true, updated_at = now()
      where company_id = p_company and not archived
        and name not in (select b ->> 'name' from jsonb_array_elements(v -> 'beneficiaries') b);
  end if;
  -- Seed: v1 only if the company has no policy. Reset: the seed rules as version max+1 (policies are append-only).
  insert into public.policies (company_id, version, name, rules)
    select p_company, coalesce(max(version), 0) + 1, 'Política general', v -> 'rules'
    from public.policies where company_id = p_company having p_reset or count(*) = 0;
  -- Upsert by (company_id, name), without a unique index a live database might refuse; reset_demo_company holds the lock.
  update public.beneficiaries t set country = s.country, currency = s.currency, bank_account = s.bank_account, route = s.route,
      category = s.category, archived = false, updated_at = now(),
      agreement = s.agreement || jsonb_build_object('valid_until', (now() at time zone 'America/Bogota')::date + 365)
    from jsonb_to_recordset(v -> 'beneficiaries') s(name text, country text, currency text, bank_account text, route text, category text, agreement jsonb)
    where t.company_id = p_company and t.name = s.name;
  insert into public.beneficiaries (company_id, name, country, currency, bank_account, route, category, agreement)
    select p_company, s.name, s.country, s.currency, s.bank_account, s.route, s.category,
      s.agreement || jsonb_build_object('valid_until', (now() at time zone 'America/Bogota')::date + 365)
    from jsonb_to_recordset(v -> 'beneficiaries') s(name text, country text, currency text, bank_account text, route text, category text, agreement jsonb)
    where not exists (select 1 from public.beneficiaries t where t.company_id = p_company and t.name = s.name);
  insert into public.invoices (id, company_id, source, file_path, raw_text, fields, expected_outcome, received_at)
    select case when p_reset then gen_random_uuid() else md5(p_company::text || s.nn)::uuid end, p_company, s.source,
      case s.source when 'pdf' then '/demo/invoices/' || s.nn || '.pdf' when 'image' then '/demo/invoices/' || s.nn || '.png' end,
      s.raw_text,
      s.fields || jsonb_build_object('issue_date', d.day + s.issue, 'due_date', d.day + s.due, 'confidence',
        case when s.fields ->> 'amount' is null then '{}'::jsonb else '{"payee_name": 0.97, "amount": 0.97, "currency": 0.99,
          "invoice_number": 0.95, "issue_date": 0.95, "due_date": 0.95, "concept": 0.93, "bank_account": 0.96}'::jsonb end),
      s.expected_outcome, a.at
    from jsonb_to_recordset(v -> 'invoices') s(nn text, source text, raw_text text, fields jsonb, expected_outcome text,
      prev_month boolean, issue int, due int)
    cross join lateral (select case when s.prev_month then v_start - interval '5 days'
      else v_start + (now() - v_start) * (s.nn::int / 30.0) end) a(at)
    cross join lateral (select (a.at at time zone 'America/Bogota')::date) d(day)
    on conflict (id) do nothing;
end $fn$;
revoke execute on function public.andina_seed(uuid, boolean) from public, anon, authenticated;

-- AC-03: the signup trigger's seed (Task 2 stub replaced; its revoke from members survives the replace).
create or replace function public.seed_company(p_company uuid) returns void
language plpgsql set search_path = '' as $$ begin perform public.andina_seed(p_company, false); end $$;

-- R-41: the database assigns the policy version, whatever the caller sent (a member could send 2147483647 and break
-- reset's max+1). security definer so the max sees every row of the company regardless of RLS (members, seed and
-- reset alike). Two concurrent inserts: unique (company_id, version) is the backstop, one of them errors; no lock.
create function public.policies_assign_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.version := coalesce((select max(p.version) from public.policies p where p.company_id = new.company_id), 0) + 1;
  return new;
end $$;
create trigger policies_assign_version before insert on public.policies
  for each row execute function public.policies_assign_version();

-- AC-47 "Reiniciar demo". security definer so andina_seed stays out of members' reach (as invoker, any member could
-- archive and re-seed a non-demo company through REST). Scope: the caller's own company, found by auth.uid()
-- membership and is_demo; every write inside is keyed by that id. Never deletes: archive, append, upsert.
-- The company lock is insert_decision's, so a reset and an agent decision never interleave. 42501 = 403 in PostgREST.
create or replace function public.reset_demo_company() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  select m.company_id into v_company from public.company_members m join public.companies c on c.id = m.company_id
    where m.user_id = auth.uid() and c.is_demo;
  if v_company is null then raise exception 'NOT_DEMO' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(v_company::text));
  perform public.andina_seed(v_company, true);
  return v_company;
end $$;
revoke execute on function public.reset_demo_company() from public, anon;
grant execute on function public.reset_demo_company() to authenticated;
