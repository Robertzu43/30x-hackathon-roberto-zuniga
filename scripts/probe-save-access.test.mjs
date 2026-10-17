// The AC-95 / R-118 probe against a fake Supabase client: never the real Auth (R-94).
import { describe, expect, it } from 'vitest';
import { probe } from './probe-save-access.mjs';

// A fake anon client: signInAnonymously, updateUser({ email, password }), then getUser answers `after(email)`.
function fakeAnon(after, { signInError = null, updateError = null } = {}) {
  const calls = [];
  let email;
  return {
    calls,
    auth: {
      signInAnonymously: async () => (calls.push(['signInAnonymously']), { data: { user: { id: 'u-anon', is_anonymous: true } }, error: signInError }),
      updateUser: async (attrs) => (calls.push(['updateUser', attrs]), (email = attrs.email), { data: { user: { id: 'u-anon' } }, error: updateError }),
      getUser: async () => (calls.push(['getUser']), { data: { user: { id: 'u-anon', ...after(email) } }, error: null }),
    },
  };
}
const run = async (anon) => {
  const lines = [];
  const ok = await probe({ anon, random: () => 'abc123', log: (l) => lines.push(l) });
  return { ok, out: lines.join('\n') };
};

describe('probe-save-access (AC-95, R-118)', () => {
  it('signs in anonymously once, attaches qa-probe-<random>@example.com and a password, and passes when confirmed at once', async () => {
    const anon = fakeAnon((email) => ({ email, email_confirmed_at: '2026-10-17T18:00:00Z', is_anonymous: false }));
    const { ok, out } = await run(anon);
    expect(ok).toBe(true);
    expect(anon.calls.map((c) => c[0])).toEqual(['signInAnonymously', 'updateUser', 'getUser']);
    expect(anon.calls[1][1].email).toBe('qa-probe-abc123@example.com');
    expect(anon.calls[1][1].password.length).toBeGreaterThanOrEqual(8);
    expect(out).toContain('email_confirmed_at 2026-10-17T18:00:00Z');
    expect(out).toContain('is_anonymous false');
    expect(out).toMatch(/PASS/);
    expect(out).not.toContain(anon.calls[1][1].password);
  });

  it('a pending email change (no confirmation yet) reports FALLBACK: R-118 applies', async () => {
    const anon = fakeAnon((email) => ({ email: '', new_email: email, email_confirmed_at: null, is_anonymous: true }));
    const { ok, out } = await run(anon);
    expect(ok).toBe(false);
    expect(out).toContain('email_confirmed_at null');
    expect(out).toContain('is_anonymous true');
    expect(out).toMatch(/FALLBACK.*R-118/);
  });

  it('a refused sign-in or update throws with the step named, and never prints the password', async () => {
    await expect(run(fakeAnon(() => ({}), { signInError: { message: 'Anonymous sign-ins are disabled' } }))).rejects.toThrow('signInAnonymously: Anonymous sign-ins are disabled');
    const anon = fakeAnon(() => ({}), { updateError: { message: 'Email rate limit exceeded' } });
    await expect(run(anon)).rejects.toThrow('updateUser: Email rate limit exceeded');
    await expect(run(anon)).rejects.not.toThrow(anon.calls[1][1].password);
  });
});
