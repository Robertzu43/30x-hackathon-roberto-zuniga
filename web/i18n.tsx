import { createContext, useContext, useState, type ReactNode } from 'react';
import { format, type Lang } from '../src/i18n';
import { ui } from '../src/i18n/ui';

type Ctx = {
  t: (key: string, vars?: Record<string, string | number>) => string;
  lang: Lang;
  /** For Intl number/date formats (AC-41). */
  locale: 'es-CO' | 'en-US';
  setLang: (l: Lang) => void;
};
const LangCtx = createContext<Ctx | null>(null);

const stored = (): Lang => (localStorage.getItem('lang') === 'en' ? 'en' : 'es');

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(stored);
  const setLang = (l: Lang) => {
    localStorage.setItem('lang', l);
    document.documentElement.lang = l;
    set(l);
  };
  const t: Ctx['t'] = (k, v) => format(ui[lang], k, v);
  return <LangCtx.Provider value={{ lang, setLang, t, locale: lang === 'es' ? 'es-CO' : 'en-US' }}>{children}</LangCtx.Provider>;
}

export function useT(): Ctx {
  const c = useContext(LangCtx);
  if (!c) throw new Error('useT outside LangProvider');
  return c;
}
