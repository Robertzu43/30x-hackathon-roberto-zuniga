// AC-42: one step per area. Title/body are i18n keys (src/i18n/features/auth.ts). Each page puts its
// data-tour anchor on an element that is present even before its data loads (invoice-row excepted).
export type TourStep = { id: string; selector: string; route: string };

// `id` names the copy (tour.<id>.title/body); it defaults to the anchor.
const step = (anchor: string, route: string, id = anchor): TourStep => ({ id, selector: `[data-tour="${anchor}"]`, route });

export const tourSteps: TourStep[] = [
  step('inbox', '/', 'inbox-ai'), // AC-79: copy in src/i18n/features/inbox.ts
  step('new-invoice', '/'),
  step('run-agent', '/'),
  step('invoice-row', '/', 'invoice-row-ai'), // AC-79: copy in src/i18n/features/detail.ts
  step('policy', '/policy'),
  step('beneficiaries', '/beneficiaries'),
  step('period', '/period'),
];
