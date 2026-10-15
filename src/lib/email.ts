import type { Env } from '../app'

export async function sendEmail(
  env: Pick<Env, 'RESEND_API_KEY' | 'RESEND_FROM'>,
  { to, subject, html }: { to: string; subject: string; html: string },
): Promise<{ id: string }> {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY missing')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.RESEND_FROM, to: [to], subject, html }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
  return (await res.json()) as { id: string }
}
