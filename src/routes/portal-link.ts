// "Comparte este enlace con tus proveedores" (AC-86): the member's company portal URL, read with the user's JWT (AC-38).
// email_address stays null until email intake (Task 30, AC-87) fills it from INBOUND_EMAIL_DOMAIN.
import { must } from '../lib/supabase';
import { memberRoutes } from './agent';

export const portalLink = memberRoutes().get('/', async (c) => {
  const { portal_slug }: { portal_slug: string } = must(await c.var.db.from('companies').select('portal_slug').eq('id', c.var.companyId).single());
  return c.json({ portal_url: `${c.env.PORTAL_URL}/${portal_slug}`, email_address: null });
});
