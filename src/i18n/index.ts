import en from './en';
import es from './es';

export type Lang = 'es' | 'en';
export type Dict = Record<string, string>;
const dict: Record<Lang, Dict> = { es, en };

export const format = (d: Dict, key: string, vars: Record<string, string | number> = {}): string =>
  (d[key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

export const t = (lang: Lang, key: string, vars?: Record<string, string | number>): string => format(dict[lang], key, vars);
