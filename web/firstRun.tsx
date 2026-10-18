/**
 * The first-login pass, owned by the app shell (AC-107, AC-40 and AC-92 Amended, R-143). The entry sets a tab flag and navigates;
 * the provider runs the same budgeted loop (AC-70) once the user is signed in, so moving between screens neither stops nor
 * restarts it, and a reload in this tab resumes it while the flag is set. The pass only decides pending invoices (R-25).
 *
 * The flag holds the id of the user whose entry set it: the pass runs for that user only, stops before its next call when the
 * session changes (another door, a sign-out), and nobody else sees it (AC-107: «Entrar como Andina Labs» runs no pass; R-119).
 *
 *   markFirstRun(uid)     the entry, right after the sign-in call
 *   <FirstRunProvider>    mounted once in App
 *   useFirstRun()         { running, progress, result, start, batches }: `batches` bumps after each answered call
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from './auth';
import { useRunAgent, type RunAgent } from './components/RunProgress';

export const FIRST_RUN = 'first-run';
export const markFirstRun = (uid: string) => sessionStorage.setItem(FIRST_RUN, uid);

export type FirstRun = RunAgent & { batches: number };
const IDLE: FirstRun = { start: async () => undefined, running: false, progress: null, result: null, batches: 0 };
const Ctx = createContext<FirstRun>(IDLE);
export const useFirstRun = (): FirstRun => useContext(Ctx);

export function FirstRunProvider({ children }: { children: ReactNode }) {
  const uid = useSession().session?.user.id;
  const { pathname } = useLocation(); // the entry sets the flag, then navigates: the move re-checks it
  const [batches, setBatches] = useState(0);
  const [owner, setOwner] = useState<string>(); // the user of this tab's pass, running or ended
  const now = useRef(uid);
  now.current = uid;
  const busy = useRef(false); // one pass per tab, StrictMode's second effect included
  const startedFor = useRef<string | undefined>(undefined);
  const run = useRunAgent({ first: '/api/invoices/run', onBatch: () => setBatches((n) => n + 1), stop: () => now.current !== startedFor.current });
  useEffect(() => {
    if (!uid || busy.current || sessionStorage.getItem(FIRST_RUN) !== uid) return;
    busy.current = true;
    startedFor.current = uid;
    setOwner(uid);
    setBatches(0);
    void run.start().then(() => {
      busy.current = false;
      if (now.current === uid) sessionStorage.removeItem(FIRST_RUN);
      else setOwner(undefined); // stopped for another user: their own flag, if their entry set one, starts their pass now
    });
  }, [uid, pathname, owner]);
  return <Ctx.Provider value={owner === uid ? { ...run, batches } : IDLE}>{children}</Ctx.Provider>;
}
