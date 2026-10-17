// «Actividad del agente» (AC-78, R-89): replays the steps the Worker renders from each recorded decision, about 400 ms
// a step, newest invoice first, the last 10 at most. Polls every 10 s while the tab is visible; `refresh` changing (each
// run call returning, Bandeja's loop) fetches at once. No AI call.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';

type Item = { invoice_id: string; decided_at: string; steps: Array<{ stage: string; text: string }> };
type Played = Item & { shown: number };
const STEP_MS = 400;
const POLL_MS = 10_000;
const MAX = 10;
const key = (i: Item) => `${i.invoice_id}@${i.decided_at}`;

export default function AgentActivity({ refresh = 0 }: { refresh?: number }) {
  const { t } = useT();
  const [items, setItems] = useState<Played[] | null>(null);
  const [failed, setFailed] = useState(false);
  const since = useRef<string | null>(null); // the newest decided_at seen; the API answers at or after it

  const load = () =>
    api.get<{ items?: Item[] }>(`/api/agent/activity${since.current ? `?since=${encodeURIComponent(since.current)}` : ''}`).then((r) => {
      const fresh = Array.isArray(r?.items) ? r.items : []; // newest first
      if (fresh[0]) since.current = fresh[0].decided_at;
      setItems((old) => {
        const seen = new Set((old ?? []).map(key));
        return [...fresh.filter((i) => !seen.has(key(i))).map((i) => ({ ...i, shown: 0 })), ...(old ?? [])].slice(0, MAX);
      });
      setFailed(false);
    }, () => setFailed(true));

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      if (document.visibilityState === 'hidden') return;
      void load();
      timer = setInterval(() => void load(), POLL_MS);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  useEffect(() => {
    if (refresh) void load();
  }, [refresh]);

  // One step at a time, top (newest) first.
  const next = items?.find((i) => i.shown < i.steps.length);
  useEffect(() => {
    if (!next) return;
    const k = key(next);
    const id = setTimeout(() => setItems((xs) => xs && xs.map((x) => (key(x) === k ? { ...x, shown: x.shown + 1 } : x))), STEP_MS);
    return () => clearTimeout(id);
  }, [items]);

  const played = (items ?? []).filter((i) => i.shown > 0);
  return (
    <section className="activity" aria-labelledby="activity-title">
      <h2 id="activity-title">{t('activity.title')}</h2>
      <p className="muted">{t('activity.label')}</p>
      {items === null ? (
        <p className="muted">{t(failed ? 'activity.error' : 'activity.loading')}</p>
      ) : items.length === 0 ? (
        <p className="muted">{t('activity.empty')}</p>
      ) : (
        <ol className="activity-list">
          {played.map((i) => (
            <li key={key(i)}>
              <ol>{i.steps.slice(0, i.shown).map((s, n) => <li key={n} className={`activity-${s.stage}`}>{s.text}</li>)}</ol>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
