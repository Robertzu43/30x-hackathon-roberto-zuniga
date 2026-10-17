/* global URL */
// AC-99 and AC-97 item 4 on the real production build (in memory, nothing written): each page is its own chunk loaded on
// navigation; /login, /demo and the approve page load no chart code and no logged-in page; the JS before a public screen
// is usable stays under 250 KB gzipped; hashed assets are immutable and index.html is not (web/public/_headers).
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const PAGES = readdirSync(`${root}web/pages`).filter((f) => /^[A-Z]\w*\.tsx$/.test(f));
const MEMBER = ['Inbox', 'InvoiceDetail', 'Period', 'Policy', 'Beneficiaries'];
let chunks;
const byFile = (f) => chunks.find((c) => c.fileName === f);
const pageChunk = (name) => chunks.find((c) => c.facadeModuleId?.endsWith(`/web/pages/${name}.tsx`));
// Everything the browser must fetch before `chunk` runs: the chunk and its static imports, transitively.
const closure = (chunk, seen = new Set()) => {
  if (seen.has(chunk.fileName)) return seen;
  seen.add(chunk.fileName);
  for (const f of chunk.imports) closure(byFile(f), seen);
  return seen;
};
const modulesOf = (files) => [...files].flatMap((f) => byFile(f).moduleIds.map((m) => m.slice(root.length)));
const entry = () => chunks.find((c) => c.isEntry);

beforeAll(async () => {
  const out = await build({ root, logLevel: 'silent', build: { write: false } });
  chunks = (Array.isArray(out) ? out[0] : out).output.filter((o) => o.type === 'chunk');
}, 120_000);

describe('AC-99: one chunk per page, loaded on navigation', () => {
  it.each(PAGES.map((p) => p.replace('.tsx', '')))('%s is its own dynamic chunk, not in the entry', (name) => {
    const c = pageChunk(name);
    expect(c?.isDynamicEntry).toBe(true);
    expect(modulesOf(closure(entry()))).not.toContain(`web/pages/${name}.tsx`);
  });

  it('the entry holds no chart code', () => {
    expect(modulesOf(closure(entry())).filter((m) => m.startsWith('web/charts/') && m !== 'web/charts/lazy.tsx')).toEqual([]);
  });

  it.each(['Login', 'Demo', 'Approve'])('%s loads no chart code and no logged-in page', (name) => {
    const loaded = modulesOf(closure(pageChunk(name), closure(entry())));
    expect(loaded.filter((m) => m.startsWith('web/charts/') && m !== 'web/charts/lazy.tsx')).toEqual([]);
    for (const page of MEMBER) expect(loaded).not.toContain(`web/pages/${page}.tsx`);
  });
});

describe('AC-97 item 4: JavaScript before a public screen is usable', () => {
  it.each(['Login', 'Demo'])('%s: entry + page chunk under 250 KB gzipped', (name) => {
    const files = closure(pageChunk(name), closure(entry()));
    const gz = [...files].reduce((n, f) => n + gzipSync(byFile(f).code).length, 0);
    expect(gz).toBeLessThan(250_000);
  });
});

describe('AC-99: cache headers for the Worker static assets', () => {
  const headers = () => readFileSync(`${root}web/public/_headers`, 'utf8');
  it('hashed files under /assets/ are immutable for a year', () =>
    expect(headers()).toMatch(/^\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable$/m));
  it('index.html gets no long cache rule (Workers serve it with must-revalidate)', () =>
    expect(headers()).not.toMatch(/^\/(\*|index\.html)?\s*$/m));
});
