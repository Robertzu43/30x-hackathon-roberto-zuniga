// Trial workspaces (D41; AC-64 Clarified, AC-93, AC-96; R-115, R-116, R-117): the record's words for a trial company and
// a guest, and the API's refusals. The Worker imports this file directly; ui.ts merges it for the web.
export const es: Record<string, string> = {
  'trial_record.act': 'Empresa de prueba: la pregunta quedó en el tablero, sin correo.',
  'trial_record.guest': 'Invitado {id}',
  'trial_record.no_mail': 'Las empresas de prueba no envían correos.',
  'trial_record.ingest_cap': 'Llegaste al límite de 30 facturas por día en tu empresa de prueba. Se renueva a las 19:00, hora de Bogotá.',
};
export const en: Record<string, string> = {
  'trial_record.act': 'Trial company: the question stays on the dashboard, no email sent.',
  'trial_record.guest': 'Guest {id}',
  'trial_record.no_mail': 'Trial companies send no email.',
  'trial_record.ingest_cap': 'You reached the limit of 30 invoices a day in your trial company. It renews at 19:00 Bogotá time (00:00 UTC).',
};
