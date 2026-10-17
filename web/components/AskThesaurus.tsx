// «Pregúntale a Thesaurus» (AC-67): one question, one labelled answer from POST /api/ask. Read-only; nothing is kept.
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import './ai.css';

export type AskReply =
  | { answer: string; provider: string; remaining: number }
  | { answer: null; reason: 'user_cap' | 'ai_quota' | 'failed'; message: string };
const REASONS = ['user_cap', 'ai_quota', 'failed'];
const MAX = 500;

type Shown = { answer: string; provider: string; remaining: number } | { key: string };

export default function AskThesaurus({ invoiceId }: { invoiceId?: string }) {
  const { t, lang } = useT();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || q.length > MAX) return setShown({ key: 'ask.bad_question' });
    setBusy(true);
    setShown(null);
    try {
      const r = await api.post<AskReply>('/api/ask', invoiceId ? { question: q, lang, invoice_id: invoiceId } : { question: q, lang });
      setShown(r.answer !== null ? r : { key: `ask.reason.${REASONS.includes(r.reason) ? r.reason : 'failed'}` });
    } catch (err) {
      setShown({ key: err instanceof ApiError && err.status === 400 ? 'ask.bad_question' : 'ask.reason.failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ask" aria-labelledby="ask-title">
      <h2 id="ask-title">{t('ask.title')}</h2>
      <form onSubmit={(e) => void submit(e)}>
        <label>
          {t('ask.question')}
          <textarea data-user="" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>
        <button type="submit" disabled={busy} aria-busy={busy}>{t(busy ? 'ask.sending' : 'ask.send')}</button>
      </form>
      <div role="status">
        {shown && ('key' in shown ? (
          <p className="ask-note">{t(shown.key)}</p>
        ) : (
          <>
            <p className="ask-answer">{shown.answer}</p>
            <p className="muted ask-meta">{t('ask.label', { provider: shown.provider })}</p>
            <p className="muted ask-meta">{t(`ask.remaining.${shown.remaining === 1 ? 'one' : 'other'}`, { n: shown.remaining })}</p>
          </>
        ))}
      </div>
    </section>
  );
}
