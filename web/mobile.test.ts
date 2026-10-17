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

// AC-91 item 1 (UX pass 1): detail-frenar at 360/en was 365 px wide; the read-field row (label, value, confidence) pushed past the gutter.
test('at 480 px or less a read field stacks its confidence under the value, and a long value wraps inside its cell', () => {
  const detail = readFileSync('web/pages/detail.css', 'utf8');
  const small = detail.split('@media (max-width: 480px) {')[1]?.split('\n}')[0] ?? '';
  expect(small).toMatch(/\.detail-fields > div \{[^}]*grid-template-columns: 7rem minmax\(0, 1fr\)/);
  expect(small).toMatch(/\.detail-fields dd \+ dd \{[^}]*grid-column: 2/);
  expect(detail).toMatch(/\n\.detail-fields dd \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere/);
});
