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

test('at phone width the section links are 44 px tall (UX-05)', () => {
  expect(media('max-width: 640px')).toMatch(/\.screens a \{[^}]*min-height: 44px/);
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
