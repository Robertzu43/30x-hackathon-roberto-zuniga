import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useT } from '../i18n';
import { tourSteps } from '../tour-steps';

// ponytail: polls for the anchor while the page loads its data; a step still missing after this is skipped.
const WAIT_MS = 1500;
const PAD = 8;

/** AC-42 guided tour, no library: a positioned box whose huge box-shadow dims everything but the target. */
export default function Tour({ onDone }: { onDone: () => void }) {
  const { t, lang } = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  // R-105: the cue shows only while the body overflows and is not scrolled to its end.
  const cue = () => {
    const b = body.current;
    setMore(!!b && b.scrollHeight > b.clientHeight && b.scrollTop + b.clientHeight < b.scrollHeight - 1);
  };
  useLayoutEffect(cue, [rect, i, lang]);
  // UX-03: the card (a bottom sheet on a phone) never covers the highlighted block. When they share columns, the block is
  // scrolled into the room between the top bar and the card (centred if it fits, else its start), and the spotlight stops
  // above the card. offsetTop ignores tour-in's slide; a card with no layout (jsdom) is skipped. The block is re-measured in
  // the same frame as the scroll, so the spotlight never paints at its old place (a layout shift); only when the page moved.
  const card = useRef<HTMLElement>(null);
  const target = useRef<Element | null>(null);
  const [floor, setFloor] = useState(Infinity);
  useLayoutEffect(() => {
    const c = card.current;
    if (!rect || !c?.offsetHeight) return;
    const box = c.getBoundingClientRect();
    if (rect.left + rect.width <= box.left || rect.left >= box.left + box.width) return setFloor(Infinity);
    const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + PAD;
    const bottom = c.offsetTop - PAD;
    setFloor(bottom);
    const want = rect.height <= bottom - top ? top + (bottom - top - rect.height) / 2 : top;
    if (Math.abs(rect.top - want) <= 1) return;
    const y = scrollY;
    scrollBy(0, rect.top - want);
    if (scrollY !== y && target.current) setRect(target.current.getBoundingClientRect());
  }, [rect]);
  const step = tourSteps[i]!;
  const last = i === tourSteps.length - 1;

  const go = (d: 1 | -1) => {
    const n = i + d;
    if (n >= tourSteps.length) return onDone();
    setDir(n < 0 ? 1 : d);
    setI(n < 0 ? i + 1 : n);
  };

  // R-78: Escape does what "Saltar" does.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onDone();
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onDone]);

  useEffect(() => {
    if (pathname !== step.route) navigate(step.route);
  }, [step, pathname, navigate]);

  useEffect(() => {
    setRect(null);
    let el: Element | null = null;
    const measure = () => el && setRect(el.getBoundingClientRect());
    const since = Date.now();
    const find = () => {
      el = target.current = document.querySelector(step.selector);
      if (el) {
        clearInterval(timer);
        el.scrollIntoView({ block: 'center' });
        measure();
      } else if (Date.now() - since > WAIT_MS) {
        clearInterval(timer);
        go(dir);
      }
    };
    const timer = setInterval(find, 50);
    find();
    addEventListener('resize', measure);
    addEventListener('scroll', measure, true);
    // R-144: the page re-renders under the spotlight as the first-login pass refreshes its data; measure again after each change.
    const changes = new MutationObserver(measure);
    changes.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      clearInterval(timer);
      changes.disconnect();
      removeEventListener('resize', measure);
      removeEventListener('scroll', measure, true);
    };
  }, [i]); // re-find only when the step changes

  return (
    <div className={rect ? 'tour' : 'tour tour-waiting'}>
      {rect && (
        <>
          <div
            className="tour-spotlight"
            style={{
              top: `${rect.top - PAD}px`,
              left: `${rect.left - PAD}px`,
              width: `${rect.width + 2 * PAD}px`,
              height: `${Math.min(rect.top + rect.height + PAD, floor) - (rect.top - PAD)}px`,
              boxShadow: '0 0 0 9999px rgba(0,0,0,.6)',
            }}
          />
          <section
            key={i}
            ref={card}
            className="tour-card"
            style={{ '--tour-top': `${document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0}px` } as CSSProperties}
            role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-label={t('tour.label')}>
            <header>
              <p className="muted">{t('tour.count', { n: i + 1, total: tourSteps.length })}</p>
              <h2 id="tour-title">{t(`tour.${step.id}.title`)}</h2>
            </header>
            <div className="tour-body" tabIndex={0} ref={body} onScroll={cue}>
              <p>{t(`tour.${step.id}.body`)}</p>
              {more && <span className="tour-more muted">{t('tour.more')}</span>}
            </div>
            <div className="tour-actions">
              <button type="button" className="link" onClick={onDone}>{t('tour.skip')}</button>
              <span />
              {i > 0 && <button type="button" onClick={() => go(-1)}>{t('tour.back')}</button>}
              <button type="button" className="primary" autoFocus onClick={() => go(1)}>{t(last ? 'tour.done' : 'tour.next')}</button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
