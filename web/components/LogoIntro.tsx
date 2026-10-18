import { useEffect, useState, type CSSProperties } from 'react';
import { useT } from '../i18n';
import Logo from './Logo';
import './logo-intro.css';

// AC-108: the wordmark writes itself in, once per screen per tab. CSS only; the timing sits inline so a test can read it.
const STEP_MS = 50; // each letter starts 40 to 60 ms after the one before
const LETTER_MS = 450;
const WORD = [...'Thesaurus'];
const MARK_DELAY_MS = WORD.length * STEP_MS; // the mark settles last
const MARK_MS = 600; // ends at 1050 ms, inside the 1200 ms bound
const timing = (delay: number, duration: number): CSSProperties => ({ animationDelay: `${delay}ms`, animationDuration: `${duration}ms` });

const key = (screen: string) => `logo-intro:${screen}`;
const played = (screen: string) => { try { return sessionStorage.getItem(key(screen)) !== null; } catch { return false; } };

/** The animated logo for /login and /demo. Pass the screen name; the second mount in a tab shows the static logo. */
export default function LogoIntro({ screen }: { screen: string }) {
  const { t } = useT();
  const [plays] = useState(() => !played(screen)); // read in render, written in the effect: safe under StrictMode
  useEffect(() => { try { sessionStorage.setItem(key(screen), '1'); } catch { /* no storage: it just plays again */ } }, [screen]);
  if (!plays) return <Logo />;
  return (
    <span className="logo logo-intro" role="img" aria-label={t('app.name')}>
      <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true" style={timing(MARK_DELAY_MS, MARK_MS)}>
        <rect width="32" height="32" rx="6" fill="#111111" />
        <rect x="8" y="8" width="16" height="4" fill="#ffffff" />
        <rect x="14" y="12" width="4" height="12" fill="#ffffff" />
        <rect x="20" y="20" width="4" height="4" fill="#346538" />
      </svg>
      <span className="logo-word" aria-hidden="true">
        {WORD.map((c, i) => <span key={i} style={timing(i * STEP_MS, LETTER_MS)}>{c}</span>)}
      </span>
    </span>
  );
}
