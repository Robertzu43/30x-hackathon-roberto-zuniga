import { describe, expect, it } from 'vitest';
import { REASONS, REASON_LABELS, canAssign, canCourierMark } from '../src/lib/status';

describe('status rules', () => {
  it('canAssign', () => {
    expect(['pendiente', 'asignado', 'fallido'].map((s) => canAssign(s as never))).toEqual([true, true, true]);
    expect(canAssign('entregado')).toBe(false);
  });
  it('canCourierMark only asignado', () => {
    expect(canCourierMark('asignado')).toBe(true);
    for (const s of ['pendiente', 'entregado', 'fallido'] as const) expect(canCourierMark(s)).toBe(false);
  });
  it('labels cover every reason', () => {
    expect(REASONS.map((r) => REASON_LABELS[r])).toEqual(['No estaba', 'Dirección errada', 'Rechazado', 'Otro']);
  });
});
