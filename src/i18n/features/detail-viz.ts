// Detalle, D39 parts (AC-102): the document text, the rules bar and the FX card. Spanish first; English equal.
export const es: Record<string, string> = {
  'detail.doc_text': 'Texto del documento',
  'detail.rules.pass.one': '{n} de {total} reglas cumple',
  'detail.rules.pass.other': '{n} de {total} reglas cumplen',
  'detail.rules.sum': '{title}; {rest}.', // R-163: the parts that are not 0, words from trace.count.*
  'detail.rules.sum.all': '{title}.',
  'detail.rules.and': '{a} y {b}',
  'detail.fx': 'Tasa de cambio',
  'detail.fx.pin': 'tasa fijada por la política{version}',
};

export const en: Record<string, string> = {
  'detail.doc_text': 'Document text',
  'detail.rules.pass.one': '{n} of {total} rules passes',
  'detail.rules.pass.other': '{n} of {total} rules pass',
  'detail.rules.sum': '{title}; {rest}.',
  'detail.rules.sum.all': '{title}.',
  'detail.rules.and': '{a} and {b}',
  'detail.fx': 'Exchange rate',
  'detail.fx.pin': 'rate pinned by policy{version}',
};
