import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { config, supabase } from './api';
import { useT } from './i18n';

type Auth = { session: Session | null; ready: boolean; demoEmail: string };
const AuthCtx = createContext<Auth>({ session: null, ready: false, demoEmail: '' });

export const useSession = (): Auth => useContext(AuthCtx);

export const isDemoUser = (user: User | undefined, demoEmail: string): boolean =>
  !!user?.email && !!demoEmail && user.email.toLowerCase() === demoEmail.toLowerCase();

/** AC-42: first login (tour not seen yet), and every time for the shared demo user (R-17). */
export const shouldStartTour = (user: User, demoEmail: string): boolean =>
  isDemoUser(user, demoEmail) || user.user_metadata?.tour_seen !== true;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<Auth>({ session: null, ready: false, demoEmail: '' });
  const { setLang } = useT();

  useEffect(() => {
    let live = true;
    let unsubscribe = () => {};
    Promise.all([supabase(), config()])
      .then(([sb, c]) => {
        if (!live) return;
        const { data } = sb.auth.onAuthStateChange((_event, session) => setAuth({ session, ready: true, demoEmail: c.demo_email }));
        unsubscribe = () => data.subscription.unsubscribe();
      })
      // No config (API down): treat as signed out; Login reports the error when the user submits.
      .catch(() => live && setAuth((a) => ({ ...a, ready: true })));
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  // AC-41, once per signed-in user: a choice made in this browser is stored on the user; otherwise the user's stored choice applies.
  const user = auth.session?.user;
  useEffect(() => {
    if (!user) return;
    const picked = localStorage.getItem('lang');
    const stored: unknown = user.user_metadata?.lang;
    if (picked === 'es' || picked === 'en') {
      if (picked !== stored) void supabase().then((sb) => sb.auth.updateUser({ data: { lang: picked } }));
    } else if (stored === 'es' || stored === 'en') setLang(stored);
  }, [user?.id]); // keyed on the id: USER_UPDATED (tour_seen, lang) must not re-run it

  return <AuthCtx.Provider value={auth}>{children}</AuthCtx.Provider>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, ready } = useSession();
  if (!ready) return null;
  return session ? children : <Navigate to="/login" replace />;
}
