import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { matchPath, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Lang } from '../src/i18n';
import { cacheOwner, prefetch, screens, supabase } from './api';
import { isDemoUser, RequireAuth, shouldStartTour, takeDemoTour, useSession } from './auth';
import Logo from './components/Logo';
import Tour from './components/Tour';
import { useT } from './i18n';

/**
 * The screens, in nav order. Each page is its own chunk, fetched on navigation (AC-99); `data` is its one screen request
 * (AC-98), which a hover or focus on its nav link prefetches with the chunk (AC-100). Nothing else registers a screen.
 */
export type PageRoute = { path: string; load: () => Promise<{ default: ComponentType }>; nav?: string; data?: () => string; public?: boolean; fullBleed?: boolean };
export const routes: PageRoute[] = [
  { path: '/', nav: 'screen.inbox', load: () => import('./pages/Inbox'), data: screens.inbox },
  { path: '/policy', nav: 'screen.policy', load: () => import('./pages/Policy'), data: screens.policy },
  { path: '/beneficiaries', nav: 'screen.beneficiaries', load: () => import('./pages/Beneficiaries'), data: screens.beneficiaries },
  { path: '/period', nav: 'screen.period', load: () => import('./pages/Period'), data: () => screens.period() },
  { path: '/invoices/:id', load: () => import('./pages/InvoiceDetail') },
  // Task 50 mounts the beneficiary profile here; until then the directory.
  { path: '/beneficiaries/:id', load: async () => ({ default: () => <Navigate to="/beneficiaries" replace /> }) },
  { path: '/login', public: true, fullBleed: true, load: () => import('./pages/Login') },
  { path: '/demo', public: true, fullBleed: true, load: () => import('./pages/Demo') },
  { path: '/approve/:token', public: true, load: () => import('./pages/Approve') },
];
const pages = routes.map((r) => ({ route: r, Page: lazy(r.load) }));
const nav = routes.filter((r) => r.nav);
const warm = (r: PageRoute) => {
  r.load().catch(() => {}); // offline: the click shows the error
  if (r.data) prefetch(r.data());
};

function Loading() {
  const { t } = useT();
  return <p role="status" className="muted">{t('app.loading')}</p>;
}

function TopBar({ onTour }: { onTour: () => void }) {
  const { t, lang, setLang } = useT();
  const { session, demoEmail } = useSession();
  const navigate = useNavigate();
  // Leave first, so the session ending finds us on /login: RequireAuth's own redirect would carry this page as `from` (R-62) to the next user.
  const signOut = () => {
    navigate('/login', { replace: true });
    void supabase().then((sb) => sb.auth.signOut());
  };
  const pick = (l: Lang) => {
    const demo = isDemoUser(session?.user, demoEmail); // R-78: the shared demo user's language lives in this tab only
    setLang(l, demo);
    if (session && !demo) void supabase().then((sb) => sb.auth.updateUser({ data: { lang: l } })); // AC-41: per user
  };
  return (
    <header className="topbar">
      <Logo />
      <span className="muted">{t('app.tagline')}</span>
      <div className="topbar-actions">
        <div className="lang" role="group" aria-label={t('topbar.language')}>
          {(['es', 'en'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => pick(l)}>{l}</button>
          ))}
        </div>
        {session && (
          <>
            <button type="button" onClick={onTour}>{t('topbar.tour')}</button>
            <span className="muted">{session.user.email}</span>
            <button type="button" onClick={signOut}>{t('topbar.sign_out')}</button>
          </>
        )}
      </div>
    </header>
  );
}

function Shell({ onTour, children }: { onTour: () => void; children: ReactNode }) {
  const { t, lang } = useT();
  const { session } = useSession();
  return (
    <>
      <TopBar onTour={onTour} />
      {session && (
        <nav className="screens" aria-label={t('nav.label')}>
          {nav.map((r) => <NavLink key={r.path} to={r.path} end onMouseEnter={() => warm(r)} onFocus={() => warm(r)}>{t(r.nav!)}</NavLink>)}
        </nav>
      )}
      <main key={lang}>{children}</main>{/* R-98: a language switch remounts the screen, which re-fetches its record in that language */}
    </>
  );
}

export default function App() {
  const { session, demoEmail } = useSession();
  const user = session?.user;
  cacheOwner(user?.id); // AC-100: before any screen reads the per-tab cache, a different user drops it
  const [touring, setTouring] = useState(false);

  const { pathname } = useLocation();
  useEffect(() => setTouring(!!user && shouldStartTour(user, demoEmail)), [user?.id, demoEmail]); // keyed on the id: USER_UPDATED (tour_seen) must not restart it
  // R-62: the demo click may sign in the same user id again, so the marker is also checked when the click navigates.
  useEffect(() => {
    if (isDemoUser(user, demoEmail) && takeDemoTour()) setTouring(true);
  }, [user?.id, demoEmail, pathname]);

  const endTour = () => {
    setTouring(false);
    if (user && !isDemoUser(user, demoEmail)) void supabase().then((sb) => sb.auth.updateUser({ data: { tour_seen: true } }));
  };
  const startTour = () => setTouring(true);
  // One Tour outside <Routes> keeps its step across navigation; it never shows on public pages (/demo, /approve).
  const onPublic = pages.find((p) => matchPath(p.route.path, pathname))?.route.public;

  return (
    <>
      <Routes>
        {pages.map(({ route, Page }) => {
          const loaded = <Suspense fallback={<Loading />}><Page /></Suspense>;
          const page = route.fullBleed ? loaded : <Shell onTour={startTour}>{loaded}</Shell>;
          return <Route key={route.path} path={route.path} element={route.public ? page : <RequireAuth>{page}</RequireAuth>} />;
        })}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {touring && user && !onPublic && <Tour onDone={endTour} />}
    </>
  );
}
