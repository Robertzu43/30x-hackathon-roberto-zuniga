// The vendor portal's only door into the main Worker (AC-85 item 1, R-90.1): RPC methods called by the `facturas` Worker
// over its service binding MAIN, never a public HTTP route. The client IP comes from that binding, which is not public.
// Each call gets its own subrequest budget, which counts the binding call itself (R-56). Errors reach the caller, which
// shows the vendor a friendly message.
import { WorkerEntrypoint } from 'cloudflare:workers';
import { intake, portalCompany, portalStatus, type IntakeInput } from './agent/intake';
import type { Env } from './env';
import { Budget } from './lib/supabase';

const budget = () => { const b = new Budget(); b.count(); return b; };

export class PortalApi extends WorkerEntrypoint<Env> {
  company(slug: string) { return portalCompany(this.env, budget(), slug); }
  intake(input: IntakeInput) { return intake(this.env, budget(), input); }
  status(token: string, ip: string) { return portalStatus(this.env, budget(), token, ip); }
}
