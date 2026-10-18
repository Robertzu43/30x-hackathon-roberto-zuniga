// AC-116 (R-171): the one step-card system for instruction boxes: a number badge (not on a single-step helper), an inline icon,
// a short title and one sentence. 3 per row when the grid is at least 600 px wide, else 1 (step-cards.css). The vendor portal
// (plain JS) draws the same markup and classes in portal/public/app.js.
import type { ReactNode } from 'react';
import './step-cards.css';

// Inline SVG, approved palette only (AC-53): ink strokes, one green accent.
const ICONS = {
  inbox: <><path d="M3 13h5l1 3h6l1-3h5" /><path d="M5 5h14l2 8v6H3v-6z" /></>,
  read: <><path d="M4 4h11l5 5v11H4z" /><path d="M8 12h8M8 16h5" stroke="#346538" /></>,
  tools: <><circle cx="10" cy="10" r="6" /><path d="M14.5 14.5 20 20" stroke="#346538" /></>,
  decide: <><path d="M12 3v6M12 9l-6 6M12 9l6 6" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" fill="#346538" stroke="#346538" /></>,
  act: <><path d="M4 12h13" /><path d="M13 6l6 6-6 6" stroke="#346538" /></>,
  record: <><path d="M6 3h12v18H6z" /><path d="M9 8h6M9 12h6" /><path d="M9 16l2 2 4-4" stroke="#346538" /></>,
  upload: <><path d="M12 16V4" /><path d="M7 9l5-5 5 5" stroke="#346538" /><path d="M4 16v4h16v-4" /></>,
  link: <><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1" /><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" stroke="#346538" /></>,
};
export type Icon = keyof typeof ICONS;
export type Step = { title: string; text: string; icon: Icon; extra?: ReactNode };

export default function StepCards({ steps, label }: { steps: Step[]; label?: string }) {
  const numbered = steps.length > 1;
  return (
    <ol className="step-cards" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.title} className="step-card" data-step-card>
          <span className="step-head">
            {numbered && <span className="step-n">{i + 1}</span>}
            <svg className="step-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#111111" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[s.icon]}</svg>
          </span>
          <span className="step-title"><strong data-step-title>{s.title}</strong>{s.extra}</span>
          <p>{s.text}</p>
        </li>
      ))}
    </ol>
  );
}
