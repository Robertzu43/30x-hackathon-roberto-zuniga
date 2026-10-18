/* global URL */
// AC-111 Evidence (R-156, R-160): the film's captions are true, institutional and in D44a's order.
// check() is the whole rule set; the real cues.json must pass it and each fixture below must fail it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { privacyViolation } from './capture.mjs';

const read = (p) => readFileSync(new URL(`../../docs/film/${p}`, import.meta.url), 'utf8');

// [id, max seconds, min seconds] per part, in D44a's order.
const PARTS = [[1, 10], [2, 24], [3, 75, 60], [4, 15], [5, 10], [6, 14], [7, 12]];
const SCENES = [['Recibe', 8, 12], ['Lee', 8, 12], ['Verifica', 8, 12], ['Decide', 12, 18], ['Rinde cuentas', 8, 12], ['Controla', 8, 12]];
const VERBATIM = [
  [1, 'Thesaurus — el agente de cuentas por pagar para empresas globales'],
  [4, 'La IA lee.'], [4, 'El código decide.'], [4, 'Una persona aprueba.'],
  [7, 'Listo para conectarse a Blinka'],
];
const BUTTON = ['Probar con mi propia empresa', 'Try it with my own company']; // the only first-person text allowed
// Whole words only (letters, not \b, so «mí» and «AI» behave); English «I» only as a capital.
const word = (w, flags) => new RegExp(`(?<![\\p{L}\\p{N}])(${w})(?![\\p{L}\\p{N}])`, flags);
const FIRST_PERSON = {
  es: [word('yo|me|mi|mis|nosotros|nos|nuestro|nuestra|nuestros|nuestras', 'iu')],
  en: [word('we|my|our', 'iu'), word('I', 'u')],
};

// Digit sequences as numbers: «2.283» and «2,283» are both 2283.
const numbers = (s) => (s.match(/\d(?:[\d.,]*\d)?/g) ?? []).map((n) => n.replace(/[.,]/g, ''));

function listed(md) {
  const rows = md.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)) // header rows carry no digits
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  return new Set(rows.filter((r) => r.length >= 3 && r[2]).flatMap((r) => numbers(r[0])));
}

export function check(film, md) {
  const errors = [];
  const cues = film.cues;
  const ok = listed(md);
  for (const c of cues) {
    for (const lang of ['es', 'en']) {
      const t = c[lang];
      if (typeof t !== 'string' || !t.trim()) { errors.push(`${c.id}: no ${lang} text`); continue; }
      if (/[¿?¡!]/.test(t)) errors.push(`${c.id}: question or exclamation mark in ${lang}`);
      const rest = BUTTON.reduce((s, b) => s.replace(b, ''), t);
      for (const re of FIRST_PERSON[lang]) { const m = rest.match(re); if (m) errors.push(`${c.id}: first person «${m[1]}» in ${lang}`); }
      for (const n of numbers(t)) if (!ok.has(n)) errors.push(`${c.id}: ${n} is not a numbers.md row with a source`);
    }
    if (!(c.end > c.start)) errors.push(`${c.id}: end is not after start`);
  }
  // Parts: in order, back to back without overlap, each inside its limits; the film is 120 to 150 s.
  let prevEnd = 0;
  let prevPart = 0;
  for (const c of cues) { if (c.part < prevPart) errors.push(`${c.id}: part ${c.part} after part ${prevPart}`); prevPart = Math.max(prevPart, c.part); }
  for (const [id, max, min = 0] of PARTS) {
    const p = cues.filter((c) => c.part === id);
    if (!p.length) { errors.push(`part ${id} missing`); continue; }
    const start = Math.min(...p.map((c) => c.start));
    const end = Math.max(...p.map((c) => c.end));
    if (start < prevEnd) errors.push(`part ${id} starts at ${start}, before part ${id - 1} ends (${prevEnd})`);
    if (end - start > max || end - start < min) errors.push(`part ${id} lasts ${end - start} s, outside ${min}-${max} s`);
    prevEnd = end;
  }
  if (prevEnd < 120 || prevEnd > 150) errors.push(`the film lasts ${prevEnd} s, outside 120-150 s`);
  // Product scenes: the six titles in order, each with exactly one supporting line, each inside its length.
  const titles = cues.filter((c) => c.part === 3 && c.role === 'title');
  if (titles.map((c) => c.es).join('|') !== SCENES.map((s) => s[0]).join('|')) errors.push(`scene titles are «${titles.map((c) => c.es).join(', ')}», not D44a's six in order`);
  for (const t of titles) {
    const scene = cues.filter((c) => c.scene === t.scene);
    if (scene.filter((c) => c.role === 'line').length !== 1) errors.push(`${t.scene}: not exactly one supporting line`);
    const [, min, max] = SCENES.find((s) => s[0] === t.es) ?? [];
    const len = Math.max(...scene.map((c) => c.end)) - Math.min(...scene.map((c) => c.start));
    if (min && (len < min || len > max)) errors.push(`${t.scene}: lasts ${len} s, outside ${min}-${max} s`);
  }
  for (const [part, text] of VERBATIM) if (!cues.some((c) => c.part === part && c.es === text)) errors.push(`part ${part}: «${text}» missing verbatim`);
  return errors;
}

const film = JSON.parse(read('cues.json'));
const md = read('numbers.md');
const withCue = (patch) => ({ ...film, cues: film.cues.map((c, i) => (i === 1 ? { ...c, ...patch } : c)) });

describe('cues.json (AC-111, R-156, R-160)', () => {
  it('passes every structure, tone and number rule', () => {
    expect(check(film, md)).toEqual([]);
  });

  it('shows numbers, so the number rule is exercised', () => {
    expect(film.cues.flatMap((c) => numbers(`${c.es} ${c.en}`)).length).toBeGreaterThan(0);
  });

  it.each([
    ['an unlisted number', { es: 'Revisa 47 facturas.' }, /47 is not a numbers.md row/],
    ['a question mark', { es: '¿Quién paga' }, /question or exclamation/],
    ['an exclamation mark in English', { en: 'Ready!' }, /question or exclamation/],
    ['a Spanish first-person word', { es: 'Nuestro agente lee.' }, /first person «Nuestro»/],
    ['an English «I»', { en: 'Then I approve.' }, /first person «I»/],
    ['an English «our»', { en: 'Read by our agent.' }, /first person «our»/],
    ['an end before the start', { end: 0 }, /end is not after start/],
  ])('fails a fixture cue with %s', (_, patch, error) => {
    expect(check(withCue(patch), md).join('\n')).toMatch(error);
  });

  it('reads «AI» and words that contain «mi» or «me» as third person', () => {
    expect(check(withCue({ es: 'La IA lee; el mismo monto se mide.', en: 'AI reads; the same amount is measured.' }), md)).toEqual([]);
  });

  it('fails a scene out of order', () => {
    const cues = film.cues.map((c) => (c.part === 3 && c.role === 'title' && c.es === 'Lee' ? { ...c, es: 'Verifica' } : c.part === 3 && c.role === 'title' && c.es === 'Verifica' ? { ...c, es: 'Lee' } : c));
    expect(check({ ...film, cues }, md).join('\n')).toMatch(/not D44a's six in order/);
  });

  it('fails a part out of order', () => {
    const cues = [...film.cues];
    const i = cues.findIndex((c) => c.part === 4);
    cues.splice(1, 0, cues.splice(i, 1)[0]);
    expect(check({ ...film, cues }, md).join('\n')).toMatch(/after part 4/);
  });

  it('fails a part over its limit and a film over 150 s', () => {
    const cues = film.cues.map((c) => (c.part === 7 ? { ...c, end: c.end + 30 } : c));
    const errors = check({ ...film, cues }, md).join('\n');
    expect(errors).toMatch(/part 7 lasts .* outside 0-12 s/);
    expect(errors).toMatch(/outside 120-150 s/);
  });

  it('fails a governance sentence that is not verbatim', () => {
    const cues = film.cues.map((c) => (c.es === 'El código decide.' ? { ...c, es: 'El código decide todo.' } : c));
    expect(check({ ...film, cues }, md).join('\n')).toMatch(/«El código decide.» missing verbatim/);
  });

  it('fails a product scene with two supporting lines', () => {
    const line = film.cues.find((c) => c.part === 3 && c.role === 'line');
    const cues = [...film.cues];
    cues.splice(cues.indexOf(line) + 1, 0, { ...line, id: 'extra' });
    expect(check({ ...film, cues }, md).join('\n')).toMatch(/not exactly one supporting line/);
  });

  it('fails a number whose numbers.md row has no source', () => {
    expect(check(withCue({ es: 'Revisa 47 facturas.' }), `${md}\n| 47 | prueba |  |\n`).join('\n')).toMatch(/47 is not a numbers.md row/);
  });
});

describe('capture privacy guard (R-156)', () => {
  const secret = 'aprobador.real@example.org';
  it('passes text without an address', () => expect(privacyViolation('Andina Labs · Política v3 · Límite por pago 5.000 USD', secret)).toBeNull());
  it('fails any email address', () => expect(privacyViolation('Correo: pagos@andina-labs.example', secret)).toMatch(/email address/));
  it('fails the HEARTBEAT_EMAIL value, without printing it', () => {
    const v = privacyViolation(`Aprobador ${secret.toUpperCase().replace('@', ' @ ')}`.replace(' @ ', '@'), secret);
    expect(v).toMatch(/HEARTBEAT_EMAIL/);
    expect(v).not.toContain('aprobador');
  });
  it('fails the HEARTBEAT_EMAIL local part split across lines', () => expect(privacyViolation('aprobador.real\n@example.org', secret)).toMatch(/HEARTBEAT_EMAIL|email address/));
});
