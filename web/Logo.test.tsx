import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import App from './App';
import LogoIntro from './components/LogoIntro';
import { useT } from './i18n';
import { mockApi, renderAt } from './test/utils';

const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string }; // no @types/node here
const text = (p: string) => readFileSync(p, 'utf8');

beforeEach(() => mockApi({ 'GET /api/invoices': [], 'GET /api/agent/last-run': null }));

// AC-80: Login (full-bleed), /demo (full-bleed) and the approve page (inside the top bar) each show the Thesaurus logo.
test.each(['/login', '/demo', '/approve/abc'])('%s shows the Thesaurus logo as an SVG image', async (at) => {
  renderAt(<App />, { at });
  const logo = await screen.findByRole('img', { name: 'Thesaurus' });
  expect(logo.getAttribute('src')).toBe('/brand/thesaurus-logo.svg');
});

test('the tagline stays as text next to the logo', async () => {
  renderAt(<App />, { at: '/approve/abc' });
  expect(await screen.findByText('un agente de pagos construido para Blinka')).toBeTruthy();
});

// AC-108 (R-147): the wordmark intro. Letters and mark carry their own delay and duration inline, so the timing is testable.
const ms = (v: string) => Number.parseFloat(v);
const timing = (e: Element) => ({ delay: ms((e as HTMLElement).style.animationDelay), duration: ms((e as HTMLElement).style.animationDuration) });
const letters = (root: HTMLElement) => [...root.querySelectorAll('.logo-word > span')];
const mark = (root: HTMLElement) => root.querySelector('.logo-mark') as Element;

beforeEach(() => sessionStorage.clear());

test('the intro renders 9 letters in order, each 40 to 60 ms after the one before, aria-hidden', () => {
  const { container } = renderAt(<LogoIntro screen="login" />);
  const ls = letters(container);
  expect(ls.map((l) => l.textContent).join('')).toBe('Thesaurus');
  expect(ls.every((l) => l.getAttribute('aria-hidden') === 'true' || l.parentElement?.getAttribute('aria-hidden') === 'true')).toBe(true);
  const delays = ls.map((l) => timing(l).delay);
  for (let i = 1; i < delays.length; i++) {
    const gap = (delays[i] ?? 0) - (delays[i - 1] ?? 0);
    expect(gap).toBeGreaterThanOrEqual(40);
    expect(gap).toBeLessThanOrEqual(60);
  }
});

test('the mark settles last and every part ends within 1200 ms', () => {
  const { container } = renderAt(<LogoIntro screen="login" />);
  const parts = [...letters(container), mark(container)].map(timing);
  expect(timing(mark(container)).delay).toBe(Math.max(...parts.map((p) => p.delay)));
  expect(timing(mark(container)).delay).toBeGreaterThan(Math.max(...letters(container).map((l) => timing(l).delay)));
  for (const p of parts) expect(p.delay + p.duration).toBeLessThanOrEqual(1200);
});

test('the logo has one accessible name, Thesaurus', () => {
  renderAt(<LogoIntro screen="login" />);
  expect(screen.getAllByRole('img', { name: 'Thesaurus' })).toHaveLength(1);
});

test('a second mount in the same tab renders the static logo; another screen still plays', () => {
  const first = renderAt(<LogoIntro screen="login" />);
  expect(first.container.querySelector('.logo-word')).not.toBeNull();
  first.unmount();
  const second = renderAt(<LogoIntro screen="login" />);
  expect(second.container.querySelector('.logo-word')).toBeNull();
  expect(screen.getByRole('img', { name: 'Thesaurus' }).getAttribute('src')).toBe('/brand/thesaurus-logo.svg');
  second.unmount();
  expect(renderAt(<LogoIntro screen="demo" />).container.querySelector('.logo-word')).not.toBeNull();
});

test('a language switch keeps the same intro mounted and does not restart it', () => {
  const Switch = () => <button onClick={() => setLang('en')}>en</button>;
  let setLang: (l: 'en') => void = () => {};
  const Probe = () => { setLang = useT().setLang; return <><Switch /><LogoIntro screen="login" /></>; };
  const { container } = renderAt(<Probe />);
  const word = container.querySelector('.logo-word');
  fireEvent.click(screen.getByText('en'));
  expect(container.querySelector('.logo-word')).toBe(word);
  expect(screen.getAllByRole('img', { name: 'Thesaurus' })).toHaveLength(1);
});

test('the stylesheet animates only transform and opacity and has a reduced-motion block with no animation', () => {
  const css = text('web/components/logo-intro.css');
  expect([...css.matchAll(/@keyframes[^{]+\{([\s\S]*?\n\})/g)].join('')).not.toMatch(/\b(top|left|width|height|margin)\s*:/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
});
