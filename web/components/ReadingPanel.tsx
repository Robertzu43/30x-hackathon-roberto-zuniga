// «Leído por IA» fields (AC-77, R-88, R-107): each value the AI read, the model's confidence, and the line of the document where code
// found the value (src/lib/snippet.ts), with the value highlighted. The snippet never comes from the model.
import { useT } from '../i18n';
import { printedAsRead } from './User';
import './ai.css';

export type ReadField = {
  name: string;
  value: string | number | null;
  confidence: number | null;
  snippet: string | null;
  /** [start, end) of the value as printed inside `snippet`, from src/lib/snippet.ts; null when there is no snippet. Never searched here. */
  match: [number, number] | null;
};
export type Reading = { provider: string; fields: ReadField[] };

// R-107: known = a non-empty value that is not the model's own «desconocido»/"unknown".
const known = (v: ReadField['value']) => v !== null && !['', 'desconocido', 'unknown'].includes(String(v).trim().toLowerCase());

export default function ReadingPanel({ fields, show }: { fields: ReadField[]; show: (name: string, v: string | number) => string }) {
  const { t, lang } = useT();
  // AC-77 prints «92 %»; Intl's es-CO percent has no space.
  const pct = (c: number) => `${Math.round(c * 100)}${lang === 'es' ? ' ' : ''}%`;
  const read = fields.filter((f) => known(f.value));
  const unread = fields.filter((f) => !known(f.value)).map((f) => t(`detail.field.${f.name}`));
  return (
    <>
      {read.length > 0 && (
        <dl className="detail-fields">
          {read.map((f) => {
            const s = f.match;
            const c = f.confidence;
            return (
              <div key={f.name}>
                <dt>{t(`detail.field.${f.name}`)}</dt>
                <dd data-user={printedAsRead(f.name, f.value!) ? '' : undefined}>{show(f.name, f.value!)}</dd>
                {typeof c === 'number' && c >= 0 && c <= 1 && <dd className="muted">{t('detail.ai_confidence', { pct: pct(c) })}</dd>}
                <dd className="reading-snippet" data-user={f.snippet ? '' : undefined}>
                  {!f.snippet ? t('detail.snippet_none') : s ? (
                    <>{f.snippet.slice(0, s[0])}<mark>{f.snippet.slice(s[0], s[1])}</mark>{f.snippet.slice(s[1])}</>
                  ) : f.snippet}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {unread.length > 0 && (
        <p className="muted reading-unread">{t(`detail.unread_fields.${unread.length === 1 ? 'one' : 'other'}`, { n: unread.length, list: unread.join(', ') })}</p>
      )}
    </>
  );
}
