import { parseCOP, toE164 } from './format';

export type ImportRow = { pedido: string; cliente: string; telefono: string; direccion: string; barrio: string; valor: number };
export type Skipped = {
  line: number;
  pedido: string;
  reason: 'falta_telefono' | 'falta_direccion' | 'telefono_invalido' | 'valor_invalido' | 'duplicado';
};

export const SKIP_LABELS: Record<Skipped['reason'], string> = {
  falta_telefono: 'Falta teléfono',
  falta_direccion: 'Falta dirección',
  telefono_invalido: 'Teléfono inválido',
  valor_invalido: 'Valor inválido',
  duplicado: 'Pedido duplicado',
};

const COLUMNS = ['pedido', 'cliente', 'telefono', 'direccion', 'barrio', 'valor'] as const;

// RFC-4180: quoted fields may hold separators, newlines and "" escapes.
function parseRecords(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

export function parseDeliveriesCsv(
  text: string,
  existingPedidos: Set<string> = new Set(),
): { valid: ImportRow[]; skipped: Skipped[] } | { error: string } {
  const src = text.replace(/^﻿/, '');
  const notCsv = { error: 'El archivo no es un CSV válido. Columnas requeridas: ' + COLUMNS.join(', ') };
  if (!src.trim() || /[\u0000-\u0008\u000E-\u001F]/.test(src)) return notCsv;
  const head = src.split(/\r?\n/, 1)[0];
  const sep = head.split(';').length > head.split(',').length ? ';' : ',';
  const [header, ...data] = parseRecords(src, sep);
  const names = header.map((h) => h.trim().toLowerCase());
  const missing = COLUMNS.filter((c) => !names.includes(c));
  if (missing.length) return { error: `Faltan columnas: ${missing.join(', ')}` };

  const idx = Object.fromEntries(COLUMNS.map((c) => [c, names.indexOf(c)])) as Record<(typeof COLUMNS)[number], number>;
  const seen = new Set(existingPedidos);
  const valid: ImportRow[] = [];
  const skipped: Skipped[] = [];
  data.forEach((r, i) => {
    const get = (c: (typeof COLUMNS)[number]) => (r[idx[c]] ?? '').trim();
    const pedido = get('pedido');
    const skip = (reason: Skipped['reason']) => skipped.push({ line: i + 1, pedido, reason });
    const telefono = get('telefono');
    const direccion = get('direccion');
    if (!telefono) return skip('falta_telefono');
    if (!direccion) return skip('falta_direccion');
    if (seen.has(pedido)) return skip('duplicado');
    const e164 = toE164(telefono);
    if (!e164) return skip('telefono_invalido');
    const valor = parseCOP(get('valor'));
    if (valor === null) return skip('valor_invalido');
    seen.add(pedido);
    valid.push({ pedido, cliente: get('cliente'), telefono: e164, direccion, barrio: get('barrio'), valor });
  });
  return { valid, skipped };
}
