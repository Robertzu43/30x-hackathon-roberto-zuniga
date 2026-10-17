// The only mail path (CLAUDE.md): SES v2 SendEmail signed with SigV4. Never throws; the caller records the result (R-29).
// SES is in sandbox (R-19): mail reaches verified addresses only, anything else comes back { sent: false }.
import { AwsClient } from 'aws4fetch';
import { validFields } from '../engine/checks';
import { explainCheck, headline, money } from '../engine/explain';
import type { Decision, Invoice } from '../engine/types';
import type { Env } from '../env';
import { t } from '../i18n';

export interface EmailMessage { to: string; subject: string; text: string; html: string }

export async function sendEmail(env: Env, msg: EmailMessage): Promise<{ sent: boolean; id?: string }> {
  // Logs carry recipient and subject only: the body holds approval links.
  const log = (why: string) => console.log(`email not sent (${why})`, { to: msg.to, subject: msg.subject });
  const { AWS_SES_ACCESS_KEY_ID: accessKeyId, AWS_SES_SECRET_ACCESS_KEY: secretAccessKey, SES_REGION: region, SES_FROM_EMAIL: from } = env;
  if (!accessKeyId || !secretAccessKey || !region || !from) return log('SES not configured'), { sent: false };
  try {
    const aws = new AwsClient({ accessKeyId, secretAccessKey, region, service: 'ses', retries: 0 });
    const data = (Data: string) => ({ Data, Charset: 'UTF-8' });
    const res = await aws.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        FromEmailAddress: from,
        Destination: { ToAddresses: [msg.to] },
        Content: { Simple: { Subject: data(msg.subject), Body: { Text: data(msg.text), Html: data(msg.html) } } },
      }),
    });
    if (!res.ok) return log(`SES ${res.status}`), { sent: false };
    const { MessageId } = (await res.json()) as { MessageId?: string };
    return { sent: true, id: MessageId };
  } catch (e) {
    return log(e instanceof Error ? e.message : 'SES error'), { sent: false };
  }
}

const ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITY[c] ?? c);
const longDate = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(x.getTime()) ? d : new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'UTC' }).format(x);
};

// The escalation email (AC-39, R-28): Spanish only; subject and first line are the stored question_es. Every value is
// HTML-escaped: invoice fields come from a model reading arbitrary documents.
export function escalationEmail(a: { lang: 'es'; question: string; invoice: Invoice; decision: Pick<Decision, 'outcome' | 'checks'>; approveUrl: string; rejectUrl: string }): Omit<EmailMessage, 'to'> {
  const { lang, invoice: inv, decision } = a;
  const f = validFields(inv.fields); // R-71: an untrusted value reads desconocido
  const unknown = t(lang, 'value.unknown');
  const shown = {
    payee_name: f.payee_name, amount: f.amount === null ? null : `${money(f.amount, lang)} ${f.currency ?? ''}`.trim(), invoice_number: f.invoice_number,
    concept: f.concept, issue_date: f.issue_date && longDate(f.issue_date), due_date: f.due_date && longDate(f.due_date),
  };
  const read = Object.entries(shown).map(([k, v]) => `${t(lang, `email.field.${k}`)}: ${v || unknown}`);
  const rules = decision.checks.filter((c) => c.verdict !== 'cumple' && !c.overridden).map((c) => explainCheck(c, lang, inv.received_at));
  const head = headline(decision, inv, null, lang);
  const [approve, reject] = [t(lang, 'email.approve'), t(lang, 'email.reject')];
  const text = [a.question, '', head, '', t(lang, 'email.read'), ...read, '', t(lang, 'email.rules'), ...rules.map((r) => `- ${r}`), '',
    `${approve}: ${a.approveUrl}`, `${reject}: ${a.rejectUrl}`].join('\n');
  const p = (s: string, style = 'margin:0 0 12px') => `<p style="${style}">${esc(s)}</p>`;
  const button = (label: string, url: string, style: string) =>
    `<a href="${esc(url)}" style="display:inline-block;padding:10px 20px;margin-right:8px;border-radius:6px;text-decoration:none;${style}">${esc(label)}</a>`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:32px;background:#FBFBFA;color:#2F3437;font:15px/1.6 'Helvetica Neue',Helvetica,Arial,sans-serif">`
    + p(a.question, 'margin:0 0 12px;font-size:17px;color:#111111')
    + p(head, 'margin:0 0 12px;color:#787774')
    + `<h2 style="font-size:13px;margin:24px 0 8px;color:#787774;text-transform:uppercase;letter-spacing:0.05em">${esc(t(lang, 'email.read'))}</h2>`
    + read.map((r) => p(r, 'margin:0')).join('')
    + `<h2 style="font-size:13px;margin:24px 0 8px;color:#787774;text-transform:uppercase;letter-spacing:0.05em">${esc(t(lang, 'email.rules'))}</h2>`
    + `<ul style="margin:0 0 24px;padding-left:20px">${rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
    + button(approve, a.approveUrl, 'background:#111111;color:#FFFFFF')
    + button(reject, a.rejectUrl, 'background:#FFFFFF;color:#111111;border:1px solid #EAEAEA')
    + '</body></html>';
  return { subject: a.question, text, html };
}
