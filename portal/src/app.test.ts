// @vitest-environment jsdom
/// <reference types="vite/client" />
// portal/public/app.js in a DOM (AC-83, AC-84, AC-85 item 4, AC-90): text rendering only, the 100 ms acknowledgement,
// friendly errors with a next step, the language switch and the status page. fetch is faked; no Worker runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en, es } from '../../src/i18n/features/portal';
import shell from '../public/index.html?raw';

const XSS = '<img src=x onerror=alert(1)>';
const TOKEN_PATH = `/estado/${'a'.repeat(43)}`;
const REPLY = { ok: true, status_path: TOKEN_PATH, reply: {
  es: ['Esto leí en tu factura:', `Beneficiario: ${XSS}`, 'Monto y moneda: 2.500 USD', 'Número: 1050', 'Estado: en revisión'],
  en: ['This is what I read on your invoice:', `Payee: ${XSS}`, 'Amount and currency: 2,500 USD', 'Number: 1050', 'Status: under review'] } };

let fetchMock: ReturnType<typeof vi.fn>;
async function open(view: object, path = '/andina-labs', lang?: string) {
  window.history.replaceState(null, '', path + (lang ? `?lang=${lang}` : ''));
  const boot = JSON.stringify({ ...view, t: { es, en } });
  document.documentElement.innerHTML = shell.replace(/^<!doctype html>\s*<html[^>]*>/i, '').replace(/<\/html>\s*$/, '')
    .replace('<!--boot-->', `<script type="application/json" id="boot">${boot.replace(/</g, '\\u003c')}</script>`);
  vi.resetModules();
  await import('../public/app.js' as string);
}
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const texts = (s: string) => [...document.querySelectorAll(s)].map((e) => e.textContent);
const typeAndSend = (text: string) => {
  const ta = $<HTMLTextAreaElement>('textarea');
  ta.value = text;
  ta.dispatchEvent(new Event('input'));
  $<HTMLFormElement>('form').requestSubmit();
};
const pick = (f: File) => {
  const input = $<HTMLInputElement>('input[type=file]');
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  input.dispatchEvent(new Event('change'));
};
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn(async () => new Response(JSON.stringify(REPLY), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('chat page (AC-83, AC-90)', () => {
  it('greets with the company name, labels every control, and sets the document language', async () => {
    await open({ view: 'chat', company: 'Andina Labs Inc.' });
    expect(document.documentElement.lang).toBe('es');
    expect($('h1').textContent).toBe('Facturas para Andina Labs Inc.');
    expect(texts('.log .bubble')[0]).toContain('Hola, soy Thesaurus, el agente de pagos de Andina Labs Inc. Envíame tu factura o cuenta de cobro.');
    expect($('label[for=msg]').textContent).toBe('Mensaje');
    expect($('button.attach').getAttribute('aria-label')).toBe('Adjuntar factura');
    expect($('button[type=submit]').textContent).toBe('Enviar');
    expect($('img.mark').getAttribute('src')).toBe('/brand/thesaurus-mark.svg');
  });

  it('the es/en switch re-renders every text in the other language and remembers it', async () => {
    await open({ view: 'chat', company: 'Andina Labs Inc.' });
    $<HTMLButtonElement>('button[data-lang=en]').click();
    expect(document.documentElement.lang).toBe('en');
    expect(texts('.log .bubble')[0]).toContain("Hi, I'm Thesaurus, Andina Labs Inc.'s payments agent. Send me your invoice or bill.");
    expect($('button[type=submit]').textContent).toBe('Send');
    expect($('button[data-lang=en]').getAttribute('aria-pressed')).toBe('true');
    await open({ view: 'chat', company: 'Andina Labs Inc.' });
    expect(document.documentElement.lang).toBe('en');
    await open({ view: 'chat', company: 'X' }, '/x', 'es');
    expect(document.documentElement.lang).toBe('es');
  });

  it('on send: the vendor bubble and «Recibido…» at once, the button busy, then the reply as text with the status link', async () => {
    await open({ view: 'chat', company: 'Andina Labs Inc.' });
    let answer!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    typeAndSend(XSS);
    const send = $<HTMLButtonElement>('button[type=submit]');
    expect(texts('.log .bubble').slice(1)).toEqual([expect.stringContaining(XSS), 'Recibido; estoy leyendo tu factura…']);
    expect(send.disabled).toBe(true);
    expect($('form').getAttribute('aria-busy')).toBe('true');
    expect($<HTMLTextAreaElement>('textarea').value).toBe('');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect([url, init.method, [...(init.body as FormData).keys()]]).toEqual(['/andina-labs', 'POST', ['text']]);
    answer(new Response(JSON.stringify(REPLY), { status: 200 }));
    await settle();
    expect(send.disabled).toBe(false);
    const reply = document.querySelectorAll('.log .bubble')[2]!;
    expect([...reply.querySelectorAll('p')].map((p) => p.textContent).slice(0, 5)).toEqual(REPLY.reply.es);
    const link = reply.querySelector('a')!;
    expect([link.getAttribute('href'), link.textContent]).toEqual([`${location.origin}${TOKEN_PATH}`, `${location.origin}${TOKEN_PATH}`]);
    expect(document.querySelector('img[src=x]')).toBeNull(); // shown literally, nothing runs
    $<HTMLButtonElement>('button[data-lang=en]').click();
    expect(document.querySelectorAll('.log .bubble')[2]!.querySelector('p')!.textContent).toBe('This is what I read on your invoice:');
  });

  it('a file goes as the invoice with the text beside it', async () => {
    await open({ view: 'chat', company: 'A' });
    pick(new File(['%PDF'], 'factura.pdf', { type: 'application/pdf' }));
    expect($('.chip').textContent).toContain('factura.pdf');
    typeAndSend('nota');
    expect([...(fetchMock.mock.calls[0]![1].body as FormData).keys()]).toEqual(['text', 'file']);
  });

  it.each([
    ['a .docx', () => pick(new File(['PK'], 'f.docx')), 'Ese archivo no lo puedo leer: envía un PDF, PNG o JPG de hasta 10 MB.'],
    ['an 11 MB PDF', () => pick(new File([new Uint8Array(11 * 1024 * 1024)], 'f.pdf')), 'Ese archivo no lo puedo leer: envía un PDF, PNG o JPG de hasta 10 MB.'],
    ['20.001 characters', () => typeAndSend('x'.repeat(20001)), 'Escribe un mensaje de 1 a 20.000 caracteres o adjunta tu factura.'],
    ['an empty message', () => typeAndSend('  '), 'Escribe un mensaje de 1 a 20.000 caracteres o adjunta tu factura.'],
  ])('%s: a friendly error at once, nothing sent', async (_, act, message) => {
    await open({ view: 'chat', company: 'A' });
    act();
    expect(texts('.log .bubble.error')).toEqual([message]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [429, 'rate_ip', 'Recibí muchas facturas desde tu conexión; intenta de nuevo en una hora.'],
    [429, 'rate_company', 'Este portal recibió muchas facturas hoy; intenta de nuevo mañana.'],
    [400, 'file', 'Ese archivo no lo puedo leer: envía un PDF, PNG o JPG de hasta 10 MB.'],
    [404, 'not_found', 'Este enlace de facturas no existe. Pídele el enlace correcto a la empresa que te contrató.'],
    [503, 'failed', 'No pude recibir tu factura en este momento; inténtalo de nuevo en unos minutos.'],
    [502, 'whatever', 'No pude recibir tu factura en este momento; inténtalo de nuevo en unos minutos.'],
  ])('a %i %s answer: its message, and the text back in the box', async (status, error, message) => {
    await open({ view: 'chat', company: 'A' });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error }), { status }));
    typeAndSend('mi factura');
    await settle();
    expect(texts('.log .bubble.error')).toEqual([message]);
    expect($<HTMLTextAreaElement>('textarea').value).toBe('mi factura');
  });

  it('offline: «Sin conexión…», nothing lost', async () => {
    await open({ view: 'chat', company: 'A' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    typeAndSend('mi factura');
    await settle();
    expect(texts('.log .bubble.error')).toEqual(['Sin conexión. Tu mensaje no se envió; revisa tu conexión e inténtalo de nuevo.']);
    expect($<HTMLTextAreaElement>('textarea').value).toBe('mi factura');
  });
});

describe('QA run 1 fixes (AC-84 R-102, AC-90 R-101, AC-91 items 3 and 6)', () => {
  it('the language buttons: the accessible name starts with the visible text; no browser-language detection (R-101)', async () => {
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
    await open({ view: 'chat', company: 'A' });
    expect(document.documentElement.lang).toBe('es');
    for (const b of document.querySelectorAll('button[data-lang]')) expect(b.getAttribute('aria-label')).toMatch(new RegExp(`^${b.textContent}\\b`));
  });

  it('the chat log is a div role=log of articles, never list items under the log role', async () => {
    await open({ view: 'chat', company: 'A' });
    const log = $('[role=log]');
    expect([log.tagName, log.querySelectorAll('li').length, log.firstElementChild!.tagName]).toEqual(['DIV', 0, 'ARTICLE']);
  });

  it('the logo mark is named «Thesaurus» once and marked data-logo', async () => {
    await open({ view: 'chat', company: 'A' });
    expect([$('img.mark').getAttribute('alt'), $('img.mark').hasAttribute('data-logo')]).toEqual(['Thesaurus', true]);
    expect($('.brand [aria-hidden=true]').textContent).toBe('Thesaurus');
  });

  it('the reply status words are emphasised', async () => {
    await open({ view: 'chat', company: 'A' });
    typeAndSend('mi factura');
    await settle();
    expect(texts('.log .bubble strong')).toEqual(['en revisión']);
    $<HTMLButtonElement>('button[data-lang=en]').click();
    expect(texts('.log .bubble strong')).toEqual(['under review']);
  });

  const copy = async (writeText: () => Promise<void>) => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(writeText) }, configurable: true });
    await open({ view: 'chat', company: 'A' });
    typeAndSend('mi factura');
    await settle();
    const b = $<HTMLButtonElement>('button.copy');
    expect([b.textContent, b.classList.contains('primary')]).toEqual(['Copiar enlace', false]);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    b.click();
    await vi.advanceTimersByTimeAsync(0);
    return b;
  };

  it('«Copiar enlace» copies the full status URL, says «Copiado» for 2 s and announces it (R-102)', async () => {
    const b = await copy(async () => {});
    expect(vi.mocked(navigator.clipboard.writeText)).toHaveBeenCalledWith(`${location.origin}${TOKEN_PATH}`);
    expect([b.textContent, $('[aria-live=polite].sr-only').textContent]).toEqual(['Copiado', 'Copiado']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.textContent).toBe('Copiar enlace');
  });

  it('a refused clipboard says to press and hold the link (R-102)', async () => {
    const b = await copy(async () => { throw new DOMException('denied', 'NotAllowedError'); });
    expect([b.textContent, $('[aria-live=polite].sr-only').textContent]).toEqual(Array(2).fill('No pude copiarlo; mantén presionado el enlace.'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.textContent).toBe('No pude copiarlo; mantén presionado el enlace.');
  });
});

describe('status and message pages (AC-84, AC-90)', () => {
  const STATUS = { ok: true, company: 'Andina Labs Inc.', status: { es: 'requiere aprobación de Andina Labs Inc.', en: 'needs approval from Andina Labs Inc.' },
    read: { es: ['Beneficiario: Laura Méndez', 'Monto y moneda: 2.500 USD', 'Número: 1050'], en: ['Payee: Laura Méndez', 'Amount and currency: 2,500 USD', 'Number: 1050'] },
    updated_at: '2026-10-17T15:00:00Z' };

  it('the status page: the status first, then what was read, then the last update, with no codes or ids', async () => {
    await open({ view: 'status', status: STATUS }, TOKEN_PATH);
    expect($('h1').textContent).toBe('requiere aprobación de Andina Labs Inc.');
    expect(texts('main li')).toEqual(STATUS.read.es);
    expect($('main').textContent).toMatch(/Última actualización: .*2026/);
    expect($('main').textContent).not.toMatch(/aaaa|estado\/|null|undefined/);
    $<HTMLButtonElement>('button[data-lang=en]').click();
    expect($('h1').textContent).toBe('needs approval from Andina Labs Inc.');
    expect($('main').textContent).toMatch(/Last update: .*2026/);
  });

  it('the status page offline: a designed notice with the next step, gone when back online (UX-08)', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await open({ view: 'status', status: STATUS }, TOKEN_PATH);
    expect($('[role=status]').textContent).toBe('Sin conexión. Revisa tu conexión y vuelve a abrir este enlace.');
    $<HTMLButtonElement>('button[data-lang=en]').click();
    expect($('[role=status]').textContent).toBe('No connection. Check your connection and open this link again.');
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
    expect($('[role=status]').hidden).toBe(true);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));
    expect($('[role=status]').hidden).toBe(false);
    expect($('h1').textContent).toBe('needs approval from Andina Labs Inc.'); // what was shown stays
  });

  it.each([
    ['not_found', 'Este enlace de facturas no existe. Pídele el enlace correcto a la empresa que te contrató.'],
    ['invalid', 'Este enlace de estado no es válido. Revisa que lo copiaste completo.'],
    ['rate_status', 'Demasiadas consultas; espera un minuto.'],
    ['unavailable', 'Este portal no está disponible en este momento; inténtalo de nuevo en unos minutos.'],
  ])('%s', async (view, message) => {
    await open({ view }, '/x');
    expect($('h1').textContent).toBe(message);
    expect(document.querySelector('form')).toBeNull();
  });
});
