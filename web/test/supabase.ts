// In-memory stand-in for supabase-js `auth`, wired in by web/test/setup.ts for every web test.
import type { Session } from '@supabase/supabase-js';
import { vi } from 'vitest';

type Listener = (event: string, session: Session | null) => void;
const listeners = new Set<Listener>();
let current: Session | null = null;
const emit = (event: string) => listeners.forEach((l) => l(event, current));

export const fakeSession = (email: string, meta: Record<string, unknown> = {}): Session =>
  ({ access_token: `jwt:${email}`, user: { id: `id:${email}`, email, user_metadata: meta } }) as unknown as Session;

/** Start the next render already signed in (call before render). */
export const signedInAs = (email: string, meta: Record<string, unknown> = {}) => {
  current = fakeSession(email, meta);
};
export const currentSession = () => current;

const signIn = async ({ email }: { email: string }) => {
  current = fakeSession(email);
  emit('SIGNED_IN');
  return { data: { session: current, user: current.user }, error: null };
};

export const fakeAuth = {
  onAuthStateChange: vi.fn((cb: Listener) => {
    listeners.add(cb);
    queueMicrotask(() => cb('INITIAL_SESSION', current)); // supabase-js v2 emits the stored session on subscribe
    return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
  }),
  getSession: vi.fn(async () => ({ data: { session: current }, error: null })),
  signInWithOtp: vi.fn<(a: { email: string; options?: unknown }) => Promise<{ data: unknown; error: Error | null }>>(async () => ({ data: {}, error: null })),
  verifyOtp: vi.fn(signIn as (a: { email: string; token: string; type: string }) => Promise<{ data: unknown; error: Error | null }>),
  signInWithPassword: vi.fn(signIn as (a: { email: string; password: string }) => Promise<{ data: unknown; error: Error | null }>),
  updateUser: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    if (!current) return { data: { user: null }, error: new Error('no session') };
    current = { ...current, user: { ...current.user, user_metadata: { ...current.user.user_metadata, ...data } } };
    emit('USER_UPDATED');
    return { data: { user: current.user }, error: null };
  }),
  signOut: vi.fn(async () => {
    current = null;
    emit('SIGNED_OUT');
    return { error: null };
  }),
};

export const resetFakeAuth = () => {
  current = null;
  listeners.clear();
  Object.values(fakeAuth).forEach((f) => f.mockClear());
};
