/* global URL */
// AC-50: the recorder's step 7 waits for the Periodo text the app prints through Intl (es-CO: "100%", other ICU builds: "100 %").
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const src = readFileSync(new URL('./record-happy-path.mjs', import.meta.url), 'utf8');

it('step 7 pattern accepts the percent text with or without a (no-break) space', () => {
  const lit = src.match(/getByText\((\/\^Decisiones explicadas[^\n]*?\/)\)/)[1];
  const re = new RegExp(lit.slice(1, -1));
  const intl = `Decisiones explicadas ${new Intl.NumberFormat('es-CO', { style: 'percent' }).format(1)}`;
  for (const t of ['Decisiones explicadas 100%', 'Decisiones explicadas 100 %', 'Decisiones explicadas 100 %', intl]) expect(t).toMatch(re);
  expect('Decisiones explicadas 99%').not.toMatch(re);
});
