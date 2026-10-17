/**
 * The first-login pass, owned by the app shell (AC-107, AC-40 and AC-92 Amended, R-143). The entry sets a tab flag and navigates;
 * the provider runs the same budgeted loop (AC-70) once the user is signed in, so moving between screens neither stops nor
 * restarts it, and a reload in this tab resumes it while the flag is set. The pass only decides pending invoices (R-25).
 *
 *   markFirstRun()        the entry, right after the sign-in call
 *   <FirstRunProvider>    mounted once in App
 *   useFirstRun()         { running, progress, result, start, batches }: `batches` bumps after each answered call
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from './auth';
import { useRunAgent, type RunAgent } from './components/RunProgress';

export const FIRST_RUN = 'first-run';
export const markFirstRun = () => sessionStorage.setItem(FIRST_RUN, '1');

export type FirstRun = RunAgent & { batches: number };
const Ctx = createContext<FirstRun>({ start: async () => undefined, running: false, progress: null, result: null, batches: 0 });
export const useFirstRun = (): FirstRun => useContext(Ctx);

export function FirstRunProvider({ children }: { children: ReactNode }) {
  const signedIn = !!useSession().session;
  const { pathname } = useLocation(); // the entry sets the flag, then navigates: the move re-checks it
  const [batches, setBatches] = useState(0);
  const run = useRunAgent({ first: '/api/invoices/run', onBatch: () => setBatches((n) => n + 1) });
  useEffect(() => {
    if (!signedIn || sessionStorage.getItem(FIRST_RUN) === null) return;
    void run.start().then((r) => r && sessionStorage.removeItem(FIRST_RUN)); // undefined: a loop already runs (one per tab)
  }, [signedIn, pathname]);
  return <Ctx.Provider value={{ ...run, batches }}>{children}</Ctx.Provider>;
}
