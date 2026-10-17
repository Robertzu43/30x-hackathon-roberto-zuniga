// Test-only: a readable fixture id as a real UUID (R-74: any other id is a 404 with no database call).
// 'A-11' -> '00000000-0000-4000-8000-0000412d3131'.
export const uid = (s: string) =>
  `00000000-0000-4000-8000-${[...s].map((c) => c.charCodeAt(0).toString(16)).join('').padStart(12, '0')}`;
