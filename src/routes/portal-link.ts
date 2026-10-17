// "Comparte este enlace con tus proveedores" (AC-86): the member's company portal URL, read with the user's JWT (AC-38).
// email_address is the email intake address (AC-87) when INBOUND_EMAIL_DOMAIN is set, otherwise null.
import { must } from '../lib/supabase';
import { memberRoutes } from './agent';

export const portalLink = memberRoutes().get('/', async (c) => {
  const { portal_slug }: { portal_slug: string } = must(await c.var.db.from('companies').select('portal_slug').eq('id', c.var.companyId).single());
  return c.json({ portal_url: `${c.env.PORTAL_URL}/${portal_slug}`, email_address: c.env.INBOUND_EMAIL_DOMAIN ? `facturas+${portal_slug}@${c.env.INBOUND_EMAIL_DOMAIN}` : null });
});
