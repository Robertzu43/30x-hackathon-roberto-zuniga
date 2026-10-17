import { createContext, useContext, useState, type ReactNode } from 'react';
import { t as translate, type Lang } from '../src/i18n';

type Ctx = { t: (key: string, vars?: Record<string, string | number>) => string; lang: Lang; setLang: (l: Lang) => void };
const LangCtx = createContext<Ctx | null>(null);

const stored = (): Lang => (localStorage.getItem('lang') === 'en' ? 'en' : 'es');

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(stored);
  const setLang = (l: Lang) => {
    localStorage.setItem('lang', l);
    document.documentElement.lang = l;
    set(l);
  };
  return <LangCtx.Provider value={{ lang, setLang, t: (k, v) => translate(lang, k, v) }}>{children}</LangCtx.Provider>;
}

export function useT(): Ctx {
  const c = useContext(LangCtx);
  if (!c) throw new Error('useT outside LangProvider');
  return c;
}
