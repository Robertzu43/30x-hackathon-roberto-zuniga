import { describe, expect, it } from 'vitest';
import { TOKEN_TTL_MS, hashToken, signToken, verifyToken, type TokenPayload } from './tokens';

const SECRET = 'test-secret-not-real';
const NOW = Date.parse('2026-10-17T15:00:00Z');
const P: TokenPayload = { invoice_id: 'inv-1', decision_id: 'dec-1', action: 'approve', exp: NOW + TOKEN_TTL_MS };

describe('approval tokens (AC-36)', () => {
  it('TTL is 48 hours', () => expect(TOKEN_TTL_MS).toBe(48 * 3600 * 1000));
  it('round trip returns the payload', async () => {
    expect(await verifyToken(SECRET, await signToken(SECRET, P), NOW)).toEqual(P);
  });
  it('token is url-safe: base64url payload and signature', async () => {
    expect(await signToken(SECRET, P)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
  it('a tampered payload verifies as null', async () => {
    const [, sig] = (await signToken(SECRET, P)).split('.');
    const forged = btoa(JSON.stringify({ ...P, action: 'reject' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifyToken(SECRET, `${forged}.${sig}`, NOW)).toBeNull();
  });
  it('a tampered signature verifies as null', async () => {
    const tok = await signToken(SECRET, P);
    const last = tok.at(-1) === 'A' ? 'B' : 'A';
    expect(await verifyToken(SECRET, tok.slice(0, -1) + last, NOW)).toBeNull();
  });
  it('another secret verifies as null', async () => {
    expect(await verifyToken('other-secret', await signToken(SECRET, P), NOW)).toBeNull();
  });
  it('an expired token verifies as null (exp in ms epoch)', async () => {
    const tok = await signToken(SECRET, P);
    expect(await verifyToken(SECRET, tok, P.exp - 1)).toEqual(P);
    expect(await verifyToken(SECRET, tok, P.exp)).toBeNull();
  });
  it('garbage and empty secrets verify as null, never throw', async () => {
    for (const t of ['', 'abc', 'a.b.c', '!!!.###', `${btoa('not json')}.x`]) expect(await verifyToken(SECRET, t, NOW)).toBeNull();
    expect(await verifyToken('', await signToken(SECRET, P), NOW)).toBeNull();
  });
  it('refuses to sign without a secret', async () => {
    await expect(signToken('', P)).rejects.toThrow('APPROVAL_HMAC_SECRET');
  });
  it('hashToken is the sha256 hex of the token, never the token', async () => {
    expect(await hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
