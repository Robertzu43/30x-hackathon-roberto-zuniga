// AC-80: the brand files exist, use only approved-palette colours (AC-53 Clarified), and are wired in. PNG is 2x for email.
import { expect, test } from 'vitest';

const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc?: string): { readUInt32BE(o: number): number } & string }; // no @types/node here
const text = (p: string) => readFileSync(p, 'utf8') as string;
const hexes = (s: string) => [...s.matchAll(/#[0-9a-f]{3,6}\b/gi)].map((m) => m[0].toLowerCase());
const approved = new Set(hexes(text('web/styles.css')));

test.each(['web/public/brand/thesaurus-mark.svg', 'web/public/brand/thesaurus-logo.svg', 'web/public/favicon.svg'])('%s is an SVG with only approved colours and no Blinka', (file) => {
  const svg = text(file);
  expect(svg).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  expect(hexes(svg).length).toBeGreaterThan(0);
  for (const c of hexes(svg)) expect(approved, `${file} uses ${c}`).toContain(c);
  expect(svg.toLowerCase()).not.toContain('blinka');
});

test('the logo carries the wordmark; the mark alone does not', () => {
  expect(text('web/public/brand/thesaurus-logo.svg')).toContain('Thesaurus');
  expect(text('web/public/brand/thesaurus-mark.svg')).not.toContain('<text');
});

test('thesaurus-logo.png is the logo at 2x (320 x 64) for email', () => {
  const png = readFileSync('web/public/brand/thesaurus-logo.png');
  expect(png.readUInt32BE(0)).toBe(0x89504e47);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 64]);
});

test('index.html links /favicon.svg', () => {
  expect(text('index.html')).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
});

// AC-80 / docs/ux item 6: the logo must not stretch across a flex column (it would centre inside the stretch), and the top bar centres the tagline on the mark.
const rule = (sel: string) => text('web/styles.css').match(new RegExp(`^${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? '';

test('.logo is left-aligned in flex columns (align-self: flex-start)', () => {
  expect(rule('.logo')).toMatch(/align-self:\s*flex-start/);
});

test('.topbar centres its items, not baseline', () => {
  expect(rule('.topbar')).toMatch(/align-items:\s*center/);
});

test('.topbar .logo re-centres the mark against the flex-start default', () => {
  expect(text('web/styles.css')).toMatch(/\.topbar \.logo\s*\{[^}]*align-self:\s*center/);
});
