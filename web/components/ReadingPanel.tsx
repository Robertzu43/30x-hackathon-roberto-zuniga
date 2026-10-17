// «Leído por IA» fields (AC-77, R-88): value or «desconocido», the model's confidence, and the line of the document where code
// found the value (src/lib/snippet.ts), with the value highlighted. The snippet never comes from the model.
import { useT } from '../i18n';
import './ai.css';

export type ReadField = {
  name: string;
  value: string | number | null;
  confidence: number | null;
  snippet: string | null;
  /** [start, end) of the value inside `snippet`, as code found it; without it the value's own text is searched. */
  match?: [number, number] | null;
};
export type Reading = { provider: string; fields: ReadField[] };

const span = ({ value, snippet, match }: ReadField): [number, number] | null => {
  if (match) return match;
  const i = value === null || !snippet ? -1 : snippet.toLowerCase().indexOf(String(value).toLowerCase());
  return i < 0 ? null : [i, i + String(value).length];
};

export default function ReadingPanel({ fields, show }: { fields: ReadField[]; show: (name: string, v: string | number) => string }) {
  const { t, lang } = useT();
  // AC-77 prints «92 %»; Intl's es-CO percent has no space.
  const pct = (c: number) => `${Math.round(c * 100)}${lang === 'es' ? '\u00a0' : ''}%`;
  return (
    <dl className="detail-fields">
      {fields.map((f) => {
        const s = span(f);
        return (
          <div key={f.name}>
            <dt>{t(`detail.field.${f.name}`)}</dt>
            <dd className={f.value === null ? 'muted' : undefined}>{f.value === null ? t('value.unknown') : show(f.name, f.value)}</dd>
            {f.value !== null && f.confidence != null && <dd className="muted">{t('detail.confidence', { pct: pct(f.confidence) })}</dd>}
            <dd className="reading-snippet">
              {!f.snippet ? t('detail.snippet_none') : s ? (
                <>{f.snippet.slice(0, s[0])}<mark>{f.snippet.slice(s[0], s[1])}</mark>{f.snippet.slice(s[1])}</>
              ) : f.snippet}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
