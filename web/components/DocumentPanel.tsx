import type { ReactNode } from 'react';
import { useT } from '../i18n';

export type DocMark = { field: string; start: number; end: number };

/** AC-102: the original file (AC-08) and the stored text with each value the AI read in <mark>. The offsets come from
 * code (src/lib/snippet.ts docMarks, R-88); nothing is drawn on the file itself (R-124). R-131: the text is user data. */
export default function DocumentPanel({ source, url, rawText, marks }: {
  source: 'pdf' | 'image' | 'email' | 'chat'; url: string | null; rawText: string | null; marks: DocMark[] | null;
}) {
  const { t } = useT();
  const file = source === 'pdf' || source === 'image' ? url : null;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of marks ?? []) {
    if (!rawText || m.start < at || m.end > rawText.length || m.end <= m.start) continue; // sorted, disjoint per contract
    parts.push(rawText.slice(at, m.start), <mark key={m.start}>{rawText.slice(m.start, m.end)}</mark>);
    at = m.end;
  }
  return (
    <>
      {file && (
        <>
          {source === 'pdf'
            ? <iframe className="detail-doc" src={file} title={t('detail.file.title')} />
            : <img className="detail-doc" src={file} alt={t('detail.file.title')} />}
          <a className="detail-link" href={file} target="_blank" rel="noreferrer">{t('detail.file.open')}</a>
        </>
      )}
      {rawText ? (
        <>
          {file && <h3 className="detail-doc-title">{t('detail.doc_text')}</h3>}
          <pre className="detail-doc" data-user="">{parts}{rawText.slice(at)}</pre>
        </>
      ) : !file && <p className="muted">{t('detail.file.none')}</p>}
    </>
  );
}
