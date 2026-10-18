import { afterEach, describe, expect, it, vi } from 'vitest';
import { entered, enterApp } from './transition';

// A View Transition stand-in: runs the update callback like the browser does, and lets the test end the animation.
function fakeViewTransitions() {
  let end = () => {};
  const finished = new Promise<void>((r) => (end = r));
  let update: Promise<unknown> = Promise.resolve();
  const start = vi.fn((cb: () => Promise<void>) => {
    update = cb();
    const ready = update.then(() => undefined);
    return { finished: update.then(() => finished), ready, updateCallbackDone: update, skipTransition: () => {} };
  });
  Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true });
  return { start, end, updated: () => update };
}
const reducedMotion = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q === '(prefers-reduced-motion: reduce)' }));
const page = () => document.body.appendChild(document.createElement('main'));

afterEach(() => {
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  document.documentElement.className = '';
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('enterApp (AC-109)', () => {
  it('navigates at once, with no transition, when the browser has no View Transitions', async () => {
    const navigate = vi.fn();
    const done = enterApp(navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    await done;
    expect(document.documentElement.classList.contains('entering')).toBe(false);
  });

  it('navigates at once, with no transition, under prefers-reduced-motion: reduce', async () => {
    const { start } = fakeViewTransitions();
    reducedMotion(true);
    const navigate = vi.fn();
    const done = enterApp(navigate);
    expect(start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
    await done;
  });

  it('runs the navigation inside one view transition, named only while it runs', async () => {
    const vt = fakeViewTransitions();
    reducedMotion(false);
    const navigate = vi.fn(page);
    const done = enterApp(navigate);
    expect(vt.start).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1); // inside the callback the browser called
    expect(document.documentElement.classList.contains('entering')).toBe(true);
    await vt.updated();
    vt.end();
    await done;
    expect(document.documentElement.classList.contains('entering')).toBe(false);
  });

  it('captures the new view once the navigation has changed the page, never on data', async () => {
    const vt = fakeViewTransitions();
    let rendered = false;
    enterApp(() => setTimeout(() => { page(); rendered = true; }, 20)); // the router commits after navigate returns
    await vt.updated();
    expect(rendered).toBe(true);
  });

  it('does not hold the page frozen when the navigation changes nothing', async () => {
    vi.useFakeTimers();
    const vt = fakeViewTransitions();
    let captured = false;
    enterApp(() => {});
    void vt.updated().then(() => (captured = true));
    await vi.advanceTimersByTimeAsync(299);
    expect(captured).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(captured).toBe(true);
  });

  it('moves the logo from its page box to its top-bar box with transform only', async () => {
    const vt = fakeViewTransitions();
    const animate = vi.fn();
    document.documentElement.animate = animate;
    const logo = (x: number, y: number, width: number) => {
      const img = document.body.appendChild(document.createElement('img'));
      img.className = 'vt-logo';
      img.getBoundingClientRect = () => ({ x, y, width, height: width / 5 }) as DOMRect;
    };
    logo(600, 300, 320);
    const done = enterApp(() => { document.body.innerHTML = ''; logo(16, 12, 160); });
    await vt.updated();
    await Promise.resolve();
    expect(animate).toHaveBeenCalledWith(
      { transform: ['translate(600px, 300px) scale(2)', 'translate(16px, 12px)'] },
      expect.objectContaining({ duration: 400, pseudoElement: '::view-transition-group(brand-logo)' }),
    );
    vt.end();
    await done;
  });
});

describe('entered (AC-109, AC-42: the tour waits for it)', () => {
  it('replaces the browser\'s image animations, which also animate mix-blend-mode, with opacity and transform only', async () => {
    // read from disk: a ?raw CSS import is empty under vitest (css processing off)
    const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
    const css = readFileSync('web/components/transition.css', 'utf8');
    expect(css).toMatch(/\.entering::view-transition-old\(\*\) \{ animation-name: vt-fade-out; \}/);
    expect(css).toMatch(/\.entering::view-transition-new\(\*\) \{ animation-name: vt-fade-in; \}/);
    expect(css).toMatch(/\.entering::view-transition-new\(brand-logo\) \{ animation-name: none; \}/); // the logo only moves
    const props = [...css.matchAll(/@keyframes [\w-]+ \{(.*)\}/g)].flatMap((m) => [...m[1]!.matchAll(/([a-z-]+):/g)].map((p) => p[1]!));
    expect(new Set(props)).toEqual(new Set(['opacity', 'transform']));
  });

  it('resolves only when the transition has ended', async () => {
    const vt = fakeViewTransitions();
    enterApp(page);
    let ended = false;
    void entered().then(() => (ended = true));
    await vt.updated();
    await new Promise((r) => setTimeout(r, 0));
    expect(ended).toBe(false);
    vt.end();
    await entered();
    expect(ended).toBe(true);
  });

  it('resolves at once when no transition ran', async () => {
    enterApp(() => {});
    await expect(entered()).resolves.toBeUndefined();
  });
});
