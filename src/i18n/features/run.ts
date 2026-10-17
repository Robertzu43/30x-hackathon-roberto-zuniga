// Budgeted agent runs (AC-70, R-57): progress and summary copy shared by Bandeja, Politica, Login and /demo.
export const es: Record<string, string> = {
  'run.progress': 'Decidiendo facturas… {n} de {m}',
  'run.summary': '{PAGAR} PAGAR · {FRENAR} FRENAR · {ESCALAR} ESCALAR',
  'run.errors_pending':
    'No pude decidir {n} factura(s); siguen pendientes y las intentaré de nuevo en la próxima revisión automática (cada 5 minutos).',
  'run.errors_reevaluate': 'No pude reevaluar {n} factura(s); conservan su resultado anterior. Pulsa «Reevaluar pendientes» de nuevo.',
};

export const en: Record<string, string> = {
  'run.progress': 'Deciding invoices… {n} of {m}',
  'run.summary': '{PAGAR} PAGAR · {FRENAR} FRENAR · {ESCALAR} ESCALAR',
  'run.errors_pending':
    'I could not decide {n} invoice(s); they stay pending and I will try again at the next automatic check (every 5 minutes).',
  'run.errors_reevaluate': 'I could not re-evaluate {n} invoice(s); they keep their previous result. Press "Re-evaluate pending" again.',
};
