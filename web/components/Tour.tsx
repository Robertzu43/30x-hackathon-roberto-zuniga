import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useT } from '../i18n';
import { tourSteps } from '../tour-steps';

// ponytail: polls for the anchor while the page loads its data; a step still missing after this is skipped.
const WAIT_MS = 1500;
const PAD = 8;

/** AC-42 guided tour, no library: a positioned box whose huge box-shadow dims everything but the target. */
export default function Tour({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = tourSteps[i]!;
  const last = i === tourSteps.length - 1;

  const go = (d: 1 | -1) => {
    const n = i + d;
    if (n >= tourSteps.length) return onDone();
    setDir(n < 0 ? 1 : d);
    setI(n < 0 ? i + 1 : n);
  };

  useEffect(() => {
    if (pathname !== step.route) navigate(step.route);
  }, [step, pathname, navigate]);

  useEffect(() => {
    setRect(null);
    let el: Element | null = null;
    const measure = () => el && setRect(el.getBoundingClientRect());
    const since = Date.now();
    const find = () => {
      el = document.querySelector(step.selector);
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
    return () => {
      clearInterval(timer);
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
              height: `${rect.height + 2 * PAD}px`,
              boxShadow: '0 0 0 9999px rgba(0,0,0,.6)',
            }}
          />
          <section key={i} className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-label={t('tour.label')}>
            <p className="muted">{t('tour.count', { n: i + 1, total: tourSteps.length })}</p>
            <h2 id="tour-title">{t(`tour.${step.id}.title`)}</h2>
            <p>{t(`tour.${step.id}.body`)}</p>
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
