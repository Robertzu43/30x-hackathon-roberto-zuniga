import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useT } from '../i18n';
import { anchor, PHONE, tourSteps } from '../tour-steps';
import { hole, PAD, placeCard, type Placed, type Rect } from './spotlight';

// ponytail: polls for the anchor while the page loads its data; a step still missing after this is skipped.
const WAIT_MS = 1500;
const LOAD_MS = 6000; // how long a step waits for a skeleton (AC-99) to load before it counts as missing
const GAP = 8; // AC-117 4.cover: the card is this far from the lit area, and the lit area from the top bar
const EDGE = 16; // the card's margin to the screen's edges, on wide screens

type View = { i: number; h: Rect; pos: Placed | null };

/** AC-42 / AC-117 guided tour, no library: one lit area H whose shadow is the one dim layer, and the card beside H (spotlight.ts). */
export default function Tour({ onDone }: { onDone: () => void }) {
  const { t, lang } = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [view, setView] = useState<View | null>(null);
  const v = view?.i === i ? view : null; // a new step never paints at the last step's place
  const card = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  // R-105: the cue shows only while the body overflows and is not scrolled to its end.
  const cue = () => {
    const b = body.current;
    setMore(!!b && b.scrollHeight > b.clientHeight && b.scrollTop + b.clientHeight < b.scrollHeight - 1);
  };
  useLayoutEffect(cue, [v, i, lang]);
  const step = tourSteps[i]!;
  const lit = anchor(step, innerWidth);
  const last = i === tourSteps.length - 1;

  const close = () => {
    onDone();
    document.querySelector<HTMLElement>('[data-tour-opener]')?.focus(); // AC-117 4.keys: back on «Ver tutorial» (App.tsx)
  };
  const go = (d: 1 | -1) => {
    const n = i + d;
    if (n >= tourSteps.length) return close();
    setDir(n < 0 ? 1 : d);
    setI(n < 0 ? i + 1 : n);
  };

  // R-78, AC-117 4.keys: Escape does what «Saltar» does; → and ← step (← does nothing on step 1; → on the last step is «Terminar»);
  // Tab and Shift+Tab cycle inside the card only, wherever focus was.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close();
      if (e.key === 'ArrowRight') return go(1);
      if (e.key === 'ArrowLeft') return void (i > 0 && go(-1));
      if (e.key !== 'Tab' || !card.current) return;
      e.preventDefault();
      const stops = [...card.current.querySelectorAll<HTMLElement>('button, [tabindex="0"]')];
      const k = stops.indexOf(document.activeElement as HTMLElement), n = stops.length;
      stops[k < 0 ? (e.shiftKey ? n - 1 : 0) : (k + (e.shiftKey ? n - 1 : 1)) % n]?.focus();
    };
    addEventListener('keydown', keys);
    return () => removeEventListener('keydown', keys);
  });

  // AC-117 4.keys: each new step moves focus to the card's heading, in the frame it shows.
  useLayoutEffect(() => {
    if (v) heading.current?.focus({ preventScroll: true });
  }, [i, !!v]);

  useEffect(() => {
    if (pathname !== step.route) navigate(step.route);
  }, [step, pathname, navigate]);

  useLayoutEffect(() => { // before paint: a step on the same page never flashes the full dim
    let scrolled: Element | null = null;
    const start = Date.now();
    let since = start;
    // AC-117: H is the target T grown by PAD. The card goes below, above, right or left of H (spotlight.ts); on a phone CSS pins it to the
    // bottom (R-105). Before the step shows, the page scrolls so T sits in the room the card leaves, centred when it fits; again only when
    // T is a new element (the loaded table replacing its skeleton), never against the reader's own scrolling.
    const place = () => {
      const found = document.querySelector(`[data-tour="${anchor(step, innerWidth)}"]`), c = card.current;
      // A skeleton (AC-99, inert) is never lit: its page is still loading, so the step waits for it (and is not skipped meanwhile).
      const el = found?.closest('[inert]') ? null : found;
      if (found && !el && Date.now() - start < LOAD_MS) since = Date.now();
      if (!el || !c) return false;
      const vp = { width: document.documentElement.clientWidth || innerWidth, height: document.documentElement.clientHeight || innerHeight };
      const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + GAP;
      const size = { width: c.offsetWidth, height: c.offsetHeight }; // offset*: tour-in's slide is a transform, not counted
      const phone = innerWidth <= PHONE;
      if (el !== scrolled) {
        scrolled = el;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // sideways inside its own scroller (a table on a phone)
        const r = el.getBoundingClientRect(), hh = r.height + 2 * PAD;
        const floor = phone ? c.offsetTop - GAP : vp.height - EDGE;
        const stack = !phone && hh + GAP + size.height <= floor - top ? hh + GAP + size.height : hh; // H with the card under it, when both fit
        const dy = r.top - PAD - (top + Math.max(0, (floor - top - stack) / 2));
        if (Math.abs(dy) >= 1) scrollBy({ top: dy, behavior: 'instant' });
      }
      const h = hole(el.getBoundingClientRect(), PAD, vp);
      const p = phone ? null : placeCard({ ...h, left: h.left - EDGE }, size, { width: vp.width - 2 * EDGE, height: vp.height - EDGE }, top);
      const next: View = { i, h, pos: p && { ...p, left: p.left + EDGE } };
      setView((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
      return true;
    };
    const timer = place() ? undefined : setInterval(() => {
      if (place()) clearInterval(timer);
      else if (Date.now() - since > WAIT_MS) {
        clearInterval(timer);
        go(dir);
      }
    }, 50);
    const follow = () => void place();
    addEventListener('resize', follow);
    addEventListener('scroll', follow, true);
    // R-144: the page re-renders under the tour as the first-login pass refreshes its data; place again after each change.
    const changes = new MutationObserver(follow);
    changes.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      clearInterval(timer);
      changes.disconnect();
      removeEventListener('resize', follow);
      removeEventListener('scroll', follow, true);
    };
  }, [i]); // re-find only when the step changes

  // Moved with `translate`, never top/left: a transform is not a layout shift, so following the target costs no CLS (AC-91 item 4).
  const at = v?.pos && { left: 0, top: 0, bottom: 'auto', translate: `${v.pos.left}px ${v.pos.top}px` };
  return (
    <div className={v ? 'tour' : 'tour tour-waiting'}>
      {v && (
        <div className="tour-spotlight" data-tour-dim="" data-tour-hole=""
          style={{ left: 0, top: 0, translate: `${v.h.left}px ${v.h.top}px`, width: `${v.h.width}px`, height: `${v.h.height}px`, boxShadow: '0 0 0 9999px rgba(0,0,0,.6)' }} />
      )}
      <section
        key={i}
        ref={card}
        className="tour-card"
        data-tour-step={lit}
        style={{ '--tour-top': `${document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0}px`, ...at, ...(!v && { visibility: 'hidden' }) } as CSSProperties}
        role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-label={t('tour.label')}>
        <header>
          <p className="muted">{t('tour.count', { n: i + 1, total: tourSteps.length })}</p>
          <h2 id="tour-title" tabIndex={-1} ref={heading}>{t(`tour.${step.id}.title`)}</h2>
          {/* AC-115 (R-170): decoration only, never a tap target or a focus stop */}
          <span className="tour-dots" aria-hidden="true">{tourSteps.map((s, k) => <span key={s.id} className={k === i ? 'on' : undefined} />)}</span>
        </header>
        <div className="tour-body" tabIndex={0} ref={body} onScroll={cue}>
          <p>{t(`tour.${step.id}.body`)}</p>
          {more && <span className="tour-more muted">{t('tour.more')}</span>}
        </div>
        <div className="tour-actions">
          <button type="button" className="link" onClick={close}>{t('tour.skip')}</button>
          <span />
          {i > 0 && <button type="button" onClick={() => go(-1)}>{t('tour.back')}</button>}
          <button type="button" className="primary" onClick={() => go(1)}>{t(last ? 'tour.done' : 'tour.next')}</button>
        </div>
      </section>
    </div>
  );
}
