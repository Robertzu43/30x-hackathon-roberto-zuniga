// Signed approval links (AC-36, R-03): `<base64url payload>.<base64url HMAC-SHA256>`. Only hashToken() is ever stored.
export interface TokenPayload { invoice_id: string; decision_id: string; action: 'approve' | 'reject'; exp: number } // exp: ms epoch

export const TOKEN_TTL_MS = 48 * 3600 * 1000;

const enc = new TextEncoder();
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const key = (secret: string) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function signToken(secret: string, payload: TokenPayload): Promise<string> {
  if (!secret) throw new Error('APPROVAL_HMAC_SECRET is not set');
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body))))}`;
}

// null for a bad signature, an expired or malformed token, or a missing secret. subtle.verify compares in constant time.
export async function verifyToken(secret: string, token: string, now = Date.now()): Promise<TokenPayload | null> {
  try {
    const [body, sig, extra] = token.split('.');
    if (!secret || !body || !sig || extra !== undefined) return null;
    if (!(await crypto.subtle.verify('HMAC', await key(secret), unb64url(sig), enc.encode(body)))) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64url(body))) as TokenPayload;
    return typeof p.exp === 'number' && now < p.exp ? p : null;
  } catch {
    return null;
  }
}

export async function hashToken(token: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(token)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
