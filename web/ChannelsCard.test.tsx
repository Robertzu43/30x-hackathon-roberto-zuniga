// The Canales card (AC-123): three honest rows, es and en; «Copiar enlace» as AC-84 Clarified (R-102).
import { fireEvent, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import ChannelsCard, { type Channels } from './components/ChannelsCard';
import { renderAt } from './test/utils';

const PORTAL = 'https://facturas.30x-hackathon-roberto-zuniga.workers.dev/andina-labs';
const EMAIL = 'facturas+andina-labs@in.example.co';
const TG = 'https://t.me/thesaurus_bot?start=andina-labs';
const OFF: Channels = { portal_url: PORTAL, email_address: null, email_live: false, telegram_url: null };
const ALL: Channels = { portal_url: PORTAL, email_address: EMAIL, email_live: true, telegram_url: TG };

const show = (link: Channels | 'error', lang: 'es' | 'en' = 'es') => {
  localStorage.setItem('lang', lang);
  renderAt(<ChannelsCard link={link} />);
  return screen.getByRole('region', { name: lang === 'es' ? 'Canales' : 'Channels' });
};
const row = (card: HTMLElement, id: string) => card.querySelector<HTMLElement>(`[data-channel="${id}"]`)!;

const WORDS = {
  es: { title: 'Canales', lead: 'Tus proveedores te envían las facturas por aquí, y Thesaurus decide cada una al llegar.', active: 'Activo', pending: 'Pendiente de dominio', off: 'Sin conectar',
    portal: ['Portal de proveedores', 'Comparte este enlace con tus proveedores.'], email: ['Correo', 'Tus proveedores escriben a esta dirección con la factura adjunta.', 'Pide a tu equipo técnico que conecte un dominio de correo a Thesaurus (README, «Facturas por correo»).'],
    telegram: ['Chat de Telegram', 'Tus proveedores abren este enlace y te envían la factura por chat.', 'Todavía no recibe facturas.'], copy: 'Copiar enlace', copied: 'Copiado', refused: 'No pude copiarlo; mantén presionado el enlace.' },
  en: { title: 'Channels', lead: 'Your vendors send you invoices here, and Thesaurus decides each one as it arrives.', active: 'Active', pending: 'Waiting for a domain', off: 'Not connected',
    portal: ['Vendor portal', 'Share this link with your vendors.'], email: ['Email', 'Your vendors write to this address with the invoice attached.', 'Ask your technical team to connect an email domain to Thesaurus (README, "Facturas por correo").'],
    telegram: ['Telegram chat', 'Your vendors open this link and send you the invoice by chat.', "It doesn't receive invoices yet."], copy: 'Copy link', copied: 'Copied', refused: "Couldn't copy it; press and hold the link." },
} as const;

for (const lang of ['es', 'en'] as const) {
  const w = WORDS[lang];
  test(`${lang}: the card has its h2, its lead, data-block and three rows in order portal, email, telegram`, () => {
    const card = show(OFF, lang);
    expect(within(card).getByRole('heading', { level: 2, name: w.title })).toBeTruthy();
    expect(within(card).getByText(w.lead)).toBeTruthy();
    expect(card.hasAttribute('data-block')).toBe(true);
    expect([...card.querySelectorAll('[data-channel]')].map((r) => r.getAttribute('data-channel'))).toEqual(['portal', 'email', 'telegram']);
  });

  test(`${lang}: Portal is always Activo with its line, its URL and a secondary copy button`, () => {
    const r = row(show(OFF, lang), 'portal');
    expect(within(r).getByRole('heading', { level: 3, name: w.portal[0] })).toBeTruthy();
    expect(within(r).getByText(w.active)).toBeTruthy();
    expect(within(r).getByText(w.portal[1])).toBeTruthy();
    expect(within(r).getByText(PORTAL)).toBeTruthy();
    const b = within(r).getByRole('button', { name: w.copy });
    expect(b.classList.contains('primary')).toBe(false);
  });

  test(`${lang}: Correo live shows Activo, the address as text and its line`, () => {
    const r = row(show(ALL, lang), 'email');
    expect(within(r).getByRole('heading', { level: 3, name: w.email[0] })).toBeTruthy();
    expect(within(r).getByText(w.active)).toBeTruthy();
    expect(within(r).getByText(EMAIL)).toBeTruthy();
    expect(within(r).getByText(w.email[1])).toBeTruthy();
    expect(within(r).queryByText(w.email[2])).toBeNull();
  });

  test(`${lang}: Correo pending shows the word and the line, and no address even when the Worker sent one`, () => {
    const card = show({ ...OFF, email_address: EMAIL }, lang);
    const r = row(card, 'email');
    expect(within(r).getByText(w.pending)).toBeTruthy();
    expect(within(r).getByText(w.email[2])).toBeTruthy();
    expect(within(r).queryByText(w.email[1])).toBeNull();
    expect(card.textContent).not.toContain(EMAIL);
    expect(card.textContent).not.toContain('facturas+');
  });

  test(`${lang}: Telegram active shows Activo, its line, the start link and a copy button`, () => {
    const r = row(show(ALL, lang), 'telegram');
    expect(within(r).getByRole('heading', { level: 3, name: w.telegram[0] })).toBeTruthy();
    expect(within(r).getByText(w.active)).toBeTruthy();
    expect(within(r).getByText(w.telegram[1])).toBeTruthy();
    expect(within(r).getByText(TG)).toBeTruthy();
    expect(within(r).getByRole('button', { name: w.copy })).toBeTruthy();
    expect(within(r).queryByText(w.telegram[2])).toBeNull();
  });

  test(`${lang}: Telegram off shows the word and the line, no link and no button`, () => {
    const r = row(show(OFF, lang), 'telegram');
    expect(within(r).getByText(w.off)).toBeTruthy();
    expect(within(r).getByText(w.telegram[2])).toBeTruthy();
    expect(within(r).queryByRole('button')).toBeNull();
    expect(r.textContent).not.toContain('t.me');
  });

  test(`${lang}: every chip carries its word as text`, () => {
    const card = show(OFF, lang);
    expect(['portal', 'email', 'telegram'].map((id) => row(card, id).querySelector('.channel-chip')!.textContent)).toEqual([w.active, w.pending, w.off]);
  });

  test(`${lang}: «${w.copy}» copies the URL, says «${w.copied}» for 2 s in an aria-live region (R-102)`, async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const r = row(show(OFF, lang), 'portal');
    fireEvent.click(within(r).getByRole('button', { name: w.copy }));
    expect(await within(r).findByRole('button', { name: w.copied })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(PORTAL);
    expect(r.querySelector('[aria-live="polite"]')!.textContent).toBe(w.copied);
    expect(await within(r).findByRole('button', { name: w.copy }, { timeout: 3000 })).toBeTruthy();
  });

  test(`${lang}: a refused clipboard shows the press-and-hold text`, async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => { throw new Error('denied'); } } });
    const r = row(show(OFF, lang), 'portal');
    fireEvent.click(within(r).getByRole('button', { name: w.copy }));
    expect(await within(r).findByText(w.refused)).toBeTruthy();
  });
}

test('with no clipboard API the copy counts as refused', async () => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
  const r = row(show(OFF), 'portal');
  fireEvent.click(within(r).getByRole('button', { name: 'Copiar enlace' }));
  expect(await within(r).findByText(WORDS.es.refused)).toBeTruthy();
});

test('each row copies its own link and keeps its own state', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const card = show(ALL);
  fireEvent.click(within(row(card, 'telegram')).getByRole('button', { name: 'Copiar enlace' }));
  expect(await within(row(card, 'telegram')).findByRole('button', { name: 'Copiado' })).toBeTruthy();
  expect(writeText).toHaveBeenCalledWith(TG);
  expect(within(row(card, 'portal')).getByRole('button', { name: 'Copiar enlace' })).toBeTruthy();
});

test('email_live without an address is not Activo (nothing to show)', () => {
  const r = row(show({ ...OFF, email_live: true }), 'email');
  expect(within(r).getByText(WORDS.es.pending)).toBeTruthy();
});

test('an empty telegram_url is Sin conectar', () => {
  expect(within(row(show({ ...OFF, telegram_url: '' }), 'telegram')).getByText(WORDS.es.off)).toBeTruthy();
});

test('a failed load shows the vendor-link error sentence and no card', () => {
  localStorage.setItem('lang', 'es');
  renderAt(<ChannelsCard link="error" />);
  expect(screen.getByText('No pude cargar tu enlace para proveedores. Recarga la página para intentar de nuevo.')).toBeTruthy();
  expect(screen.queryByRole('region')).toBeNull();
});

test('the card holds no primary button and no developer words', () => {
  const card = show(ALL);
  expect(card.querySelector('.primary')).toBeNull();
  expect(card.textContent).not.toMatch(/undefined|null|channels\./);
});
