// «Actividad del agente» (AC-78, R-89): replays the recorded steps at about 400 ms each, newest invoice first, polls every
// 10 s only while the tab is visible, and plays a run call's new decisions as soon as Bandeja asks (refresh).
import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import AgentActivity from './components/AgentActivity';
import { useT } from './i18n';
import { mockApi, renderAt, signedInAs } from './test/utils';

const steps = (payee: string, outcome: string) => [
  { stage: 'lee', text: `Leyendo la factura de ${payee} con IA…` },
  { stage: 'consulta', text: 'Consultando el directorio…' },
  { stage: 'consulta', text: 'Verificando 13 reglas…' },
  { stage: 'decide', text: `Decidí ${outcome}` },
];
const item = (id: string, at: string, payee: string, outcome = 'PAGAR') =>
  ({ invoice_id: id, payee, outcome, decided_at: at, actor: 'agent', read_by_ai: true, steps: steps(payee, outcome) });
const NEW = item('n', '2026-10-17T15:05:00.000Z', 'Laura Méndez');
const OLD = item('o', '2026-10-17T15:00:00.000Z', 'Kodex Labs', 'ESCALAR');
const BASE = 'GET /api/agent/activity';
const since = (iso: string) => `${BASE}?since=${encodeURIComponent(iso)}`;
// The api call is a chain of promises (session, fetch, json): settle it, then move the clock.
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
// act flushes React only when it ends, so the clock moves in 400 ms slices: each played step schedules the next one.
const slice = (ms: number) => act(async () => { await settle(); await vi.advanceTimersByTimeAsync(ms); await settle(); });
const tick = async (ms: number) => { for (let t = 0; t === 0 || t < ms; t += 400) await slice(Math.min(400, ms - t)); };
const shown = () => screen.queryAllByRole('listitem').filter((li) => !li.querySelector('li')).map((li) => li.textContent);
const activityCalls = (f: ReturnType<typeof mockApi>) => f.mock.calls.filter(([u]) => String(u).startsWith('/api/agent/activity')).map(([u]) => String(u));
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  signedInAs('ana@empresa.co');
});
afterEach(() => vi.useRealTimers());
const setVisibility = (v: DocumentVisibilityState) => act(() => { visibility = v; document.dispatchEvent(new Event('visibilitychange')); });

test('shows the label that the steps come from the record, and plays the steps in order, newest invoice first', async () => {
  mockApi({ [BASE]: { items: [NEW, OLD] }, [since(NEW.decided_at)]: { items: [NEW] } });
  renderAt(<AgentActivity />);
  expect(screen.getByRole('heading', { name: 'Actividad del agente' })).toBeTruthy();
  expect(screen.getByText('Así trabaja el agente: cada paso sale del registro de la decisión.')).toBeTruthy();
  await tick(0);
  expect(shown()).toEqual([]);
  await tick(400);
  expect(shown()).toEqual(['Leyendo la factura de Laura Méndez con IA…']);
  await tick(400);
  expect(shown()).toEqual(['Leyendo la factura de Laura Méndez con IA…', 'Consultando el directorio…']);
  await tick(800);
  expect(shown()).toEqual(steps('Laura Méndez', 'PAGAR').map((s) => s.text));
  await tick(400);
  expect(shown().at(-1)).toBe('Leyendo la factura de Kodex Labs con IA…');
  await tick(1200);
  expect(shown()).toEqual([...steps('Laura Méndez', 'PAGAR'), ...steps('Kodex Labs', 'ESCALAR')].map((s) => s.text));
});

test('polls every 10 s with since = the newest decision seen, plays only what is new, and stops while the tab is hidden', async () => {
  const LATER = item('l', '2026-10-17T15:09:00.000Z', 'Ana Souza', 'FRENAR');
  const f = mockApi({ [BASE]: { items: [NEW] }, [since(NEW.decided_at)]: { items: [LATER, NEW] }, [since(LATER.decided_at)]: { items: [LATER] } });
  renderAt(<AgentActivity />);
  await tick(2000);
  expect(activityCalls(f)).toEqual(['/api/agent/activity']);
  await tick(8000);
  expect(activityCalls(f)).toEqual(['/api/agent/activity', `/api/agent/activity?since=${encodeURIComponent(NEW.decided_at)}`]);
  await tick(2000);
  expect(shown()).toEqual([...steps('Ana Souza', 'FRENAR'), ...steps('Laura Méndez', 'PAGAR')].map((s) => s.text)); // newest on top, NEW not replayed twice
  setVisibility('hidden');
  await tick(60_000);
  expect(activityCalls(f)).toHaveLength(2);
  setVisibility('visible');
  await tick(0);
  expect(activityCalls(f)).toHaveLength(3); // catches up at once, then every 10 s again
  await tick(10_000);
  expect(activityCalls(f)).toHaveLength(4);
});

test('a run call returning (refresh) fetches and plays its new decisions at once', async () => {
  let answer: unknown = { items: [] };
  const f = mockApi({ [BASE]: () => answer });
  function Bandeja() { // stands in for Inbox: its run loop bumps `refresh` after each call (onBatch)
    const [n, setN] = useState(0);
    return <><button type="button" onClick={() => setN(n + 1)}>lote</button><AgentActivity refresh={n} /></>;
  }
  renderAt(<Bandeja />);
  await tick(0);
  expect(screen.getByText('Cuando el agente decida una factura verás aquí cada paso. Pulsa «Ejecutar agente» para verlo.')).toBeTruthy();
  answer = { items: [NEW] };
  fireEvent.click(screen.getByRole('button', { name: 'lote' }));
  await tick(0);
  await tick(400);
  expect(shown()).toEqual(['Leyendo la factura de Laura Méndez con IA…']);
  expect(activityCalls(f)).toHaveLength(2); // the first load and the refresh, no poll yet
});

test('loading, then a designed error that says it retries; English words', async () => {
  localStorage.setItem('lang', 'en');
  mockApi({ [BASE]: new Response(JSON.stringify({ error: 'boom' }), { status: 500 }) });
  renderAt(<AgentActivity />);
  expect(screen.getByText('Loading the agent activity…')).toBeTruthy();
  expect(screen.getByText('How the agent works: every step comes from the decision record.')).toBeTruthy();
  await tick(0);
  expect(screen.getByText("I couldn't load the agent activity; I'll try again in 10 seconds.")).toBeTruthy();
});

test('an answer without items (an empty list) is the empty state, never a crash', async () => {
  mockApi({ [BASE]: [] });
  renderAt(<AgentActivity />);
  await tick(0);
  expect(screen.getByText(/Cuando el agente decida una factura/)).toBeTruthy();
});

test('a language switch replays the panel from a fresh fetch, so no step stays in the other language (R-98)', async () => {
  let answer: unknown = { items: [NEW] };
  const f = mockApi({ [BASE]: () => answer });
  function Switch() {
    const { setLang } = useT();
    return <><button type="button" onClick={() => setLang('en')}>en</button><AgentActivity /></>;
  }
  renderAt(<Switch />);
  await tick(0);
  await tick(1600);
  expect(shown()).toHaveLength(4);
  answer = { items: [{ ...NEW, steps: [{ stage: 'lee', text: "Reading Laura Méndez's invoice with AI…" }] }] };
  fireEvent.click(screen.getByRole('button', { name: 'en' }));
  await tick(0);
  await tick(400);
  expect(shown()).toEqual(["Reading Laura Méndez's invoice with AI…"]);
  expect(activityCalls(f)).toEqual(['/api/agent/activity', '/api/agent/activity']); // from scratch, no since
});

test('an answer still in flight when the language switches is dropped', async () => {
  let release: (v: unknown) => void = () => {};
  let answer: unknown = new Promise((r) => (release = r));
  mockApi({ [BASE]: () => answer });
  function Switch() {
    const { setLang } = useT();
    return <><button type="button" onClick={() => setLang('en')}>en</button><AgentActivity /></>;
  }
  renderAt(<Switch />);
  await tick(0);
  answer = { items: [] };
  fireEvent.click(screen.getByRole('button', { name: 'en' }));
  await tick(0);
  release({ items: [NEW] }); // the Spanish answer arrives late
  await tick(0);
  await tick(1600);
  expect(shown()).toEqual([]);
  expect(screen.getByText(/When the agent decides an invoice/)).toBeTruthy();
});
