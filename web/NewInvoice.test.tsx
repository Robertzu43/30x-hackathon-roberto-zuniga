// Nueva factura, UX QA run 1 (Task 31): the file picker speaks the app language and an empty submit says what is missing.
import { fireEvent, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import NewInvoice from './components/NewInvoice';
import { mockApi, renderAt } from './test/utils';

const send = (name = 'Enviar al agente') => fireEvent.click(screen.getByRole('button', { name }));

test('sending with no file chosen asks for a file, in the app language, and posts nothing (UX-20)', async () => {
  const f = mockApi();
  renderAt(<NewInvoice />);
  send();
  expect((await screen.findByRole('alert')).textContent).toBe('Elige un archivo');
  expect(f.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0);
});

test('the same in English (UX-20)', async () => {
  localStorage.setItem('lang', 'en');
  renderAt(<NewInvoice />);
  send('Send to the agent');
  expect((await screen.findByRole('alert')).textContent).toBe('Choose a file');
});

test('the file picker shows the app wording, not the browser «Choose File / No file chosen» (UX-19)', () => {
  renderAt(<NewInvoice />);
  expect(screen.getByText('Elegir archivo')).toBeTruthy();
  expect(screen.getByText('Ningún archivo elegido')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Archivo: PDF, PNG o JPG, hasta 10 MB'), { target: { files: [new File(['%PDF'], '01.pdf', { type: 'application/pdf' })] } });
  expect(screen.getByText('01.pdf')).toBeTruthy();
});

test('the selected tab does not look like a primary button: one primary per view (UX-23)', async () => {
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  const css = readFileSync('web/components/new-invoice.css', 'utf8');
  const selected = css.match(/\[role='tab'\]\[aria-selected='true'\] \{([^}]*)\}/)?.[1] ?? '';
  expect(selected).toMatch(/background: var\(--surface\)/);
  renderAt(<NewInvoice />);
  expect(document.querySelectorAll('.primary')).toHaveLength(1);
});
