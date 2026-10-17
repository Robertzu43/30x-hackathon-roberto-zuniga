// Market and pinned exchange rates in the record (D28, AC-74, R-85). Record strings: the Worker reads them through
// src/i18n/index.ts, the web through the features glob. Spanish first; English equal.
export const es: Record<string, string> = {
  'check.moneda.cumple_market': '{amount} {currency} × {rate} = {amount_usd} USD ({rate_source}, {rate_fetched_at})',
  'check.moneda.cumple_pin': '{amount} {currency} × {rate} = {amount_usd} USD (tasa fijada por la política{version})',
  'check.moneda.no_verificado_stale': 'la última tasa de mercado de {currency} es del {rate_fetched_at}, de hace más de 48 horas',
  'check.moneda.no_verificado_missing': 'no tengo tasa de mercado ni tasa fijada para {currency}',
  'motive.moneda.no_verificado_rate': 'no tengo una tasa de cambio vigente para {currency}',
  'fix.moneda.no_verificado_rate': 'Que se actualice la tasa de mercado de {currency} o que la política fije una tasa',
  'question.motive.moneda.no_verificado_rate': 'no tengo una tasa de cambio vigente para {currency}',
};

export const en: Record<string, string> = {
  'check.moneda.cumple_market': '{amount} {currency} × {rate} = {amount_usd} USD ({rate_source}, {rate_fetched_at})',
  'check.moneda.cumple_pin': '{amount} {currency} × {rate} = {amount_usd} USD (rate pinned by policy{version})',
  'check.moneda.no_verificado_stale': 'the latest market rate for {currency} is from {rate_fetched_at}, more than 48 hours old',
  'check.moneda.no_verificado_missing': 'I have no market or pinned rate for {currency}',
  'motive.moneda.no_verificado_rate': 'I have no current exchange rate for {currency}',
  'fix.moneda.no_verificado_rate': 'That the market rate for {currency} is refreshed, or the policy pins a rate',
  'question.motive.moneda.no_verificado_rate': 'I have no current exchange rate for {currency}',
};
