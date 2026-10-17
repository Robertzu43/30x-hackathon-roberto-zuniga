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

test('at phone width every top-bar control is a 44 px tap target; desktop keeps its compact single row', () => {
  expect(media('max-width: 640px')).toMatch(/\.topbar button \{[^}]*min-height: 44px/);
  expect(rule('button')).not.toMatch(/min-height/);
});

test('the stacked login sizes its rows to their content: no empty block between the headline and the form', () => {
  expect(media('max-width: 760px')).toMatch(/\.login \{[^}]*align-content: start/);
});
