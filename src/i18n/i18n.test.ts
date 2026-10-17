import { expect, test } from 'vitest';
import en from './en';
import es from './es';
import { t } from './index';

test('every es key exists in en', () => expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort()));
test('interpolates', () => expect(t('es', 'test.hello', { name: 'Ana' })).toBe('Hola, Ana'));
test('interpolates in en', () => expect(t('en', 'test.hello', { name: 'Ana' })).toBe('Hello, Ana'));
test('unknown key returns the key', () => expect(t('es', 'nope.key')).toBe('nope.key'));
