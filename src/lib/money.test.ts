import { describe, expect, it } from 'vitest';
import { parseAmount, round2, toUsd } from './money';

describe('parseAmount (AC-14, Review Focus 1)', () => {
  it.each([
    ['1.000,00', 1000],
    ['1,000.00', 1000],
    ['$ 2.500', 2500],
    ['USD 1,234.5', 1234.5],
    ['COP 3.673.500', 3673500],
    ['25.000.000', 25000000],
    ['2500', 2500],
    ['10,50', 10.5],
    ['1.5', 1.5],
    ['€ 4.300,00', 4300],
  ])('%s -> %s', (raw, n) => expect(parseAmount(raw)).toBe(n));

  it.each(['2.500,5', '1,5', '', 'abc', '-500', '1.000,000', '1,000,00', '1.2.3', '12.34.567', '.', '1O.000,00', '12abc34', '1e5', 'Item 1 2.500'])(
    'ambiguous or invalid %j -> null',
    (raw) => expect(parseAmount(raw)).toBeNull(),
  );
});

describe('toUsd and round2 (AC-22, D6)', () => {
  const rates = { COP: 0.000245, ARS: 0.00095, EUR: 1.08 };
  it('converts with the policy rate rounded to 2 decimals', () => {
    expect(toUsd(1500000, 'COP', rates)).toBe(367.5);
    expect(toUsd(3673500, 'COP', rates)).toBe(900.01);
    expect(toUsd(2316000, 'ARS', rates)).toBe(2200.2);
  });
  it('USD needs no rate', () => expect(toUsd(2500, 'USD', {})).toBe(2500));
  it('null when the currency has no rate, or the rate is not positive', () => {
    expect(toUsd(100, 'GBP', rates)).toBeNull();
    expect(toUsd(100, 'EUR', { EUR: 0 })).toBeNull();
    expect(toUsd(100, 'EUR', { EUR: -1 })).toBeNull();
  });
  it('round2 rounds half up despite binary floats', () => expect(round2(1.005)).toBe(1.01));
});
