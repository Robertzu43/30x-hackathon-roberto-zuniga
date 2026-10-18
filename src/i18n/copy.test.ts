import { expect, test } from 'vitest';
import { ui } from './ui';

const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(u: URL, enc: 'utf8'): string }; // no @types/node in this project

// AC-120: every dictionary table of docs/COPY.md is a test. Skipped: tables under «not a dictionary» and under «Owned by Task …»
// (Tasks 60, 63, 64 check their own rows). A cut P2 row is skipped only when named here and in the ledger.
const cutP2 = new Set<string>([]);

type Row = { p: string; key: string; lang: 'es' | 'en'; after: string };
const rows: Row[] = [];
let skip = false;
for (const line of readFileSync(new URL('../../docs/COPY.md', import.meta.url), 'utf8').split('\n')) {
  if (line.startsWith('## ')) skip = /not a dictionary|^## Owned by Task/.test(line);
  if (skip || !/^\| P[12] \|/.test(line)) continue;
  const c = line.split('|').slice(1, -1).map((x: string) => x.trim());
  rows.push({ p: c[0]!, key: c[1]!, lang: c[2] as Row['lang'], after: c[4]! });
}

test('the deck parses to its dictionary rows', () => expect(rows.length).toBeGreaterThan(50));
test.each(rows.filter((r) => !cutP2.has(`${r.key}.${r.lang}`)))('$p $key ($lang) is the deck copy', ({ key, lang, after }) => {
  if (after === '(removed)') expect(ui[lang]).not.toHaveProperty(key);
  else expect(ui[lang][key]).toBe(after);
});
