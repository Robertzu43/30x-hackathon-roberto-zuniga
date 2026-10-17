/**
 * The trial door (AC-92, AC-94; R-119, R-120).
 *   isTrial(user)              an unsaved trial: an anonymous session, which lives only in this browser
 *   guardLeave(user, leave, warn)  the one guard every action that ends the session calls (UI: useLeaveGuard)
 *   startTrial(lang, onProgress)   anonymous sign-in (the signup trigger seeds «Empresa de prueba <n>"), then the first-login pass
 *   enterDemo()                    «Entrar como Andina Labs» (AC-46)
 *   useTrialCompany()              the trial's company name, null until loaded or when not a trial
 */
import type { User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import type { Lang } from '../src/i18n';
import { api, config, supabase } from './api';
import { DEMO_TOUR, useSession } from './auth';
import { runUntilDone, type Progress } from './runAgent';

const DEMO_PASSWORD = 'andina-demo-2026'; // public by design (D8, AC-46), same as src/routes/demo.ts

export const isTrial = (user: User | null | undefined): boolean => user?.is_anonymous === true;

export const guardLeave = (user: User | null | undefined, leave: () => void, warn: (leave: () => void) => void): void =>
  isTrial(user) ? warn(leave) : leave();

/** False when the sign-in fails (AC-96's rate limit, network, Auth down); the run itself never blocks (AC-40). */
export async function startTrial(lang: Lang, onProgress: (p: Progress) => void): Promise<boolean> {
  const { error } = await supabase()
    .then((sb) => sb.auth.signInAnonymously({ options: { data: { lang } } })) // AC-41: the page's language, stored on the user
    .catch((e: Error) => ({ error: e }));
  if (error) return false;
  await runUntilDone({ first: '/api/invoices/run', onProgress });
  return true;
}

export async function enterDemo(): Promise<boolean> {
  sessionStorage.setItem(DEMO_TOUR, '1'); // before signing in: the sign-in event may reach the app first (R-62)
  const { error } = await Promise.all([supabase(), config()])
    .then(([sb, c]) => sb.auth.signInWithPassword({ email: c.demo_email, password: DEMO_PASSWORD }))
    .catch((e: Error) => ({ error: e }));
  if (error) sessionStorage.removeItem(DEMO_TOUR);
  return !error;
}

export function useTrialCompany(): string | null {
  const user = useSession().session?.user;
  const trial = isTrial(user);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (trial) void api.get<{ name: string }>('/api/company').then((c) => setName(c.name), () => undefined); // the fallback text stands
  }, [user?.id, trial]);
  return trial ? name : null;
}
