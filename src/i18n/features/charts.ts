// Chart primitives (AC-106, R-123): the empty state and the summary sentences that double as aria-labels.
export const es: Record<string, string> = {
  'charts.empty': 'Todavía no hay datos para este gráfico.',
  'charts.na': 'Sin datos',
  'charts.sum.stacked': '{title}: {total} {unit} en {n} días, {parts}.',
  'charts.sum.list': '{title}, en {unit}: {parts}.',
  'charts.sum.line': '{title}: {last} el {date}, máximo {max}{ref}.',
  'charts.sum.ref': ', {label} {value}',
  'charts.sum.spark.one': '{title}: 1 valor en {unit}, {last}.',
  'charts.sum.spark.other': '{title}: {n} valores en {unit}, el último {last}, entre {min} y {max}.',
  'charts.day': 'Día',
};

export const en: Record<string, string> = {
  'charts.empty': 'No data for this chart yet.',
  'charts.na': 'No data',
  'charts.sum.stacked': '{title}: {total} {unit} over {n} days, {parts}.',
  'charts.sum.list': '{title}, in {unit}: {parts}.',
  'charts.sum.line': '{title}: {last} on {date}, highest {max}{ref}.',
  'charts.sum.ref': ', {label} {value}',
  'charts.sum.spark.one': '{title}: 1 value in {unit}, {last}.',
  'charts.sum.spark.other': '{title}: {n} values in {unit}, the latest {last}, from {min} to {max}.',
  'charts.day': 'Day',
};
