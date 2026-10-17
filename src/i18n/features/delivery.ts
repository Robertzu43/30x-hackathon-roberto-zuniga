// D40 delivery: a page's chunk on its way (AC-99); the only optimistic state is "sending", the outcome always comes from the server (AC-100, R-122).
export const es: Record<string, string> = {
  'detail.sending': 'Enviando tu respuesta…',
  'app.loading': 'Cargando…',
  'app.chunk_error': 'No pude abrir esta pantalla. Revisa tu conexión e intenta de nuevo.',
  'app.retry': 'Intentar de nuevo',
};

export const en: Record<string, string> = {
  'detail.sending': 'Sending your answer…',
  'app.loading': 'Loading…',
  'app.chunk_error': 'I could not open this screen. Check your connection and try again.',
  'app.retry': 'Try again',
};
