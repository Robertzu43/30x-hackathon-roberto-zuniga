// AC-42: one step per area. Title/body are i18n keys (src/i18n/features/auth.ts). Each page puts its
// data-tour anchor on an element that is present even before its data loads (invoice-row excepted).
export type TourStep = { id: string; selector: string; route: string };

const step = (id: string, route: string): TourStep => ({ id, selector: `[data-tour="${id}"]`, route });

export const tourSteps: TourStep[] = [
  step('inbox', '/'),
  step('new-invoice', '/'),
  step('run-agent', '/'),
  step('invoice-row', '/'),
  step('policy', '/policy'),
  step('beneficiaries', '/beneficiaries'),
  step('period', '/period'),
];
