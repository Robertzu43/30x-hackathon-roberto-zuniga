// AC-72 (R-67): jsdom cannot measure layout, so this guards the CSS rules that keep a 390 px screen from scrolling
// sideways. The widths themselves were measured in Chromium at 390 × 844 (see the Task 11c ledger entry).
import { expect, test } from 'vitest';

const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string }; // no @types/node here
const css = readFileSync('web/styles.css', 'utf8');
const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';

test('top bar controls wrap onto another line instead of running off the screen', () => {
  expect(rule('.topbar-actions')).toMatch(/flex-wrap: wrap/);
  expect(rule('.screens')).toMatch(/flex-wrap: wrap/);
});

test('a table wider than the screen scrolls inside its own card', () => {
  expect(rule('.table-wrap')).toMatch(/overflow-x: auto/);
});

// AC-72 Clarified (R-79): measured in Chromium at 390 × 844 and 1280 px (task 11d report); these guard the rules.
const media = (query: string) => css.split(`@media (${query}) {`)[1]?.split('\n}\n')[0] ?? '';

test('at phone width every button and select (top bar, es/en, Nueva factura, Editar, language links) is a 44 x 44 tap target; desktop keeps its compact row (UX-05)', () => {
  expect(media('max-width: 640px')).toMatch(/\n {2}button, select \{[^}]*min-height: 44px; min-width: 44px/);
  expect(rule('button')).not.toMatch(/min-height/);
});

test('at phone width the section links are 44 x 44 (UX-05; «Inbox» is 36 px wide as text)', () => {
  expect(media('max-width: 640px')).toMatch(/\.screens a \{[^}]*min-height: 44px; min-width: 44px/);
});

test('at 768 px and below every field is 16 px, page styles included, so a phone never zooms in (UX-06)', () => {
  expect(media('max-width: 768px')).toMatch(/input, select, textarea \{ font-size: 16px !important; \}/);
});

test('links use the palette ink with an underline, never the browser blue (UX-11)', () => {
  expect(rule('a')).toMatch(/color: var\(--ink\)/);
});

test('the stacked login sizes its rows to their content: no empty block between the headline and the form', () => {
  expect(media('max-width: 760px')).toMatch(/\.login \{[^}]*align-content: start/);
});

// AC-91 item 1 (UX pass 1): detail-frenar at 360/en was 365 px wide; the read-field row (label, value, confidence) pushed past the gutter.
test('at 480 px or less a read field stacks its confidence under the value, and a long value wraps inside its cell', () => {
  const detail = readFileSync('web/pages/detail.css', 'utf8');
  const small = detail.split('@media (max-width: 480px) {')[1]?.split('\n}')[0] ?? '';
  expect(small).toMatch(/\.detail-fields > div \{[^}]*grid-template-columns: 7rem minmax\(0, 1fr\)/);
  expect(small).toMatch(/\.detail-fields dd \+ dd \{[^}]*grid-column: 2/);
  expect(detail).toMatch(/\n\.detail-fields dd \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere/);
});

// AC-91 items 1 and 2 (R-165, Task 33 gate G1 and F1): jsdom has no layout, so these guard the rules; the boxes were measured in
// Chromium at 360, 390 and 1440 px, es and en (Task 57 report).
const at400 = (file: string) => readFileSync(file, 'utf8').split('@media (max-width: 400px) {')[1]?.split('\n}')[0] ?? '';

test('at 400 px or less Bandeja\'s action row always sits under the h1, in es and en (G1)', () => {
  expect(at400('web/pages/inbox.css')).toMatch(/\.inbox-actions \{[^}]*flex-basis: 100%/);
});

test('at 400 px or less the KPI tiles stack in one column, so no amount is clipped or painted over by the next tile (F1)', () => {
  expect(at400('web/dashboard/dashboard.css')).toMatch(/\.dash-kpis \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
});
