/// <reference types="vite/client" />
// UI dictionaries: base es/en plus every src/i18n/features/*.ts. Web only: the Worker bundler (wrangler/esbuild)
// does not transform import.meta.glob, so the Worker keeps importing ./index (base dictionaries) only.
import en from './en';
import es from './es';
import type { Dict, Lang } from './index';

type Feature = { es: Dict; en: Dict };
// No type argument on glob: with one, Vite 8 silently returns {}.
const features = import.meta.glob('./features/*.ts', { eager: true }) as Record<string, Feature>;

export function merge(sources: Record<string, Dict>): Dict {
  const out: Dict = {};
  const from: Record<string, string> = {};
  for (const [file, d] of Object.entries(sources))
    for (const [k, v] of Object.entries(d)) {
      if (k in out) throw new Error(`i18n key "${k}" defined twice: ${from[k]} and ${file}`);
      out[k] = v;
      from[k] = file;
    }
  return out;
}

const pick = (lang: Lang): Dict =>
  merge({ base: lang === 'es' ? es : en, ...Object.fromEntries(Object.entries(features).map(([f, m]) => [f, m[lang]])) });

export const ui: Record<Lang, Dict> = { es: pick('es'), en: pick('en') };
