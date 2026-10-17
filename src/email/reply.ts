// The vendor's reply to an emailed invoice (AC-87, AC-80, R-91): one email, Spanish then English, with the logo, each
// invoice's recorded reply lines (AC-84 status words) and status link, and the attachments that were not read. Every
// value is HTML-escaped: file names and read fields come from the sender.
import type { Bilingual } from '../agent/intake';
import type { Env } from '../env';
import { format, type Lang } from '../i18n';
import { en, es } from '../i18n/features/email';
import { en as portalEn, es as portalEs } from '../i18n/features/portal';
import type { EmailMessage } from '../lib/email';

export interface ReplyInvoice { reply: Bilingual<string[]>; status_url: string }

const dict = { es: { ...portalEs, ...es }, en: { ...portalEn, ...en } };
const ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITY[c] ?? c); // as src/lib/email.ts

export function vendorReply(env: Env, company: string, invoices: ReplyInvoice[], ignored: string[]): Omit<EmailMessage, 'to'> {
  const say = (lang: Lang, key: string, vars: Record<string, string> = {}) => format(dict[lang], key, vars);
  // One block per language: per invoice its heading (when several), its lines and its link; then the ignored files.
  const block = (lang: Lang) => [
    ...invoices.flatMap((inv, n) => [
      ...(invoices.length > 1 ? [say(lang, 'email_in.invoice', { n: String(n + 1) })] : []),
      ...inv.reply[lang], say(lang, 'portal.reply.link'), inv.status_url, '',
    ]),
    ...(ignored.length ? [say(lang, 'email_in.ignored', { files: ignored.join(', ') })] : []),
  ];
  const langs: Lang[] = ['es', 'en'];
  const subject = langs.map((l) => say(l, 'email_in.subject', { company })).join(' · ');
  const text = langs.map((l) => block(l).join('\n').trim()).join('\n\n---\n\n');
  const line = (s: string) => /^https:\/\//.test(s)
    ? `<p style="margin:0 0 12px"><a href="${esc(s)}" style="color:#111111">${esc(s)}</a></p>` : s ? `<p style="margin:0 0 4px">${esc(s)}</p>` : '<br>';
  const html = '<!doctype html><html lang="es"><body style="margin:0;padding:32px;background:#FBFBFA;color:#2F3437;font:15px/1.6 \'Helvetica Neue\',Helvetica,Arial,sans-serif">'
    + `<img src="${esc(`${env.APP_URL ?? ''}/brand/thesaurus-logo.png`)}" alt="Thesaurus" width="160" style="display:block;margin:0 0 24px">`
    + langs.map((l) => `<div lang="${l}">${block(l).map(line).join('')}</div>`).join('<hr style="border:0;border-top:1px solid #EAEAEA;margin:24px 0">')
    + '</body></html>';
  return { subject, text, html };
}
