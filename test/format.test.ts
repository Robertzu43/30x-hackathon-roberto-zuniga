import { describe, expect, it } from 'vitest';
import { bogotaToday, formatCOP, formatDate, parseCOP, toE164 } from '../src/lib/format';

describe('toE164', () => {
  it.each(['3001234567', '573001234567', '+57 300 123 4567', '300-123-4567', '(300) 123.4567'])('normalises %s', (raw) => {
    expect(toE164(raw)).toBe('+573001234567');
  });
  it('accepts landlines starting 60', () => expect(toE164('601 234 5678')).toBe('+576012345678'));
  it.each(['12345', '', '2001234567', '+1 300 123 4567', '30012345678'])('rejects %s', (raw) => {
    expect(toE164(raw)).toBeNull();
  });
});

describe('dates', () => {
  it('bogotaToday before and after Bogota midnight', () => {
    expect(bogotaToday(new Date('2026-10-16T04:30:00Z'))).toBe('2026-10-15');
    expect(bogotaToday(new Date('2026-10-16T05:00:00Z'))).toBe('2026-10-16');
  });
  it('formatDate', () => expect(formatDate('2026-10-15')).toBe('15/10/2026'));
});

describe('money', () => {
  it('formatCOP', () => expect(formatCOP(45000)).toMatch(/^\$\s?45\.000$/));
  it.each(['45000', '45.000', '$45.000', '45.000,00', ' $ 45.000 '])('parseCOP %s', (raw) => {
    expect(parseCOP(raw)).toBe(45000);
  });
  it.each(['45.000,50', 'abc', '', '-5', '4.5'])('parseCOP rejects %s', (raw) => {
    expect(parseCOP(raw)).toBeNull();
  });
});
