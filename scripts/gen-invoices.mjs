// Task 3 (AC-09): renders the Andina Labs seed documents and docs/demo/DATASET.md from the seed JSON in the migration.
// Usage: node scripts/gen-invoices.mjs   (Playwright from the project or the global install, Chromium at /opt/pw-browsers)
// PDFs keep a text layer (page.pdf); `image` invoices are PNG screenshots; #18 is blurred on purpose (illegible trap).
// Document dates are relative to the day this runs; the seeded rows' dates are relative to seeding time (R-09).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const MIG = 'supabase/migrations/20261017000600_fx_rates.sql'; // the latest andina_seed (Task 21, AC-75)
const OUT = 'web/public/demo/invoices';
const seed = JSON.parse(readFileSync(MIG, 'utf8').match(/\$seed\$([\s\S]*?)\$seed\$/)[1]);
const money = (n, c) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: c === 'COP' ? 0 : 2, maximumFractionDigits: c === 'COP' ? 0 : 2 }).format(n);
const day = (offset) => new Date(Date.now() + offset * 864e5).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'long', year: 'numeric' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// #18 has no readable fields by design; the paper under the blur still looks like an invoice.
const ILLEGIBLE = { payee_name: 'Servicios Gráficos del Valle', amount: 1870000, currency: 'COP', invoice_number: 'SGV-2231', concept: 'Impresión de material', bank_account: 'Banco de Occidente 0231-77' };

const html = (i) => {
  const f = i.fields.amount === null ? ILLEGIBLE : i.fields;
  const photo = i.source === 'image';
  return `<!doctype html><html lang="es"><meta charset="utf-8"><style>
  body { margin: 0; font: 14px/1.6 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #2F3437; background: ${photo ? '#d9d6cf' : '#fff'}; }
  .doc { width: 680px; padding: 56px 64px; background: #fff; ${photo ? 'margin: 40px; transform: rotate(-1.2deg); box-shadow: 0 2px 12px rgba(0,0,0,.08);' : ''} ${i.nn === '18' ? 'filter: blur(7px);' : ''} }
  h1 { font: 600 26px/1.1 Georgia, 'Times New Roman', serif; letter-spacing: -0.02em; margin: 0 0 4px; color: #111; }
  .muted { color: #787774; } .row { display: flex; justify-content: space-between; gap: 24px; margin-top: 32px; }
  table { width: 100%; border-collapse: collapse; margin-top: 40px; } td, th { text-align: left; padding: 10px 0; border-bottom: 1px solid #EAEAEA; }
  th { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: #787774; font-weight: 500; } .r { text-align: right; }
  .total td { font-weight: 600; color: #111; border-bottom: 0; } .pay { margin-top: 40px; padding-top: 16px; border-top: 1px solid #EAEAEA; }
  </style><div class="doc" id="doc">
  <h1>${esc(f.payee_name)}</h1><div class="muted">Factura N.º ${esc(f.invoice_number)}</div>
  <div class="row"><div><div class="muted">Facturar a</div>Andina Labs Inc.<br>1209 Orange St, Wilmington, DE 19801</div>
  <div><div class="muted">Fecha de emisión</div>${day(i.issue ?? 0)}<div class="muted">Vence</div>${day(i.due ?? 30)}</div></div>
  <table><tr><th>Concepto</th><th class="r">Valor (${f.currency})</th></tr>
  <tr><td>${esc(f.concept)}</td><td class="r">${money(f.amount, f.currency)}</td></tr>
  <tr class="total"><td>Total a pagar</td><td class="r">${f.currency} ${money(f.amount, f.currency)}</td></tr></table>
  <div class="pay"><div class="muted">Datos de pago</div>${esc(f.bank_account)}</div></div>`;
};

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(`${execSync('npm root -g').toString().trim()}/playwright`); }
const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 860, height: 1000 } });
mkdirSync(OUT, { recursive: true });
for (const i of seed.invoices.filter((x) => x.source === 'pdf' || x.source === 'image')) {
  await page.setContent(html(i));
  if (i.source === 'pdf') await page.pdf({ path: `${OUT}/${i.nn}.pdf`, format: 'A4', printBackground: true });
  else {
    const b = await page.locator('#doc').boundingBox();
    await page.screenshot({ path: `${OUT}/${i.nn}.png`, clip: { x: 0, y: 0, width: b.x + b.width + 40, height: b.y + b.height + 40 } });
  }
}
await browser.close();

const R = seed.rules;
const rows = seed.invoices.map((i) => {
  const f = i.fields;
  const trap = i.check ? `${i.trap} · \`${[i.check, ...i.also].join('`, `')}\`` : i.trap;
  return `| ${i.nn} | ${f.payee_name ?? 'desconocido'} | ${f.amount === null ? 'desconocido' : money(f.amount, f.currency)} | ${f.currency ?? 'desconocida'} | ${i.source} | ${trap} | ${i.expected_outcome} | ${i.reason} |`;
});
const n = (o) => seed.invoices.filter((i) => i.expected_outcome === o).length;
writeFileSync('docs/demo/DATASET.md', `# Andina Labs Inc.: data set de la demo

Generado por \`node scripts/gen-invoices.mjs\` desde el JSON de \`supabase/migrations/20261017000600_fx_rates.sql\` (la única fuente). No editar a mano.

${seed.invoices.length} facturas: ${n('PAGAR')} PAGAR, ${n('FRENAR')} FRENAR, ${n('ESCALAR')} ESCALAR. ${seed.beneficiaries.length} beneficiarios. Ninguna decisión se guarda en el seed: el agente decide cada factura y debe llegar a "Resultado esperado" (AC-10).

**Política v1 "Política general"**: límite por pago ${money(R.per_payment_limit_usd)} USD, umbral de aprobación ${money(R.approval_threshold_usd)} USD, presupuesto del periodo ${money(R.period_budget_usd)} USD, saldo de la cuenta ${money(R.account_balance_usd)} USD, ventana de duplicados ${R.duplicate_window_days} días, tolerancia del acuerdo ${R.agreement_tolerance_pct} %, gracia de vencimiento ${R.due_grace_days} días, solo beneficiarios permitidos; sin tasas fijadas por la política (\`fx_rates: {}\`).

**Tasas de cambio** (D28, AC-73..AC-75): la política no fija tasas, así que el agente convierte cada factura que no está en USD con la tasa de mercado del día (Yahoo Finance; respaldo open.er-api.com), guardada a lo sumo 48 horas antes de decidir. Los montos en USD de las razones usan las tasas del 17 oct 2026 (1 USD = 3.170,68 COP, 18,479 MXN, 5,0693 BRL, 1.517,5 ARS y 0,8895 EUR). Las tasas se mueven hasta el día de la demo, así que el data set está construido para que cada resultado esperado y el camino feliz se mantengan con cualquier tasa dentro de ±20 % de esas (R-86; la prueba recorre las 32 esquinas): los retainers en USD se facturan en USD (un retainer en otra moneda deja de cuadrar al 1 % en cuanto la tasa se mueve), las trampas de saldo y presupuesto (#28, #29) van en USD, y los montos en otras monedas que cuentan en el mes son pequeños, o están lejos de cada límite (#04 y #08 superan 5.000 USD aun con la tasa 20 % más baja; #22 queda entre 2.500 y 5.000 con cualquiera).

**Cómo se calcula cada trampa** (R-08): el saldo (${money(R.account_balance_usd)}) está por debajo del presupuesto (${money(R.period_budget_usd)}). Comprometido = PAGAR + ESCALAR pendientes del mes; pagado = solo PAGAR. Los montos de la razón son los acumulados del mes antes de esa factura, en orden de llegada, con las tasas del 17 oct. La #28 falla el saldo por lo pagado (18.409,39 + 4.950 = 23.359,39 > 23.000) sin tocar el presupuesto (35.805,36 + 4.950 = 40.755,36 ≤ 42.000); la #29, la última del mes, falla el presupuesto por lo comprometido (40.755,36 + 2.450 = 43.205,36 > 42.000) sin tocar el saldo (20.859,39 ≤ 23.000). Las comparaciones son inclusivas (monto ≤ límite cumple). La columna Trampa muestra primero el control propio de la trampa y luego los que fallan con él por construcción.

**Camino feliz del video** (R-35, AC-34, AC-50), sobre un espacio recién creado o reiniciado, después de que el agente decidió las 29: al final del mes van comprometidos 43.205,36 USD y pagados 18.409,39 USD (con las tasas del 17 oct; con otras dentro de ±20 % las cifras cambian unos cientos de dólares y el resultado no).
1. "Rechazar" la #15 de Laura Méndez (cuenta cambiada, la señal clásica de fraude): queda FRENAR por la persona y libera 2.500 del presupuesto; comprometido 43.205,36 − 2.500 = 40.705,36.
2. "Aprobar" la #11 de Nube Sur LLC #2044 (4.200 USD; solo fallaba el umbral, que una persona sí puede desbloquear). Se recalculan presupuesto y saldo sin contar la propia factura: comprometido 36.505,36 + 4.200 = 40.705,36 ≤ 42.000; pagado 18.409,39 + 4.200 = 22.609,39 ≤ 23.000: PAGAR.
Aprobar Nube Sur sin el rechazo vuelve a escalar por "presupuesto del periodo": 39.005,36 + 4.200 = 43.205,36 > 42.000 (el saldo, 22.609,39, sí cumple). Es el comportamiento correcto (D5, R-21): ni el presupuesto ni el saldo se desbloquean aprobando.

**Fechas relativas al momento del seed** (R-09), mes M = mes actual en America/Bogota: la factura NN llega en inicio(M) + (ahora − inicio(M)) × NN / 30, así NN es el orden de llegada y todas caen dentro de M; la #02 llega en inicio(M) − 5 días (mes anterior). Emisión y vencimiento = fecha de llegada (Bogotá) + los días \`issue\` y \`due\` del JSON. Los documentos de \`/demo/invoices/\` muestran las fechas del día en que se generaron.

**Documentos**: \`/demo/invoices/NN.pdf\` (PDF con capa de texto) o \`/demo/invoices/NN.png\` (fuente imagen; la #18 está borrosa a propósito). Las facturas de correo y chat no tienen archivo: su texto está en el seed (\`raw_text\`).

**Números y política**: los números de factura son fijos (R-38), así que subir \`/demo/invoices/01.pdf\` es siempre un duplicado exacto de la #01 dentro de la ventana de 30 días desde el último seed o reinicio. La política v1 solo se inserta si la empresa no tiene ninguna; "Reiniciar demo" agrega la versión max+1 con estas reglas y nunca reescribe una anterior (R-39). No hay factura con total inconsistente: la #18 ilegible cubre esa trampa (R-37).

| id | beneficiario | monto | moneda | fuente | trampa | resultado esperado | razón |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`);
