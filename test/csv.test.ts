import { describe, expect, it } from 'vitest';
import { SKIP_LABELS, parseDeliveriesCsv } from '../src/lib/csv';

const H = 'pedido,cliente,telefono,direccion,barrio,valor';
const ok = (r: ReturnType<typeof parseDeliveriesCsv>) => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

describe('parseDeliveriesCsv', () => {
  it('splits valid and skipped with 1-based data lines', () => {
    const r = ok(parseDeliveriesCsv([H, 'P-1,Ana,3001234567,Cra 7 # 1,Chapinero,45000', 'P-2,Luis,,Cl 1,Usaquén,1000', 'P-3,Eva,3001234567,,Suba,2000', 'P-1,Ana,3001234567,Cra 7 # 1,Chapinero,45000'].join('\n')));
    expect(r.valid).toEqual([{ pedido: 'P-1', cliente: 'Ana', telefono: '+573001234567', direccion: 'Cra 7 # 1', barrio: 'Chapinero', valor: 45000 }]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['falta_telefono', 'falta_direccion', 'duplicado']);
    expect(r.skipped.map((s) => s.line)).toEqual([2, 3, 4]);
    expect(r.skipped[0].pedido).toBe('P-2');
  });
  it('handles BOM, semicolon, CRLF and quoted commas', () => {
    const t = '﻿' + [H.replaceAll(',', ';').toUpperCase(), 'P-1;Ana;3001234567;"Cra 7 # 45-10, apto 301";Chapinero;$45.000'].join('\r\n') + '\r\n';
    const r = ok(parseDeliveriesCsv(t));
    expect(r.valid[0].direccion).toBe('Cra 7 # 45-10, apto 301');
    expect(r.valid[0].valor).toBe(45000);
    expect(r.skipped).toEqual([]);
  });
  it('handles escaped quotes and newline inside quotes', () => {
    const r = ok(parseDeliveriesCsv([H, 'P-1,"Ana ""La Jefa""",3001234567,"Cra 7\nPiso 2",Suba,100'].join('\n')));
    expect(r.valid[0].cliente).toBe('Ana "La Jefa"');
    expect(r.valid[0].direccion).toBe('Cra 7\nPiso 2');
  });
  it('skips rows already in DB', () => {
    const r = ok(parseDeliveriesCsv([H, 'P-1,Ana,3001234567,Cl 1,Suba,100'].join('\n'), new Set(['P-1'])));
    expect(r.valid).toEqual([]);
    expect(r.skipped[0].reason).toBe('duplicado');
  });
  it('flags invalid phone and valor', () => {
    const r = ok(parseDeliveriesCsv([H, 'P-1,Ana,12345,Cl 1,Suba,100', 'P-2,Ana,3001234567,Cl 1,Suba,"45.000,50"', 'P-3,Ana,3001234567,Cl 1,Suba,abc'].join('\n')));
    expect(r.skipped.map((s) => s.reason)).toEqual(['telefono_invalido', 'valor_invalido', 'valor_invalido']);
  });
  it('errors naming missing columns', () => {
    const r = parseDeliveriesCsv('pedido,cliente,telefono,direccion,barrio\nP-1,a,b,c,d');
    expect(r).toEqual({ error: expect.stringContaining('valor') });
  });
  it.each(['', '\u0000\u0001\u0002binary\u0000'])('errors on non-csv %j', (t) => {
    expect(parseDeliveriesCsv(t)).toHaveProperty('error');
  });
  it('has Spanish labels', () => {
    expect(SKIP_LABELS).toEqual({ falta_telefono: 'Falta teléfono', falta_direccion: 'Falta dirección', telefono_invalido: 'Teléfono inválido', valor_invalido: 'Valor inválido', duplicado: 'Pedido duplicado' });
  });
});
