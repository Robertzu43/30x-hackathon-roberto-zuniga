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
