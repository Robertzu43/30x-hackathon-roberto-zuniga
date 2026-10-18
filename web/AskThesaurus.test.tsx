// AC-67 (web): «Pregúntale a Thesaurus». The API is mocked; the route itself is tested in src/routes/ask.test.ts (Task 23).
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import AskThesaurus from './components/AskThesaurus';
import { useT } from './i18n';
import { mockApi, renderAt } from './test/utils';

const ASK = 'POST /api/ask';
const NOVA = 'Amazon Nova Lite (AWS Bedrock)';
const LABEL_ES = 'Respuesta generada por IA a partir del registro. Puede equivocarse: el registro manda.'; // AC-118: no provider in the label
const MESSAGES = {
  user_cap: 'Llegaste al límite de 10 preguntas por día. El cupo se renueva a las 19:00, hora de Bogotá. Todo lo que el agente hizo sigue en el registro.',
  ai_quota: 'La IA de Thesaurus no tiene cupo disponible en este momento. Vuelve más tarde; el cupo diario se renueva a las 19:00, hora de Bogotá. Las decisiones no dependen de la IA: el registro de cada factura sigue completo.',
  failed: 'No pude responder ahora; revisa el registro.',
};
const BAD = 'Escribe una pregunta de 1 a 500 caracteres.';
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function English() {
  const { setLang } = useT();
  return <button type="button" onClick={() => setLang('en')}>to-en</button>;
}
const open = (invoiceId?: string) => renderAt(<><AskThesaurus invoiceId={invoiceId} /><English /></>);
const ask = (q: string) => {
  fireEvent.change(screen.getByLabelText('Tu pregunta sobre el registro'), { target: { value: q } });
  fireEvent.click(screen.getByRole('button', { name: 'Preguntar' }));
};
const bodies = (f: ReturnType<typeof mockApi>) =>
  f.mock.calls.filter(([u, i]) => u === '/api/ask' && i?.method === 'POST').map(([, i]) => JSON.parse(String(i!.body)) as unknown);

test('on a record: posts the question, the UI language and the invoice, then shows the answer, its label and what is left (AC-67)', async () => {
  const f = mockApi({ [ASK]: { answer: 'La frené porque la factura #2044 ya había llegado.', provider: NOVA, remaining: 7 } });
  open('inv-1');
  expect(screen.getByRole('heading', { name: 'Pregúntale a Thesaurus' })).toBeTruthy();
  ask('  ¿por qué frenaste esta factura?  ');
  expect(await screen.findByText('La frené porque la factura #2044 ya había llegado.')).toBeTruthy();
  expect(screen.getByText(LABEL_ES)).toBeTruthy();
  expect(screen.getByText('Te quedan 7 preguntas hoy')).toBeTruthy();
  expect(bodies(f)).toEqual([{ question: '¿por qué frenaste esta factura?', lang: 'es', invoice_id: 'inv-1' }]);
});

test('on Bandeja: no invoice is sent; one question left reads in the singular', async () => {
  const f = mockApi({ [ASK]: { answer: 'Quedan 3.200 USD del presupuesto de octubre.', provider: 'Workers AI · @cf/meta/llama-3.1-8b-instruct', remaining: 1 } });
  open();
  ask('¿cuánto queda del presupuesto?');
  expect(await screen.findByText('Te queda 1 pregunta hoy')).toBeTruthy();
  expect(screen.getByText(LABEL_ES)).toBeTruthy();
  expect(screen.queryByText(/Workers AI|llama/)).toBeNull();
  expect(bodies(f)).toEqual([{ question: '¿cuánto queda del presupuesto?', lang: 'es' }]);
});

for (const [reason, message] of Object.entries(MESSAGES))
  test(`a 200 non-answer "${reason}" shows its message, no label and no count (AC-67)`, async () => {
    mockApi({ [ASK]: { answer: null, reason, message: 'texto del servidor' } });
    open('inv-1');
    ask('págala');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(/Respuesta generada por IA/)).toBeNull();
    expect(screen.queryByText(/Te qued/)).toBeNull();
  });

test('an unknown reason, a 500 or a network failure all read as "failed"; the box stays usable', async () => {
  mockApi({ [ASK]: { answer: null, reason: 'otra_cosa', message: 'x' } });
  open();
  ask('hola');
  expect(await screen.findByText(MESSAGES.failed)).toBeTruthy();
  mockApi({ [ASK]: json({ error: 'boom' }, 500) });
  ask('hola otra vez');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preguntar' }).hasAttribute('disabled')).toBe(false));
  expect(screen.getByText(MESSAGES.failed)).toBeTruthy();
});

test('an empty or 501-character question is refused here with the API text and never sent; an API 400 shows it too', async () => {
  const f = mockApi({ [ASK]: json({ error: BAD }, 400) });
  open();
  ask('   ');
  expect(screen.getByText(BAD)).toBeTruthy();
  ask('a'.repeat(501));
  expect(screen.getByText(BAD)).toBeTruthy();
  expect(bodies(f)).toHaveLength(0);
  ask('a'.repeat(500));
  await waitFor(() => expect(bodies(f)).toHaveLength(1));
  expect(await screen.findByText(BAD)).toBeTruthy();
});

test('while it waits the button is disabled and busy (AC-91 feedback)', async () => {
  let release: (v: unknown) => void = () => {};
  mockApi({ [ASK]: () => new Promise((r) => (release = r)) });
  open();
  ask('¿cuánto queda?');
  const button = await screen.findByRole('button', { name: 'Buscando en el registro…' });
  expect(button.hasAttribute('disabled')).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  release({ answer: 'Quedan 3.200 USD.', provider: NOVA, remaining: 9 });
  expect(await screen.findByText('Quedan 3.200 USD.')).toBeTruthy();
});

test('in English: sends lang en, shows the English label and count', async () => {
  const f = mockApi({ [ASK]: { answer: 'It is a duplicate of invoice #2044.', provider: NOVA, remaining: 0 } });
  open('inv-1');
  fireEvent.click(screen.getByRole('button', { name: 'to-en' }));
  expect(screen.getByRole('heading', { name: 'Ask Thesaurus' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Your question about the record'), { target: { value: 'why?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(await screen.findByText('AI-generated answer based on the record. It can be wrong: the record prevails.')).toBeTruthy();
  expect(screen.getByText('0 questions left today')).toBeTruthy();
  expect(bodies(f)).toEqual([{ question: 'why?', lang: 'en', invoice_id: 'inv-1' }]);
});

test('English non-answers use the English texts (AC-67)', async () => {
  mockApi({ [ASK]: { answer: null, reason: 'user_cap', message: 'x' } });
  open();
  fireEvent.click(screen.getByRole('button', { name: 'to-en' }));
  fireEvent.change(screen.getByLabelText('Your question about the record'), { target: { value: 'why?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(await screen.findByText('You reached the limit of 10 questions a day. It renews at 19:00 Bogotá time (00:00 UTC). Everything the agent did is still in the record.')).toBeTruthy();
});
