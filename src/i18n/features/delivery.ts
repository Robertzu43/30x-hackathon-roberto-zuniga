// D40 delivery (AC-100, R-122): the only optimistic state is "sending"; the outcome always comes from the server.
export const es: Record<string, string> = {
  'detail.sending': 'Enviando tu respuesta…',
};

export const en: Record<string, string> = {
  'detail.sending': 'Sending your answer…',
};
