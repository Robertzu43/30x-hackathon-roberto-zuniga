import { expect, test } from 'vitest';
import en from './en';
import es from './es';
import { t } from './index';
import { merge, ui } from './ui';

const features = import.meta.glob('./features/*.ts', { eager: true }) as Record<string, { es: Record<string, string>; en: Record<string, string> }>;

test('every es key exists in en', () => expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort()));
test('merged UI dictionaries (base + every feature) have the same keys in es and en', () =>
  expect(Object.keys(ui.en).sort()).toEqual(Object.keys(ui.es).sort()));
test.each(Object.entries(features))('%s has the same keys in es and en', (_, f) =>
  expect(Object.keys(f.en).sort()).toEqual(Object.keys(f.es).sort()));
test('the merged UI dictionary includes the feature dictionaries', () => {
  expect(Object.keys(features)).toContain('./features/auth.ts');
  expect(ui.es['tour.done']).toBe('Terminar');
});
test('a key defined twice across dictionaries throws, naming the key and both files', () =>
  expect(() => merge({ base: { a: '1' }, './features/x.ts': { a: '2' } })).toThrow(/"a".*base.*features\/x\.ts/));
test('interpolates', () => expect(t('es', 'test.hello', { name: 'Ana' })).toBe('Hola, Ana'));
test('interpolates in en', () => expect(t('en', 'test.hello', { name: 'Ana' })).toBe('Hello, Ana'));
test('unknown key returns the key', () => expect(t('es', 'nope.key')).toBe('nope.key'));
// AC-120: product ruling, one voice in both languages (beneficiary, not payee; «How it works», not «How the agent works»).
test.each([
  ['demo.loop.title', 'How it works'],
  ['demo.stage.consulta.text', "It checks the beneficiary directory, the policy, the period's budget and earlier invoices."],
  ['portal.steps.2.text', 'It replies with the beneficiary, amount, currency and number it read.'],
])('en %s is the ruled copy', (key, text) => expect(ui.en[key]).toBe(text));
