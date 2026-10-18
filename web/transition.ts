import './components/transition.css';

/**
 * AC-109: the hand-over from /login, /demo or «Volver a mi empresa de prueba» into Bandeja, through the browser's View
 * Transitions API (R-148). Without it, or under reduced motion, the swap is instant. Timing lives in transition.css.
 */
const MS = 400; // the logo's move; equal to transition.css
let entry: Promise<void> = Promise.resolve();

/** The tour waits on this (AC-42 Clarified): it resolves when the last entry transition has ended, at once if none ran. */
export const entered = (): Promise<void> => entry;

const logoBox = () => document.querySelector('.vt-logo')?.getBoundingClientRect();

// The router renders in a React transition, so the new view exists only after its commit, not when navigate returns.
// ponytail: the first DOM change is the commit; a navigation that changes nothing is let go after 300 ms, so the page never freezes.
const committed = (navigate: () => void) =>
  new Promise<void>((resolve) => {
    const done = () => {
      seen.disconnect();
      clearTimeout(cap);
      resolve();
    };
    const seen = new MutationObserver(done);
    const cap = setTimeout(done, 300);
    seen.observe(document.body, { childList: true, subtree: true });
    navigate();
  });

export function enterApp(navigate: () => void): Promise<void> {
  if (typeof document.startViewTransition !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    navigate();
    return (entry = Promise.resolve());
  }
  const root = document.documentElement;
  let from: DOMRect | undefined;
  root.classList.add('entering'); // the view-transition-names exist only now, so they never make stacking contexts under the tour
  const vt = document.startViewTransition(() => {
    from = logoBox();
    return committed(navigate);
  });
  // The browser's own group animation also animates width and height; transition.css turns it off and this moves the logo
  // with transform only, from its box on the page to its box in the top bar.
  vt.ready
    .then(() => {
      const to = logoBox();
      if (!from || !to) return;
      root.animate(
        { transform: [`translate(${from.x}px, ${from.y}px) scale(${from.width / to.width})`, `translate(${to.x}px, ${to.y}px)`] },
        { duration: MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both', pseudoElement: '::view-transition-group(brand-logo)' },
      );
    })
    .catch(() => {}); // skipped (a duplicate name, a second click): the swap still happened, instantly
  const end = () => root.classList.remove('entering');
  return (entry = vt.finished.then(end, end));
}
