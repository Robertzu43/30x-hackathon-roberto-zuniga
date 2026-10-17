// "Nueva factura" (AC-11): three tabs -> POST /api/invoices -> the new invoice's detail. The client checks mirror
// the server's (R-11, AC-15) so a wrong file never leaves the browser; the server stays the authority.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useT } from '../i18n';
import { tu } from './User';
import './new-invoice.css';

const TABS = ['file', 'email', 'chat'] as const;
const TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const MAX_BYTES = 10 * 1024 * 1024;

export default function NewInvoice() {
  const { t } = useT();
  const navigate = useNavigate();
  const [tab, setTab] = useState<(typeof TABS)[number]>('file');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let body: FormData | { source: string; text: string };
    if (tab === 'file') {
      if (!file) return setError(t('inbox.new.no_file')); // UX-20
      if (!TYPES.includes(file.type) || !file.size || file.size > MAX_BYTES) return setError(t('inbox.new.bad_file'));
      body = new FormData();
      body.set('file', file);
      body.set('source', file.type === 'application/pdf' ? 'pdf' : 'image');
    } else {
      if (!text.trim() || text.length > 20000) return setError(t('inbox.new.bad_text'));
      body = { source: tab, text };
    }
    setError('');
    setBusy(true);
    try {
      const { invoice } = await api.post<{ invoice: { id: string } }>('/api/invoices', body);
      navigate(`/invoices/${invoice.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); // the API's own text, as is (R-57)
      setBusy(false);
    }
  };

  return (
    <form className="new-invoice" onSubmit={submit}>
      <div role="tablist">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setError(''); }}>
            {t(`inbox.new.tab.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'file' ? (
        <div className="new-invoice-file">
          <span>{t('inbox.new.file')}</span>
          {/* UX-19: the browser's own button text follows the browser language; this one follows the app's. */}
          <label className="file-pick">
            <input type="file" aria-label={t('inbox.new.file')} accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className="file-button" aria-hidden="true">{t('inbox.new.choose')}</span>
            <span className="muted">{file ? tu(t('inbox.new.chosen'), { name: file.name }) : t('inbox.new.none_chosen')}</span>
          </label>
        </div>
      ) : (
        <label>
          {t('inbox.new.text')}
          <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      <div>
        <button type="submit" className="primary" disabled={busy}>{busy ? t('inbox.new.sending') : t('inbox.new.send')}</button>
      </div>
    </form>
  );
}
