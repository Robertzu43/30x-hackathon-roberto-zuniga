// «Actividad del agente» (AC-78, R-89): the panel's words and the replayed steps. The Worker renders the steps from the
// recorded decision (src/routes/agent.ts); no model writes them.
export const es: Record<string, string> = {
  'activity.title': 'Actividad del agente',
  'activity.label': 'Así trabaja el agente: cada paso sale del registro de la decisión.',
  'activity.loading': 'Cargando la actividad del agente…',
  'activity.empty': 'Cuando el agente decida una factura verás aquí cada paso. Pulsa «Ejecutar agente» para verlo.',
  'activity.error': 'No pude cargar la actividad del agente; lo intentaré de nuevo en 10 segundos.',
  'activity.step.read_ai': 'Leyendo la factura de {payee} con IA…',
  'activity.step.read_stored': 'Tomando los datos ya leídos de la factura de {payee}…',
  'activity.step.directory': 'Consultando el directorio…',
  'activity.step.rules': 'Verificando {n} reglas…',
  'activity.step.decided': 'Decidí {outcome}',
};

export const en: Record<string, string> = {
  'activity.title': 'Agent activity',
  'activity.label': 'How the agent works: every step comes from the decision record.',
  'activity.loading': 'Loading the agent activity…',
  'activity.empty': 'When the agent decides an invoice you will see each step here. Press "Run agent" to see it.',
  'activity.error': "I couldn't load the agent activity; I'll try again in 10 seconds.",
  'activity.step.read_ai': "Reading {payee}'s invoice with AI…",
  'activity.step.read_stored': "Taking the already-read data from {payee}'s invoice…",
  'activity.step.directory': 'Checking the directory…',
  'activity.step.rules': 'Checking {n} rules…',
  'activity.step.decided': 'I decided {outcome}',
};
