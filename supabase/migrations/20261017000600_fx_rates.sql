-- Task 21 market FX (D28; AC-73, AC-75, AC-38 (a), AC-68 Clarified; R-85, R-86). Forward-only and additive.

-- AC-73: one row per (UTC day, currency), USD per unit as 1 / the provider's quote (8 significant digits). Upserted,
-- never deleted. Signed-in members read it; nobody but the service role (src/agent/record.ts) writes it (R-85.5).
create table public.fx_rates (
  day date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  usd_per_unit numeric not null check (usd_per_unit > 0),
  source text not null,
  fetched_at timestamptz not null,
  primary key (day, currency)
);
alter table public.fx_rates enable row level security;
create policy members_select_fx_rates on public.fx_rates for select to authenticated
  using (exists (select 1 from public.company_members m where m.user_id = auth.uid()));
revoke all on public.fx_rates from public, anon, authenticated;
grant select on public.fx_rates to authenticated;
grant select, insert, update on public.fx_rates to service_role;

-- The newest row per currency (the agent, the preview, approvals and GET /api/fx). security_invoker: the RLS above applies.
create view public.fx_latest with (security_invoker = true) as
  select distinct on (currency) day, currency, usd_per_unit, source, fetched_at
  from public.fx_rates order by currency, day desc, fetched_at desc;
revoke all on public.fx_latest from public, anon, authenticated;
grant select on public.fx_latest to authenticated, service_role;

-- AC-75, R-85.1, R-86: the seed and "Reiniciar demo" write a policy with no pinned rates (fx_rates {}), so the demo uses
-- market rates. Amounts and currencies changed so every expected outcome and the R-35 sequence hold for any rate within
-- ±20 % of the 17 Oct market rates (src/engine/__fixtures__/seed.ts): see docs/demo/DATASET.md. seed_company and
-- reset_demo_company call andina_seed, so replacing it changes both. Same signature, same body; only the data differs.
create or replace function public.andina_seed(p_company uuid, p_reset boolean) returns void
language plpgsql set search_path = '' as $fn$
declare
  v constant jsonb := $seed$
{
  "rules": {"per_payment_limit_usd": 5000, "approval_threshold_usd": 2500, "period_budget_usd": 42000, "account_balance_usd": 23000, "duplicate_window_days": 30, "agreement_tolerance_pct": 1, "due_grace_days": 0, "fx_rates": {}, "allowed_beneficiaries_only": true},
  "beneficiaries": [
    {"name": "Laura Méndez", "country": "CO", "currency": "USD", "bank_account": "Bancolombia ahorros 0012-3456-4821", "route": "COP · transferencia", "category": "Desarrollo", "agreement": {"type": "retainer", "amount_usd": 2500, "period": "monthly"}},
    {"name": "Diego Ruiz", "country": "MX", "currency": "MXN", "bank_account": "BBVA México CLABE 012180001534779908", "route": "MXN", "category": "Desarrollo", "agreement": {"type": "hourly", "amount_usd": 45, "cap_usd": 3000, "period": "monthly"}},
    {"name": "Ana Souza", "country": "BR", "currency": "BRL", "bank_account": "Pix chave 11 98765-4302", "route": "Pix", "category": "Diseño", "agreement": {"type": "retainer", "amount_usd": 1800, "period": "monthly"}},
    {"name": "Martín López", "country": "AR", "currency": "ARS", "bank_account": "CBU 0170099220000067853214", "route": "CBU", "category": "Desarrollo", "agreement": {"type": "retainer", "amount_usd": 2200, "period": "monthly"}},
    {"name": "Nube Sur LLC", "country": "US", "currency": "USD", "bank_account": "ACH routing 026009593 cuenta 483920175", "route": "ACH", "category": "Software", "agreement": {"type": "subscription", "amount_usd": 4200, "period": "monthly"}},
    {"name": "Forma Studio", "country": "ES", "currency": "EUR", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332", "route": "SWIFT", "category": "Diseño", "agreement": {"type": "one_off"}},
    {"name": "Contadores Andinos SAS", "country": "CO", "currency": "COP", "bank_account": "Davivienda corriente 4569-8812-0034", "route": "COP", "category": "Contabilidad", "agreement": {"type": "retainer", "amount_usd": 900, "period": "monthly"}},
    {"name": "Northstar Group", "country": "US", "currency": "USD", "bank_account": "ACH routing 121000358 cuenta 990112468", "route": "ACH", "category": "Consultoría", "agreement": {"type": "hourly", "amount_usd": 80, "cap_usd": 2000, "period": "monthly"}}
  ],
  "invoices": [
    {"nn": "01", "source": "pdf", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": {"payee_name": "Laura Méndez", "amount": 2500, "currency": "USD", "invoice_number": "1042", "concept": "Retainer mensual de desarrollo", "bank_account": "Bancolombia ahorros 0012-3456-4821"},
      "reason": "Retainer de 2.500 USD igual al acuerdo, cuenta registrada, 2.500 ≤ umbral 2.500. Presupuesto 0 + 2.500 ≤ 42.000; saldo 0 + 2.500 ≤ 23.000." },
    {"nn": "02", "source": "email", "expected_outcome": "ESCALAR", "trap": "fuera del periodo", "check": "periodo", "also": [], "prev_month": true, "issue": -1, "due": 45, "raw_text": "De: Forma Studio <facturas@forma.example>\nAsunto: Factura FS-114\n\nHola,\nadjuntamos la factura FS-114 por las piezas para redes sociales del mes pasado.\nImporte: EUR 850,00\nIBAN ES91 2100 0418 4502 0005 1332 (SWIFT CAIXESBBXXX)\nVence en 45 días.\n\nUn saludo,\nForma Studio",
      "fields": {"payee_name": "Forma Studio", "amount": 850, "currency": "EUR", "invoice_number": "FS-114", "concept": "Piezas para redes sociales", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332"},
      "reason": "Llegó el mes anterior (recibida = inicio del mes − 5 días): solo falla Periodo. Es la más antigua, así que se decide primero; no cuenta en el mes. 850 EUR a la tasa de mercado ≈ 955,59 USD (acuerdo único)." },
    {"nn": "03", "source": "image", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": {"payee_name": "Ana Souza", "amount": 1800, "currency": "USD", "invoice_number": "AS-0087", "concept": "Diseño de producto, retainer mensual", "bank_account": "Pix chave 11 98765-4302"},
      "reason": "Retainer de 1.800 USD igual al acuerdo, cuenta Pix registrada. Presupuesto 2.500 + 1.800 ≤ 42.000; saldo 2.500 + 1.800 ≤ 23.000." },
    {"nn": "04", "source": "pdf", "expected_outcome": "FRENAR", "trap": "sobre el límite por pago", "check": "limite_pago", "also": ["umbral_aprobacion", "acuerdo"], "issue": 0, "due": 45, "raw_text": null,
      "fields": {"payee_name": "Martín López", "amount": 10000000, "currency": "ARS", "invoice_number": "ML-0305", "concept": "Desarrollo de app móvil, proyecto completo", "bank_account": "CBU 0170099220000067853214"},
      "reason": "10.000.000 ARS × tasa de mercado ≈ 6.589,79 USD > límite por pago 5.000: FRENAR (sigue > 5.000 con la tasa 20 % más baja). También supera el umbral 2.500 y no es el retainer de 2.200 (inevitable con ese monto)." },
    {"nn": "05", "source": "chat", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": "[WhatsApp] Diego Ruiz: Hola! Te paso la factura DR-031 por la API de conciliación.\nDiego Ruiz: Total MXN 3.000,00\nDiego Ruiz: Depósito a BBVA México CLABE 012180001534779908. Vence en 45 días. Gracias!",
      "fields": {"payee_name": "Diego Ruiz", "amount": 3000, "currency": "MXN", "invoice_number": "DR-031", "concept": "Desarrollo backend: API de conciliación", "bank_account": "BBVA México CLABE 012180001534779908"},
      "reason": "3.000 MXN × tasa de mercado ≈ 162,35 USD; horas del mes muy por debajo del tope 3.000. Presupuesto 4.300 + 162,35; saldo igual: cumplen." },
    {"nn": "06", "source": "pdf", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": {"payee_name": "Martín López", "amount": 2200, "currency": "USD", "invoice_number": "ML-0310", "concept": "Desarrollo frontend, retainer mensual", "bank_account": "CBU 0170099220000067853214"},
      "reason": "Retainer de 2.200 USD igual al acuerdo. Presupuesto 4.462,35 + 2.200; saldo igual: cumplen." },
    {"nn": "07", "source": "pdf", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": {"payee_name": "Contadores Andinos S.A.S.", "amount": 900, "currency": "USD", "invoice_number": "CA-5521", "concept": "Contabilidad y nómina del mes", "bank_account": "Davivienda corriente 4569-8812-0034"},
      "reason": "Retainer de 900 USD igual al acuerdo. El nombre con \"S.A.S.\" coincide con el directorio sin sufijo. Presupuesto 6.662,35 + 900 cumple." },
    {"nn": "08", "source": "pdf", "expected_outcome": "FRENAR", "trap": "COP sobre el límite por pago", "check": "limite_pago", "also": ["umbral_aprobacion", "acuerdo"], "issue": 0, "due": 45, "raw_text": null,
      "fields": {"payee_name": "Contadores Andinos S.A.S.", "amount": 25000000, "currency": "COP", "invoice_number": "CA-5530", "concept": "Revisoría fiscal y auditoría anual", "bank_account": "Davivienda corriente 4569-8812-0034"},
      "reason": "25.000.000 COP × tasa de mercado ≈ 7.884,74 USD > límite 5.000: FRENAR (R-07; sigue > 5.000 con la tasa 20 % más baja). También supera el umbral y el retainer de 900 (inevitable)." },
    {"nn": "09", "source": "pdf", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": {"payee_name": "Forma Studio", "amount": 2400, "currency": "USD", "invoice_number": "FS-118", "concept": "Identidad visual, fase 1", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332"},
      "reason": "2.400 USD ≤ umbral 2.500; acuerdo único. Presupuesto 7.562,35 + 2.400; saldo igual: cumplen." },
    {"nn": "10", "source": "email", "expected_outcome": "FRENAR", "trap": "duplicado exacto", "check": "duplicado_exacto", "also": [], "issue": 0, "due": 45, "raw_text": "De: Ana Souza <ana@souza.example>\nAsunto: Factura AS-0087\n\nOi! Reenvío la factura AS-0087 del retainer de diseño de producto, por si no les llegó.\nValor: USD 1.800,00\nPix chave 11 98765-4302\nVence en 45 días.\n\nAbraço,\nAna",
      "fields": {"payee_name": "Ana Souza", "amount": 1800, "currency": "USD", "invoice_number": "AS-0087", "concept": "Diseño de producto, retainer mensual", "bank_account": "Pix chave 11 98765-4302"},
      "reason": "Mismo beneficiario y mismo número AS-0087 que la #03, dentro de la ventana de 30 días: FRENAR. Todo lo demás cumple." },
    {"nn": "11", "source": "pdf", "expected_outcome": "ESCALAR", "trap": "sobre el umbral de aprobación", "check": "umbral_aprobacion", "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": {"payee_name": "Nube Sur LLC", "amount": 4200, "currency": "USD", "invoice_number": "2044", "concept": "Suscripción mensual plataforma de datos", "bank_account": "ACH routing 026009593 cuenta 483920175"},
      "reason": "La del video (D25): 4.200 USD > umbral 2.500 y ≤ límite 5.000; es la suscripción acordada. Presupuesto 9.962,35 + 4.200; saldo 9.962,35 + 4.200: cumplen." },
    {"nn": "12", "source": "email", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": "De: Northstar Group <billing@northstar.example>\nAsunto: Factura NS-2207\n\nHola,\nadjuntamos la factura NS-2207: consultoría de seguridad en la nube, 15 horas a USD 80.\nTotal: USD 1,200.00\nPago por ACH: routing 121000358 cuenta 990112468.\nVence en 45 días.\n\nNorthstar Group",
      "fields": {"payee_name": "Northstar Group", "amount": 1200, "currency": "USD", "invoice_number": "NS-2207", "concept": "Consultoría de seguridad en la nube", "bank_account": "ACH routing 121000358 cuenta 990112468"},
      "reason": "1.200 USD, horas del mes 1.200 ≤ tope 2.000. Presupuesto 14.162,35 + 1.200; saldo 9.962,35 + 1.200: cumplen." },
    {"nn": "13", "source": "chat", "expected_outcome": "ESCALAR", "trap": "beneficiario nuevo", "check": "beneficiario_permitido", "also": ["beneficiario_cuenta", "acuerdo"], "issue": 0, "due": 45, "raw_text": "[Slack] Pixel Lab: Olá, somos Pixel Lab, de São Paulo. Les compartimos la factura PX-0007 por la landing page.\nPixel Lab: Total BRL 1.500,00\nPixel Lab: Banco Itaú agência 0341 conta 45009-8. Vence en 45 días.",
      "fields": {"payee_name": "Pixel Lab", "amount": 1500, "currency": "BRL", "invoice_number": "PX-0007", "concept": "Desarrollo de landing page", "bank_account": "Banco Itaú agência 0341 conta 45009-8"},
      "reason": "Pixel Lab no está en el directorio: beneficiario nuevo. Sin ficha no se pueden comparar cuenta ni acuerdo (no verificables). 1.500 BRL ≈ 295,90 USD, dentro de umbral, presupuesto y saldo." },
    {"nn": "14", "source": "email", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": "De: Diego Ruiz <diego@ruiz.example>\nAsunto: Factura DR-032\n\nHola, va la factura DR-032 por la corrección de errores en pagos recurrentes.\nTotal: MXN 2.500,00\nBBVA México CLABE 012180001534779908\nVence en 45 días.\n\nDiego",
      "fields": {"payee_name": "Diego Ruiz", "amount": 2500, "currency": "MXN", "invoice_number": "DR-032", "concept": "Corrección de errores en pagos recurrentes", "bank_account": "BBVA México CLABE 012180001534779908"},
      "reason": "2.500 MXN ≈ 135,29 USD; horas del mes ≈ 297,64 ≤ 3.000. Presupuesto 15.658,25 + 135,29; saldo 11.162,35 + 135,29: cumplen." },
    {"nn": "15", "source": "email", "expected_outcome": "ESCALAR", "trap": "cuenta cambiada", "check": "beneficiario_cuenta", "also": [], "issue": 0, "due": 45, "raw_text": "De: Laura Méndez <laura.mendez@correo.example>\nAsunto: Factura 1043 y nueva cuenta\n\nHola equipo,\nles envío la factura 1043 por las integraciones (hito 2). Cambié de banco: por favor paguen a Nequi 300-555-7310.\nTotal: USD 2.500\nVence en 45 días.\n\nGracias,\nLaura",
      "fields": {"payee_name": "Laura Méndez", "amount": 2500, "currency": "USD", "invoice_number": "1043", "concept": "Desarrollo de integraciones, hito 2", "bank_account": "Nequi 300-555-7310"},
      "reason": "Laura Méndez existe, pero la cuenta de la factura termina en 7310 y la registrada en 4821: cuenta cambiada. Monto igual al retainer, dentro de umbral, presupuesto y saldo." },
    {"nn": "16", "source": "email", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": "De: Forma Studio <facturas@forma.example>\nAsunto: Factura FS-121\n\nHola,\nadjuntamos la factura FS-121 por las plantillas de presentación comercial.\nImporte: USD 2.250,00\nIBAN ES91 2100 0418 4502 0005 1332 (SWIFT CAIXESBBXXX)\nVence en 45 días.\n\nUn saludo,\nForma Studio",
      "fields": {"payee_name": "Forma Studio", "amount": 2250, "currency": "USD", "invoice_number": "FS-121", "concept": "Plantillas de presentación comercial", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332"},
      "reason": "2.250 USD ≤ umbral; acuerdo único. Presupuesto 18.293,54 + 2.250; saldo 11.297,64 + 2.250: cumplen." },
    {"nn": "17", "source": "email", "expected_outcome": "ESCALAR", "trap": "duplicado con otro número", "check": "duplicado_probable", "also": [], "issue": 0, "due": 45, "raw_text": "De: Martín López <martin@lopez.example>\nAsunto: Factura ML-0311\n\nHola, les paso la factura ML-0311 del retainer de desarrollo frontend.\nTotal: USD 2.200,00\nCBU 0170099220000067853214\nVence en 45 días.\n\nSaludos,\nMartín",
      "fields": {"payee_name": "Martín López", "amount": 2200, "currency": "USD", "invoice_number": "ML-0311", "concept": "Desarrollo frontend, retainer mensual", "bank_account": "CBU 0170099220000067853214"},
      "reason": "Mismo beneficiario, mismo concepto y mismo mes que la #06, con otro número (ML-0311 vs ML-0310): posible duplicado. Monto y cuenta cumplen." },
    {"nn": "18", "source": "image", "expected_outcome": "ESCALAR", "trap": "ilegible", "check": "lectura", "also": ["beneficiario_permitido", "beneficiario_cuenta", "acuerdo", "duplicado_exacto", "duplicado_probable", "limite_pago", "umbral_aprobacion", "presupuesto_periodo", "saldo_cuenta", "vencimiento", "moneda"], "issue": null, "due": null, "raw_text": null,
      "fields": {"payee_name": null, "amount": null, "currency": null, "invoice_number": null, "concept": "ilegible", "bank_account": null},
      "reason": "Foto borrosa: no se lee ningún campo, Lectura no se pudo verificar. Todo control que necesita un campo queda no verificable; solo Periodo (por fecha de llegada) cumple." },
    {"nn": "19", "source": "chat", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": "[WhatsApp] Diego Ruiz: Te mando la DR-033, migración de base de datos.\nDiego Ruiz: MXN 3.000,00 a la CLABE 012180001534779908. Vence en 45 días.",
      "fields": {"payee_name": "Diego Ruiz", "amount": 3000, "currency": "MXN", "invoice_number": "DR-033", "concept": "Migración de base de datos", "bank_account": "BBVA México CLABE 012180001534779908"},
      "reason": "3.000 MXN ≈ 162,35 USD; horas del mes ≈ 459,99 ≤ 3.000. Presupuesto 22.743,54 + 162,35; saldo 13.547,64 + 162,35: cumplen." },
    {"nn": "20", "source": "pdf", "expected_outcome": "ESCALAR", "trap": "no cuadra con el retainer", "check": "acuerdo", "also": ["umbral_aprobacion"], "issue": 0, "due": 45, "raw_text": null,
      "fields": {"payee_name": "Laura Méndez", "amount": 3200, "currency": "USD", "invoice_number": "1044", "concept": "Retainer mensual y horas adicionales", "bank_account": "Bancolombia ahorros 0012-3456-4821"},
      "reason": "3.200 USD contra retainer de 2.500 (28 % > tolerancia 1 %): no cuadra con lo acordado. 3.200 también supera el umbral 2.500 (inevitable, D25 fija el umbral). Saldo 13.709,99 + 3.200 cumple." },
    {"nn": "21", "source": "image", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": {"payee_name": "Forma Studio", "amount": 2000, "currency": "USD", "invoice_number": "FS-124", "concept": "Fotografía de producto", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332"},
      "reason": "2.000 USD ≤ umbral; acuerdo único. Presupuesto 26.105,89 + 2.000; saldo 13.709,99 + 2.000: cumplen." },
    {"nn": "22", "source": "pdf", "expected_outcome": "ESCALAR", "trap": "COP sobre el umbral de aprobación", "check": "umbral_aprobacion", "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": {"payee_name": "Forma Studio", "amount": 13000000, "currency": "COP", "invoice_number": "FS-126", "concept": "Stand para feria en Bogotá", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332"},
      "reason": "13.000.000 COP × tasa de mercado ≈ 4.100,07 USD > umbral 2.500 y ≤ límite 5.000 (el caso extra de R-07; con la tasa ±20 % sigue entre 3.280 y 4.920). Acuerdo único. Saldo 15.709,99 + 4.100,07 ≤ 23.000." },
    {"nn": "23", "source": "chat", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": "[Slack] Northstar Group: Factura NS-2214, revisión de infraestructura, 5 h.\nNorthstar Group: USD 400.00 por ACH routing 121000358 cuenta 990112468. Vence en 45 días.",
      "fields": {"payee_name": "Northstar Group", "amount": 400, "currency": "USD", "invoice_number": "NS-2214", "concept": "Revisión de infraestructura", "bank_account": "ACH routing 121000358 cuenta 990112468"},
      "reason": "400 USD; horas del mes 1.600 ≤ tope 2.000. Presupuesto 32.205,96 + 400; saldo 15.709,99 + 400: cumplen." },
    {"nn": "24", "source": "email", "expected_outcome": "ESCALAR", "trap": "vencida", "check": "vencimiento", "also": [], "issue": -40, "due": -10, "raw_text": "De: Contadores Andinos S.A.S. <cartera@contadoresandinos.example>\nAsunto: Factura CA-5498 vencida\n\nBuenos días,\nles recordamos la factura CA-5498 por la contabilidad y nómina del mes anterior, que venció hace 10 días.\nValor: USD 900,00\nDavivienda corriente 4569-8812-0034\n\nCordialmente,\nContadores Andinos",
      "fields": {"payee_name": "Contadores Andinos S.A.S.", "amount": 900, "currency": "USD", "invoice_number": "CA-5498", "concept": "Contabilidad y nómina del mes anterior", "bank_account": "Davivienda corriente 4569-8812-0034"},
      "reason": "Vence 10 días antes de llegar (gracia 0): vencida. Llegó este mes, monto = retainer de 900, concepto distinto del de la #07. Presupuesto y saldo cumplen." },
    {"nn": "25", "source": "email", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": "De: Diego Ruiz <diego@ruiz.example>\nAsunto: Factura DR-034\n\nHola, adjunto la DR-034 por las pruebas automatizadas del módulo de pagos.\nTotal: MXN 3.500,00\nBBVA México CLABE 012180001534779908\nVence en 45 días.\n\nDiego",
      "fields": {"payee_name": "Diego Ruiz", "amount": 3500, "currency": "MXN", "invoice_number": "DR-034", "concept": "Pruebas automatizadas del módulo de pagos", "bank_account": "BBVA México CLABE 012180001534779908"},
      "reason": "3.500 MXN ≈ 189,40 USD; horas del mes ≈ 649,39 ≤ 3.000. Presupuesto 33.505,96 + 189,40; saldo 16.109,99 + 189,40: cumplen." },
    {"nn": "26", "source": "pdf", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": null,
      "fields": {"payee_name": "Forma Studio", "amount": 1950, "currency": "USD", "invoice_number": "FS-127", "concept": "Ilustraciones para el sitio web", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332"},
      "reason": "1.950 USD. Presupuesto 33.695,36 + 1.950 = 35.645,36; saldo 16.299,39 + 1.950 = 18.249,39: cumplen." },
    {"nn": "27", "source": "chat", "expected_outcome": "PAGAR", "trap": "normal", "check": null, "also": [], "issue": 0, "due": 45, "raw_text": "[Slack] Northstar Group: Última del mes: NS-2219, soporte de incidentes, 2 h.\nNorthstar Group: USD 160.00, ACH routing 121000358 cuenta 990112468. Vence en 45 días.",
      "fields": {"payee_name": "Northstar Group", "amount": 160, "currency": "USD", "invoice_number": "NS-2219", "concept": "Soporte de incidentes", "bank_account": "ACH routing 121000358 cuenta 990112468"},
      "reason": "160 USD; horas del mes 1.760 ≤ 2.000. Presupuesto 35.645,36 + 160 = 35.805,36; saldo 18.249,39 + 160 = 18.409,39: cumplen." },
    {"nn": "28", "source": "pdf", "expected_outcome": "ESCALAR", "trap": "supera el saldo de la cuenta", "check": "saldo_cuenta", "also": ["umbral_aprobacion"], "issue": 0, "due": 45, "raw_text": null,
      "fields": {"payee_name": "Forma Studio", "amount": 4950, "currency": "USD", "invoice_number": "FS-129", "concept": "Rediseño del sitio web", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332"},
      "reason": "4.950 USD. Pagado 18.409,39 + 4.950 = 23.359,39 > saldo 23.000: saldo insuficiente. Comprometido 35.805,36 + 4.950 = 40.755,36 ≤ presupuesto 42.000 (cumple). 4.950 también supera el umbral 2.500 y no el límite 5.000; acuerdo único (R-35). En USD, para que la trampa no dependa de la tasa (R-86)." },
    {"nn": "29", "source": "chat", "expected_outcome": "ESCALAR", "trap": "agota el presupuesto del mes", "check": "presupuesto_periodo", "also": [], "issue": 0, "due": 45, "raw_text": "[WhatsApp] Forma Studio: Última del mes, FS-131: campaña de lanzamiento.\nForma Studio: USD 2.450,00 al IBAN ES91 2100 0418 4502 0005 1332. Vence en 45 días.",
      "fields": {"payee_name": "Forma Studio", "amount": 2450, "currency": "USD", "invoice_number": "FS-131", "concept": "Campaña de lanzamiento", "bank_account": "IBAN ES91 2100 0418 4502 0005 1332"},
      "reason": "2.450 USD ≤ umbral; acuerdo único. Comprometido (pagado + escalado pendiente) 40.755,36 + 2.450 = 43.205,36 > presupuesto 42.000. Pagado 18.409,39 + 2.450 = 20.859,39 ≤ saldo 23.000 (cumple)." }
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
