// AC-42: one step per area. Title/body are i18n keys (src/i18n/features/auth.ts). Each page puts its
// data-tour anchor on an element that is present even before its data loads (invoice-row excepted).
// AC-117 (R-182): the anchor is the element that holds what the step's title names. `narrow` (a data-tour id) is a smaller one for <= PHONE px,
// where the card is a bottom sheet and the full target does not fit above it (the «Facturas» header's filters stack; the row scrolls sideways).
export type TourStep = { id: string; selector: string; narrow?: string; route: string };

export const PHONE = 480; // R-105: at or under this width the card is pinned to the bottom (styles.css)

const step = (id: string, route: string, narrow?: string): TourStep => ({ id, selector: `[data-tour="${id}"]`, route, ...(narrow && { narrow }) });

/** The data-tour id of the element a step lights at this viewport width. */
export const anchor = (s: TourStep, width: number) => (width <= PHONE && s.narrow) || s.id;

export const tourSteps: TourStep[] = [
  step('inbox', '/', 'inbox-title'),
  step('new-invoice', '/'),
  step('run-agent', '/'),
  step('invoice-row', '/', 'invoice-open'),
  step('policy', '/policy'),
  step('beneficiaries', '/beneficiaries'),
  step('period', '/period'),
];
