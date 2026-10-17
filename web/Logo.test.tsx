import { screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import App from './App';
import { mockApi, renderAt } from './test/utils';

beforeEach(() => mockApi({ 'GET /api/invoices': [], 'GET /api/agent/last-run': null }));

// AC-80: Login (full-bleed), /demo (full-bleed) and the approve page (inside the top bar) each show the Thesaurus logo.
test.each(['/login', '/demo', '/approve/abc'])('%s shows the Thesaurus logo as an SVG image', async (at) => {
  renderAt(<App />, { at });
  const logo = await screen.findByRole('img', { name: 'Thesaurus' });
  expect(logo.getAttribute('src')).toBe('/brand/thesaurus-logo.svg');
});

test('the tagline stays as text next to the logo', async () => {
  renderAt(<App />, { at: '/approve/abc' });
  expect(await screen.findByText('un agente de pagos construido para Blinka')).toBeTruthy();
});
