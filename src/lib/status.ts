export type Status = 'pendiente' | 'asignado' | 'entregado' | 'fallido';
export type Reason = 'no_estaba' | 'direccion_errada' | 'rechazado' | 'otro';

export const REASONS: readonly Reason[] = ['no_estaba', 'direccion_errada', 'rechazado', 'otro'];
export const REASON_LABELS: Record<Reason, string> = {
  no_estaba: 'No estaba',
  direccion_errada: 'Dirección errada',
  rechazado: 'Rechazado',
  otro: 'Otro',
};

export const canAssign = (s: Status): boolean => s !== 'entregado';
export const canCourierMark = (s: Status): boolean => s === 'asignado';
