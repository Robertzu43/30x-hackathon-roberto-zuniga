// Where an invoice came from (AC-125, R-193) and whether the company's email route is live (AC-123, R-190).
export type ChannelKind = 'portal' | 'email' | 'telegram' | 'upload' | 'sample';
export type Channel = { kind: ChannelKind; from: string | null };
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// `seeded` is expected_outcome != null: a seeded invoice never came through any channel, so it says it is a sample.
export function channelOf(i: { origin: 'app' | 'portal' | 'email'; sender?: string | null; telegram_from?: string | null; seeded?: boolean }): Channel {
  if (i.origin === 'email') return { kind: 'email', from: i.sender || null };
  if (i.origin === 'portal') return i.telegram_from ? { kind: 'telegram', from: i.telegram_from } : { kind: 'portal', from: null };
  return { kind: i.seeded ? 'sample' : 'upload', from: null };
}

// R-190: live only when the domain's MX includes a *.mx.cloudflare.net. host (where Email Routing receives mail).
// One DNS-over-HTTPS read, 1500 ms. Any failure is false. true is cached 10 min, false 1 min, per domain.
// ponytail: per-isolate cache, so each Worker instance asks DoH on its own; a KV cache if that ever shows in traffic.
const cache = new Map<string, { live: boolean; until: number }>();
const CF_MX = /\.mx\.cloudflare\.net\.?$/i;

export async function emailLive(env: { INBOUND_EMAIL_DOMAIN?: string }, fetchImpl: Fetch = fetch): Promise<boolean> {
  const domain = env.INBOUND_EMAIL_DOMAIN?.trim();
  if (!domain) return false;
  const hit = cache.get(domain);
  if (hit && hit.until > Date.now()) return hit.live;
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let live: boolean;
  try {
    const timeout = new Promise<never>((_, no) => { timer = setTimeout(() => { ctl.abort(); no(new Error('timeout')); }, 1500); });
    const check = (async () => {
      const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, { headers: { accept: 'application/dns-json' }, signal: ctl.signal });
      if (!r.ok) return false;
      const body = (await r.json()) as { Answer?: { type?: number; data?: string }[] };
      return (body.Answer ?? []).some((a) => a.type === 15 && typeof a.data === 'string' && CF_MX.test(a.data.trim().split(/\s+/).pop() ?? ''));
    })();
    live = await Promise.race([check, timeout]);
  } catch {
    live = false;
  } finally {
    clearTimeout(timer);
  }
  cache.set(domain, { live, until: Date.now() + (live ? 600_000 : 60_000) });
  return live;
}
