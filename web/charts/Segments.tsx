import { Frame, useFmt, type Tone } from './shared';

/** One bar split into parts (progress or a budget split). Every part is also printed with its word and value. `note` is a sentence under the bar. */
export default function Segments({ title, unit, segments, note, height = 48 }: {
  title: string; unit: string; segments: { label: string; value: number; tone: Tone }[]; note?: string; height?: number;
}) {
  const { t, n } = useFmt();
  const total = segments.reduce((a, s) => a + s.value, 0);
  const parts = segments.map((s) => `${s.label} ${n(s.value)}`).join(', ');
  return (
    <Frame title={title} unit={unit} height={height} empty={!(total > 0)} summary={t('charts.sum.list', { title, unit, parts })}>
      <div className="chart-seg" aria-hidden="true">
        {segments.map((s) => (s.value > 0 ? <span key={s.label} className={`tone-${s.tone}`} style={{ flexGrow: s.value }} /> : null))}
      </div>
      <ul className="chart-parts">
        {segments.map((s) => (
          <li key={s.label}><i className={`chart-swatch tone-${s.tone}`} aria-hidden="true" /><span>{s.label}</span> <b>{n(s.value)}</b></li>
        ))}
      </ul>
      {note && <p className="chart-note">{note}</p>}
    </Frame>
  );
}
