import { createContext, useContext, useState, type ReactNode } from 'react';
import { format, type Lang } from '../src/i18n';
import { ui } from '../src/i18n/ui';

type Ctx = {
  t: (key: string, vars?: Record<string, string | number>) => string;
  lang: Lang;
  /** For Intl number/date formats (AC-41). */
  locale: 'es-CO' | 'en-US';
  /** A percentage in points (62 → es «62%», en "62%"), always Intl's percent for the tab locale (R-164); decimals kept, up to 2. */
  pct: (points: number) => string;
  /** `tabOnly`: this tab's session only, never other tabs or the next visit (R-78: the shared demo user, /demo). */
  setLang: (l: Lang, tabOnly?: boolean) => void;
};
const LangCtx = createContext<Ctx | null>(null);

// The tab's own choice first, then the browser's last one.
export const storedLang = (): Lang => ((sessionStorage.getItem('lang') ?? localStorage.getItem('lang')) === 'en' ? 'en' : 'es');

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(storedLang);
  const setLang: Ctx['setLang'] = (l, tabOnly = false) => {
    sessionStorage.setItem('lang', l);
    if (!tabOnly) localStorage.setItem('lang', l);
    document.documentElement.lang = l;
    set(l);
  };
  const t: Ctx['t'] = (k, v) => format(ui[lang], k, v);
  const locale = lang === 'es' ? 'es-CO' : 'en-US';
  const pct = (v: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(v / 100);
  return <LangCtx.Provider value={{ lang, setLang, t, locale, pct }}>{children}</LangCtx.Provider>;
}

export function useT(): Ctx {
  const c = useContext(LangCtx);
  if (!c) throw new Error('useT outside LangProvider');
  return c;
}
