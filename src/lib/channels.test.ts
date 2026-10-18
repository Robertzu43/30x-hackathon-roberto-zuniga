import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { channelOf, emailLive, type Fetch } from './channels';

describe('channelOf (AC-125, R-193): one row of the table each', () => {
  it('portal, no telegram_from: portal', () => expect(channelOf({ origin: 'portal' })).toEqual({ kind: 'portal', from: null }));
  it('email with a sender: email from the sender', () => expect(channelOf({ origin: 'email', sender: 'ana@proveedor.co' })).toEqual({ kind: 'email', from: 'ana@proveedor.co' }));
  it('email without a sender: email, no from', () => {
    expect(channelOf({ origin: 'email', sender: null })).toEqual({ kind: 'email', from: null });
    expect(channelOf({ origin: 'email', sender: '' })).toEqual({ kind: 'email', from: null });
  });
  it('portal with telegram_from: telegram from that name', () => expect(channelOf({ origin: 'portal', telegram_from: '@laura' })).toEqual({ kind: 'telegram', from: '@laura' }));
  it('app, not seeded: upload', () => expect(channelOf({ origin: 'app', seeded: false })).toEqual({ kind: 'upload', from: null }));
  it('app with no seeded flag: upload', () => expect(channelOf({ origin: 'app' })).toEqual({ kind: 'upload', from: null }));
  it('app, seeded (expected_outcome set): sample', () => expect(channelOf({ origin: 'app', seeded: true })).toEqual({ kind: 'sample', from: null }));
  it('telegram_from only counts on a portal invoice', () => {
    expect(channelOf({ origin: 'email', sender: 'a@b.co', telegram_from: '@x' }).kind).toBe('email');
    expect(channelOf({ origin: 'app', telegram_from: '@x' }).kind).toBe('upload');
  });
});

describe('emailLive (R-190, AC-123)', () => {
  const MX = (...hosts: string[]) => ({ Status: 0, Answer: hosts.map((h, i) => ({ name: 'x.', type: 15, TTL: 300, data: `${10 + i} ${h}` })) });
  const reply = (body: unknown, status = 200) => vi.fn<Fetch>(async () => new Response(JSON.stringify(body), { status }));
  let n = 0;
  const domain = () => `d${++n}.example.co`; // the cache is per domain: each test owns one

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-10-18T10:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('an empty or missing domain is false and never fetches', async () => {
    const f = reply(MX('route1.mx.cloudflare.net.'));
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: '' }, f)).toBe(false);
    expect(await emailLive({}, f)).toBe(false);
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: '  ' }, f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('asks cloudflare-dns.com for the MX of the domain, as dns-json', async () => {
    const d = domain();
    const f = reply(MX('route1.mx.cloudflare.net.'));
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: d }, f)).toBe(true);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(`https://cloudflare-dns.com/dns-query?name=${d}&type=MX`);
    expect(new Headers(init?.headers).get('accept')).toBe('application/dns-json');
  });

  it('any host ending in .mx.cloudflare.net. among the answers is true', async () => {
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: domain() }, reply(MX('mail.other.co.', 'route3.mx.cloudflare.net.')))).toBe(true);
  });

  it('another host is false', async () => {
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: domain() }, reply(MX('aspmx.l.google.com.')))).toBe(false);
  });

  it('a host that only looks like cloudflare is false', async () => {
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: domain() }, reply(MX('mx.cloudflare.net.evil.co.', 'evilmx.cloudflare.net.')))).toBe(false);
  });

  it('NXDOMAIN (Status 3, no Answer) is false', async () => {
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: domain() }, reply({ Status: 3 }))).toBe(false);
  });

  it('a non-MX answer record is ignored', async () => {
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: domain() }, reply({ Status: 0, Answer: [{ type: 16, data: '"route1.mx.cloudflare.net."' }] }))).toBe(false);
  });

  it('DoH answering 500 is false', async () => {
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: domain() }, reply(MX('route1.mx.cloudflare.net.'), 500))).toBe(false);
  });

  it('a body that is not JSON is false', async () => {
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: domain() }, vi.fn<Fetch>(async () => new Response('<html>', { status: 200 })))).toBe(false);
  });

  it('a fetch that throws is false', async () => {
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: domain() }, vi.fn<Fetch>(async () => { throw new Error('offline'); }))).toBe(false);
  });

  it('a fetch slower than 1500 ms is false, and the request is aborted', async () => {
    let signal: AbortSignal | undefined;
    const slow = vi.fn<Fetch>((_u, init) => new Promise<Response>(() => { signal = init?.signal ?? undefined; })); // never answers, ignores the abort
    const p = emailLive({ INBOUND_EMAIL_DOMAIN: domain() }, slow);
    await vi.advanceTimersByTimeAsync(1499);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe(false);
    expect(signal?.aborted).toBe(true);
  });

  it('true is cached for 10 minutes: no new request, then one', async () => {
    const d = domain();
    const f = reply(MX('route1.mx.cloudflare.net.'));
    await emailLive({ INBOUND_EMAIL_DOMAIN: d }, f);
    vi.advanceTimersByTime(10 * 60_000 - 1);
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: d }, f)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await emailLive({ INBOUND_EMAIL_DOMAIN: d }, f);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('false is cached for 1 minute only, so a fresh MX shows within a minute', async () => {
    const d = domain();
    const f = vi.fn<Fetch>(async () => new Response(JSON.stringify({ Status: 3 })));
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: d }, f)).toBe(false);
    vi.advanceTimersByTime(60_000 - 1);
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: d }, f)).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    f.mockImplementation(async () => new Response(JSON.stringify(MX('route1.mx.cloudflare.net.'))));
    vi.advanceTimersByTime(1);
    expect(await emailLive({ INBOUND_EMAIL_DOMAIN: d }, f)).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a failed check is cached for 1 minute too (no hammering a dead resolver)', async () => {
    const d = domain();
    const f = vi.fn<Fetch>(async () => { throw new Error('offline'); });
    await emailLive({ INBOUND_EMAIL_DOMAIN: d }, f);
    await emailLive({ INBOUND_EMAIL_DOMAIN: d }, f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('the cache is per domain', async () => {
    const f = reply(MX('route1.mx.cloudflare.net.'));
    await emailLive({ INBOUND_EMAIL_DOMAIN: domain() }, f);
    await emailLive({ INBOUND_EMAIL_DOMAIN: domain() }, f);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
