import en from './en';
import es from './es';
import * as fx from './features/fx';

export type Lang = 'es' | 'en';
export type Dict = Record<string, string>;
// Record strings of feature files the Worker renders, registered here (ui.ts merges base + every feature file itself).
const dict: Record<Lang, Dict> = { es: { ...es, ...fx.es }, en: { ...en, ...fx.en } };

export const format = (d: Dict, key: string, vars: Record<string, string | number> = {}): string =>
  (d[key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

export const t = (lang: Lang, key: string, vars?: Record<string, string | number>): string => format(dict[lang], key, vars);
