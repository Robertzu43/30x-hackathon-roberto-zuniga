// AC-45, AC-46, AC-47, AC-66, AC-70, R-30: the public /demo page.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { expect, test } from 'vitest';
import Demo from './pages/Demo';
import { DEMO_EMAIL, fakeAuth, mockApi, renderAt, signedInAs } from './test/utils';
import gate from '../scripts/ux-gate.mjs?raw';
import portalHtml from '../portal/public/index.html?raw';
import portalJs from '../portal/public/app.js?raw';

const row = (id: string, outcome: string | null, es: string | null, en: string | null) =>
  ({ id, outcome, headline_es: es, headline_en: en, headline: es });
const overview = {
  invoices: [
    row('1', 'PAGAR', 'PAGAR · 1.800 USD a Estudio Kairos, retainer de octubre, dentro de reglas', 'PAY · 1,800 USD to Estudio Kairos, October retainer, within rules'),
    row('2', 'FRENAR', 'FRENAR · 950 USD a Pixel Lab: duplicado exacto de la factura #PX-77', 'STOP · 950 USD to Pixel Lab: exact duplicate of invoice #PX-77'),
    row('3', 'ESCALAR', 'ESCALAR · 4.200 USD a Nube Sur LLC: supera el umbral de aprobación de 2.500 USD', 'ESCALATE · 4,200 USD to Nube Sur LLC: above the approval threshold of 2,500 USD'),
    row('4', null, null, null),
  ],
  period: { autonomy: { n: 26, m: 29 }, autonomy_pct: 90, violations: 0, explained_pct: 100 },
};
const app = () =>
  renderAt(
    <Routes>
      <Route path="/demo" element={<Demo />} />
      <Route path="/" element={<p>Bandeja abierta</p>} />
    </Routes>,
    { at: '/demo' },
  );
const inbox = () => screen.getByRole('list', { name: 'Bandeja de Andina Labs' });

test('shows the inbox rows (outcome + one-line reason) and the three Periodo figures (AC-45)', async () => {
  mockApi({ 'GET /api/demo/overview': overview });
  app();
  expect(await screen.findByText('1.800 USD a Estudio Kairos, retainer de octubre, dentro de reglas')).toBeTruthy();
  const rows = within(inbox()).getAllByRole('listitem');
  expect(rows).toHaveLength(4);
  expect(rows[1]!.textContent).toBe('FRENAR950 USD a Pixel Lab: duplicado exacto de la factura #PX-77');
  expect(rows[3]!.textContent).toContain('Pendiente');
  const figures = screen.getByRole('region', { name: 'El periodo' });
  expect(within(figures).getByText('90 %')).toBeTruthy();
  expect(within(figures).getByText('0')).toBeTruthy();
  expect(within(figures).getByText('100 %')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Ver el recorrido en video/ }).getAttribute('href')).toBe('/demo/happy-path.webm');
  expect(screen.queryByRole('group', { name: /Filtrar/ })).toBeNull();
});

test('the problem in three lines, the six-stage loop, the pitch line verbatim and JEV is off (AC-45, AC-66, R-30)', async () => {
  mockApi({ 'GET /api/demo/overview': overview });
  app();
  expect(screen.getAllByTestId('problem-line')).toHaveLength(3);
  const stages = within(screen.getByRole('list', { name: 'El ciclo del agente' })).getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent);
  expect(stages).toEqual(['percibe', 'lee', 'consulta sus herramientas', 'decide', 'actúa', 'rinde cuentas']);
  expect(screen.getByText('El LLM lee, JEV duda, el código decide, el agente actúa.')).toBeTruthy();
  expect(screen.getByText('JEV, la intuición rápida, es una capa opcional; en esta demo está apagada.')).toBeTruthy();
  await screen.findByText('90 %');
});

test('/demo opens in Spanish whatever this browser showed last (R-78, D14)', async () => {
  localStorage.setItem('lang', 'en');
  mockApi({ 'GET /api/demo/overview': overview });
  app();
  expect(await screen.findByText('950 USD a Pixel Lab: duplicado exacto de la factura #PX-77')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Entrar como Andina Labs' })).toBeTruthy();
});

test('its own switch shows English headlines, kept for this tab only (R-78)', async () => {
  mockApi({ 'GET /api/demo/overview': overview });
  app();
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(await screen.findByText('950 USD to Pixel Lab: exact duplicate of invoice #PX-77')).toBeTruthy();
  expect(screen.getByText('JEV, the fast intuition, is an optional layer; in this demo it is off.')).toBeTruthy();
  expect(sessionStorage.getItem('lang')).toBe('en');
  expect(localStorage.getItem('lang')).toBeNull();
});

test('overview 503: a message and a retry that loads the inbox', async () => {
  let calls = 0;
  mockApi({
    'GET /api/demo/overview': () => (++calls === 1 ? new Response(JSON.stringify({ error: 'x' }), { status: 503 }) : overview),
  });
  app();
  expect((await screen.findByRole('alert')).textContent).toMatch(/no está disponible/);
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('90 %')).toBeTruthy();
});

test('"Entrar como Andina Labs" signs in with the config demo email and the public password, then opens / (AC-46)', async () => {
  mockApi({ 'GET /api/demo/overview': overview });
  app();
  fireEvent.click(screen.getByRole('button', { name: 'Entrar como Andina Labs' }));
  expect(await screen.findByText('Bandeja abierta')).toBeTruthy();
  expect(fakeAuth.signInWithPassword).toHaveBeenCalledWith({ email: DEMO_EMAIL, password: 'andina-demo-2026' });
  expect(sessionStorage.getItem('demo-tour')).toBe('1'); // the click asks for the tour once (R-62)
});

test('a failed sign-in stays on /demo with a message', async () => {
  fakeAuth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: new Error('Invalid login credentials') });
  mockApi({ 'GET /api/demo/overview': overview });
  app();
  fireEvent.click(screen.getByRole('button', { name: 'Entrar como Andina Labs' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/No pude entrar/);
  expect(screen.queryByText('Bandeja abierta')).toBeNull();
  expect(sessionStorage.getItem('demo-tour')).toBeNull(); // no sign-in, no pending tour
});

test('"Reiniciar demo" is hidden for visitors and for other users', async () => {
  mockApi({ 'GET /api/demo/overview': overview });
  app();
  await screen.findByText('90 %');
  expect(screen.queryByRole('button', { name: 'Reiniciar demo' })).toBeNull();
});

test('"Reiniciar demo" is hidden for a member of another company', async () => {
  signedInAs('ana@otra.example');
  mockApi({ 'GET /api/demo/overview': overview });
  app();
  await screen.findByText('90 %');
  expect(screen.queryByRole('button', { name: 'Reiniciar demo' })).toBeNull();
});

test('the demo user sees "Reiniciar demo"; it resets, then runs the budgeted loop to the end (AC-47, AC-70)', async () => {
  signedInAs(DEMO_EMAIL);
  const f = mockApi({
    'GET /api/demo/overview': overview,
    'POST /api/demo/reset': { PAGAR: 10, FRENAR: 5, ESCALAR: 3, errors: 0, remaining: 11, cursor: 'c1' },
    'POST /api/invoices/run': { PAGAR: 6, FRENAR: 3, ESCALAR: 2, errors: 0, remaining: 0, cursor: null },
  });
  app();
  fireEvent.click(await screen.findByRole('button', { name: 'Reiniciar demo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reiniciar' }));
  expect(await screen.findByText('16 PAGAR · 8 FRENAR · 5 ESCALAR')).toBeTruthy();
  const run = f.mock.calls.find(([u]) => String(u) === '/api/invoices/run');
  expect(JSON.parse(String(run![1]!.body))).toEqual({ cursor: 'c1' });
  await waitFor(() => expect(f.mock.calls.filter(([u]) => String(u) === '/api/demo/overview').length).toBeGreaterThan(1));
});

const ASK_ES = '¿Reiniciar la demo? Las facturas actuales se archivan y vuelve el conjunto de ejemplo; los cambios de otros visitantes también se pierden.';
const resets = (f: ReturnType<typeof mockApi>) => f.mock.calls.filter(([u]) => String(u) === '/api/demo/reset').length;

test('"Reiniciar demo" asks in place first; "Cancelar" changes nothing (AC-71)', async () => {
  signedInAs(DEMO_EMAIL);
  const f = mockApi({ 'GET /api/demo/overview': overview, 'POST /api/demo/reset': { PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null } });
  app();
  fireEvent.click(await screen.findByRole('button', { name: 'Reiniciar demo' }));
  expect(screen.getByText(ASK_ES)).toBeTruthy();
  expect(resets(f)).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByText(ASK_ES)).toBeNull();
  expect(screen.getByRole('button', { name: 'Reiniciar demo' })).toBeTruthy();
  await new Promise((r) => setTimeout(r, 50));
  expect(resets(f)).toBe(0);
});

test('the reset question in English: "Reset" resets (AC-71)', async () => {
  sessionStorage.setItem('lang', 'en'); // this tab chose English earlier (R-78)
  signedInAs(DEMO_EMAIL);
  const f = mockApi({ 'GET /api/demo/overview': overview, 'POST /api/demo/reset': { PAGAR: 1, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null } });
  app();
  fireEvent.click(await screen.findByRole('button', { name: 'Reset demo' }));
  expect(screen.getByText("Reset the demo? Current invoices are archived and the sample set comes back; other visitors' changes are lost too.")).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(await screen.findByText('1 PAY · 0 STOP · 0 ESCALATE')).toBeTruthy();
  expect(resets(f)).toBe(1);
});

// AC-79: where the AI acts and where code decides, next to the six stages.
const WHERE_ES =
  'Dónde actúa la IA: lee cada factura (Amazon Nova Lite en AWS Bedrock) y responde tus preguntas sobre el registro («Pregúntale a Thesaurus»). Dónde decide el código: las 13 reglas, la tabla de consecuencias y la tasa de cambio del día; solo el código puede escribir PAGAR.';
const WHERE_EN =
  'Where the AI acts: it reads each invoice (Amazon Nova Lite on AWS Bedrock) and answers your questions about the record ("Ask Thesaurus"). Where code decides: the 13 rules, the consequence table and the day\'s exchange rate; only code can write PAY.';
const tags = () =>
  Object.fromEntries(
    within(screen.getByRole('list', { name: /El ciclo del agente|The agent's loop/ })).getAllByRole('listitem')
      .map((li) => [li.querySelector('strong')!.textContent, li.querySelector('.ai-tag')?.textContent ?? null]),
  );

test('says where the AI acts and where code decides; "lee" and «Pregúntale a Thesaurus» are IA, the tools and the decision are código (AC-79)', async () => {
  mockApi({ 'GET /api/demo/overview': overview });
  app();
  expect(screen.getByText(WHERE_ES)).toBeTruthy();
  expect(tags()).toEqual({ percibe: null, lee: 'IA', 'consulta sus herramientas': 'código', decide: 'código', actúa: null, 'rinde cuentas': null });
  const ask = screen.getByText('Pregúntale a Thesaurus', { selector: 'strong' }).closest('p')!;
  expect(ask.querySelector('.ai-tag')?.textContent).toBe('IA');
  expect(screen.getByText('El LLM lee, JEV duda, el código decide, el agente actúa.')).toBeTruthy(); // AC-66 stays
  await screen.findByText('90 %');
});

test('the AI/code sentence and tags in English (AC-79)', async () => {
  mockApi({ 'GET /api/demo/overview': overview });
  app();
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(await screen.findByText(WHERE_EN)).toBeTruthy();
  expect(tags()).toMatchObject({ reads: 'AI', 'consults its tools': 'code', decides: 'code' });
  expect(screen.getByText('Ask Thesaurus', { selector: 'strong' }).closest('p')!.querySelector('.ai-tag')?.textContent).toBe('AI');
});

// Task 32b (AC-81, AC-83): one primary, then a clear route to the video and to the vendor portal of the demo company.
test('one primary action, then links to the video and to Andina Labs\' vendor portal (AC-81, AC-83)', () => {
  mockApi({ 'GET /api/demo/overview': overview });
  app();
  expect(document.querySelectorAll('button.primary')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /Abrir el portal de proveedores/ }).getAttribute('href')).toBe('https://facturas.30x-hackathon-roberto-zuniga.workers.dev/andina-labs');
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(screen.getByRole('link', { name: /Open the vendor portal/ })).toBeTruthy();
});

// AC-81, AC-53 Clarified (R-99, R-100): the screens of Task 32b carry no colour outside the approved palette (the gate's own list).
test('the /demo, Login and vendor portal styles use only approved palette colours (AC-81)', async () => {
  const PALETTE = gate.match(/export const PALETTE = (\[[^\]]+\])/)![1]!.match(/#[0-9a-f]{6}/g)!;
  // CSS is read from disk: a `?raw` CSS import is empty under vitest (css processing off).
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync: (f: string, e: 'utf8') => string };
  const css = (f: string) => readFileSync(new URL(f, import.meta.url).pathname, 'utf8');
  const files: Record<string, string> = { demoCss: css('./pages/demo.css'), loginCss: css('./pages/login.css'), portalCss: css('../portal/public/styles.css'), portalJs, portalHtml };
  const long = (h: string) => (h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h).toLowerCase();
  const off = Object.entries(files).flatMap(([f, text]) => (text.match(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi) ?? []).map(long).filter((h) => !PALETTE.includes(h)).map((h) => `${f} ${h}`));
  expect(off).toEqual([]);
});
