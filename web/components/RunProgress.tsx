/**
 * UI for budgeted agent runs (AC-70). Used by Bandeja, Politica and /demo.
 *
 *   const run = useRunAgent({ first, next?, onBatch?, stop? });   // same options as runUntilDone, see ../runAgent.ts
 *   <button disabled={run.running} onClick={run.start}>...</button>
 *   <RunProgress run={run} mode="pending" | "reevaluate" progressKey?="run.progress" pending?={n | null} />
 *
 * run = { start(), running, progress: {n,m,done} | null, result: RunResult | null }.
 * RunProgress renders, in order: "Decidiendo facturas… n de m" while running; after the run the summed
 * "n PAGAR · n FRENAR · n ESCALAR" (en: "n PAY · n STOP · n ESCALATE", R-65), the R-57 errors line for `mode`, and a non-2xx error text as is.
 * `pending` (Bandeja's first-login pass, AC-107): the line and the summary share one box, both always in it and the one not
 * shown hidden, so the swap at the end moves nothing (AC-99, AC-91 item 4); the line reads «0 de <pending>» before the first
 * call answers, and null (the screen's data not there yet) keeps the box empty.
 */
import { useRef, useState } from 'react';
import { useT } from '../i18n';
import { runUntilDone, type Progress, type RunResult } from '../runAgent';

type Opts = Pick<Parameters<typeof runUntilDone>[0], 'first' | 'next' | 'onBatch' | 'stop'>;
export type RunAgent = { start: () => Promise<RunResult | undefined>; running: boolean; progress: Progress | null; result: RunResult | null };

export function useRunAgent(opts: Opts): RunAgent {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const busy = useRef(false); // a second click before the re-render must not start a second loop
  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setProgress(null);
    setResult(null);
    const r = await runUntilDone({ ...opts, onProgress: setProgress });
    setResult(r);
    setRunning(false);
    busy.current = false;
    return r;
  };
  return { start, running, progress, result };
}

export function RunProgress({ run, mode, progressKey = 'run.progress', pending }: {
  run: RunAgent; mode: 'pending' | 'reevaluate'; progressKey?: string; pending?: number | null;
}) {
  const { t } = useT();
  const { running, progress: p, result: r } = run;
  const boxed = pending !== undefined;
  const line = t(progressKey, { n: p?.n ?? 0, m: p?.m ?? pending ?? '…' });
  const showLine = running && (p !== null || pending !== null);
  const showSummary = !running && !!r && (!r.error || r.PAGAR + r.FRENAR + r.ESCALAR > 0);
  const ghost = { className: 'run-ghost', 'aria-hidden': true } as const;
  return (
    <div role="status">
      {boxed ? (
        <div className="run-box">
          <p className={showLine ? 'muted' : 'muted run-ghost'} aria-hidden={showLine ? undefined : true}>{line}</p>
          {showSummary ? <p>{t('run.summary', r)}</p> : <p {...ghost}>{t('run.summary', r ?? { PAGAR: 0, FRENAR: 0, ESCALAR: 0 })}</p>}
        </div>
      ) : (
        <>
          {running && <p className="muted">{line}</p>}
          {showSummary && <p>{t('run.summary', r)}</p>}
        </>
      )}
      {!running && r && (
        <>
          {r.errors > 0 && <p>{t(mode === 'pending' ? 'run.errors_pending' : 'run.errors_reevaluate', { n: r.errors })}</p>}
          {r.error && <p role="alert" className="error">{r.error}</p>}
        </>
      )}
    </div>
  );
}
