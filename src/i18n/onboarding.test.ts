import { expect, test } from 'vitest';
import { ui } from './ui';

// AC-118: onboarding text names no vendor, model or jargon; technology only where D47 (2) allows it.
const banned = /Bedrock|Nova|AWS|Amazon|Yahoo|Workers AI|Cloudflare|Supabase|\bLLM\b|\bJEV\b|\bmodelo?\b|tabla de consecuencias|consequence table|herramientas|\btools\b|percibe|perceives|→/i;
const vendors = /Bedrock|Nova|AWS|Amazon|Yahoo|open\.er-api|Workers AI|Cloudflare|Supabase/;
const onboarding = /^(tour|brand|login|entry)\.|^(trial\.lead|account\.lead|activity\.empty|ask\.label)$|^inbox\.empty\.\d\.(title|text)$|^portal\.steps\./;
const allowed = /^(demo\.(loop|stage|tag)\.|demo\.(where|pitch|jev|ask\.text)$)/;

test.each(['es', 'en'] as const)('no onboarding value names a vendor or jargon (%s)', (lang) => {
  const hits = Object.entries(ui[lang]).filter(([k, v]) => onboarding.test(k) && banned.test(v));
  expect(hits).toEqual([]);
});
test.each(['es', 'en'] as const)('each tour body is at most 180 characters and two sentences (%s)', (lang) => {
  const bodies = Object.entries(ui[lang]).filter(([k]) => /^tour\.[a-z-]+\.body$/.test(k));
  expect(bodies).toHaveLength(7);
  for (const [k, v] of bodies) {
    expect([k, v.length <= 180]).toEqual([k, true]);
    expect([k, v.split(/[.!?]+(?:\s|$)/).filter(Boolean).length <= 2]).toEqual([k, true]);
  }
});
test.each(['es', 'en'] as const)('only «Cómo funciona» names a vendor in the UI dictionaries (%s)', (lang) => {
  const hits = Object.entries(ui[lang]).filter(([k, v]) => !allowed.test(k) && vendors.test(v)).map(([k]) => k);
  expect(hits).toEqual([]);
});
