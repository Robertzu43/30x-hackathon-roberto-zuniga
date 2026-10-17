import en from './en';
import es from './es';

export type Lang = 'es' | 'en';
const dict: Record<Lang, Record<string, string>> = { es, en };

export function t(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const s = dict[lang][key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
