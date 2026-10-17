// D40 delivery: a page's chunk on its way (AC-99); the only optimistic state is "sending", the outcome always comes from the server (AC-100, R-122).
export const es: Record<string, string> = {
  'detail.sending': 'Enviando tu respuesta…',
  'app.loading': 'Cargando…',
};

export const en: Record<string, string> = {
  'detail.sending': 'Sending your answer…',
  'app.loading': 'Loading…',
};
