// «Pregúntale a Thesaurus» (AC-67, R-87). The reason texts and the 400 text are the API's too: src/routes/ask.ts imports them.
export const es: Record<string, string> = {
  'ask.title': 'Pregúntale a Thesaurus',
  'ask.question': 'Tu pregunta sobre el registro',
  'ask.send': 'Preguntar',
  'ask.sending': 'Buscando en el registro…',
  'ask.label': 'Respuesta generada por IA ({provider}) a partir del registro; puede equivocarse: el registro manda.',
  'ask.remaining.one': 'Te queda 1 pregunta hoy',
  'ask.remaining.other': 'Te quedan {n} preguntas hoy',
  'ask.bad_question': 'Escribe una pregunta de 1 a 500 caracteres.',
  'ask.reason.user_cap':
    'Llegaste al límite de 10 preguntas por día. El cupo se renueva a las 19:00, hora de Bogotá. Todo lo que el agente hizo sigue en el registro.',
  'ask.reason.ai_quota':
    'La IA de Thesaurus no tiene cupo disponible en este momento. Vuelve más tarde; el cupo diario se renueva a las 19:00, hora de Bogotá. Las decisiones no dependen de la IA: el registro de cada factura sigue completo.',
  'ask.reason.failed': 'No pude responder ahora; revisa el registro.',
};

export const en: Record<string, string> = {
  'ask.title': 'Ask Thesaurus',
  'ask.question': 'Your question about the record',
  'ask.send': 'Ask',
  'ask.sending': 'Searching the record…',
  'ask.label': 'AI-generated answer ({provider}) based on the record; it can be wrong: the record prevails.',
  'ask.remaining.one': '1 question left today',
  'ask.remaining.other': '{n} questions left today',
  'ask.bad_question': 'Write a question of 1 to 500 characters.',
  'ask.reason.user_cap':
    'You reached the limit of 10 questions a day. It renews at 19:00 Bogotá time (00:00 UTC). Everything the agent did is still in the record.',
  'ask.reason.ai_quota':
    "Thesaurus's AI has no allowance available right now. Come back later; the daily allowance renews at 19:00 Bogotá time (00:00 UTC). Decisions do not depend on the AI: every invoice's record is still complete.",
  'ask.reason.failed': 'I could not answer right now; check the record.',
};
