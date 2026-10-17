// Email intake (D35, AC-87, R-91): the main Worker's email handler. The company comes from the recipient
// (facturas+<slug>@ or <slug>@ INBOUND_EMAIL_DOMAIN); each PDF, PNG or JPEG attachment (at most 3), or else the body,
// becomes an invoice through intake.ts, decided by runAgent like the portal. One templated reply goes to the sender,
// except to automatic mail, a bad From or our own domain (loop guard), and never over a limit (no backscatter).
import PostalMime from 'postal-mime';
import { intake, portalCompany, type IntakeResult } from '../agent/intake';
import type { Env } from '../env';
import { sendEmail } from '../lib/email';
import { Budget } from '../lib/supabase';
import { vendorReply, type ReplyInvoice } from './reply';

const MAX_FILES = 3;
const ADDRESS = /^[^\s@<>()",;:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function slugOf(rcpt: string, domain: string | undefined): string | null {
  const [, local, host] = /^(.+)@([^@]+)$/.exec(rcpt.trim().toLowerCase()) ?? [];
  if (!domain || !local || host !== domain.toLowerCase()) return null;
  return local.startsWith('facturas+') ? local.slice('facturas+'.length) : local.includes('+') ? null : local;
}

// ponytail: tags stripped, entities left as typed; the reader reads «&eacute;» fine.
const stripTags = (html: string) =>
  html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

export async function inbound(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const budget = new Budget(); // one per message: every read, write and the agent run count on it (R-56)
  const slug = slugOf(message.to, env.INBOUND_EMAIL_DOMAIN);
  const company = slug && (await portalCompany(env, budget, slug));
  if (!slug || !company) return message.setReject('Dirección desconocida');

  const mail = await PostalMime.parse(message.raw, { attachmentEncoding: 'arraybuffer' });
  const header = (k: string) => mail.headers.find((h) => h.key === k)?.value.trim().toLowerCase() ?? '';
  const from = mail.from?.address?.trim().toLowerCase() ?? '';
  const sender = ADDRESS.test(from) ? from : null;
  const replyTo = sender && !sender.endsWith(`@${env.INBOUND_EMAIL_DOMAIN!.toLowerCase()}`)
    && ['', 'no'].includes(header('auto-submitted')) && !['bulk', 'list', 'junk'].includes(header('precedence')) ? sender : null;

  // The sender's hourly limit counts once per email, on its first invoice; the company limit counts every invoice.
  let key: string | null = `email:${sender ?? message.from.toLowerCase()}`;
  const made: ReplyInvoice[] = [];
  const ignored: string[] = [];
  const take = async (r: IntakeResult): Promise<'ok' | 'skip' | 'stop'> => {
    if (r.ok) { made.push({ reply: r.reply, status_url: `${env.PORTAL_URL}${r.status_path}` }); key = null; return 'ok'; }
    if (r.error === 'file' || r.error === 'text') return 'skip';
    console.log('email: not stored', r.error, { slug }); // over a limit: nothing stored, nothing sent
    return 'stop';
  };
  // Images embedded in an HTML body (a signature logo) are part of the body, not attachments.
  for (const a of mail.attachments.filter((x) => !x.related)) {
    const name = a.filename ?? a.mimeType;
    if (made.length === MAX_FILES || !(a.content instanceof ArrayBuffer)) { ignored.push(name); continue; }
    const r = await take(await intake(env, budget, { slug, file: { bytes: a.content }, ip: key }, { sender }));
    if (r === 'stop') return;
    if (r === 'skip') ignored.push(name);
  }
  if (!made.length) {
    const text = mail.text?.trim() ? mail.text : stripTags(mail.html ?? '');
    if ((await take(await intake(env, budget, { slug, text, ip: key }, { sender }))) === 'stop') return;
  }
  if (!made.length || !replyTo) return;
  await sendEmail(env, { to: replyTo, ...vendorReply(env, company.name, made, ignored) });
}
