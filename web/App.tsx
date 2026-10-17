import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { matchPath, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import type { Lang } from '../src/i18n';
import { supabase } from './api';
import { isDemoUser, RequireAuth, shouldStartTour, takeDemoTour, useSession } from './auth';
import Tour from './components/Tour';
import { useT } from './i18n';

/** Every web/pages/*.tsx exports `route` and a default component; nothing else registers a screen. */
export type PageRoute = { path: string; nav?: { key: string; order: number }; public?: boolean; fullBleed?: boolean };
type PageModule = { route: PageRoute; default: ComponentType };

export const pages = Object.values(import.meta.glob(['./pages/*.tsx', '!./pages/*.test.tsx'], { eager: true }) as Record<string, PageModule>);
const nav = pages.filter((p) => p.route.nav).sort((a, b) => a.route.nav!.order - b.route.nav!.order);

function TopBar({ onTour }: { onTour: () => void }) {
  const { t, lang, setLang } = useT();
  const { session } = useSession();
  const pick = (l: Lang) => {
    setLang(l);
    if (session) void supabase().then((sb) => sb.auth.updateUser({ data: { lang: l } })); // AC-41: per user
  };
  return (
    <header className="topbar">
      <strong>{t('app.name')}</strong>
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
            <button type="button" onClick={() => void supabase().then((sb) => sb.auth.signOut())}>{t('topbar.sign_out')}</button>
          </>
        )}
      </div>
    </header>
  );
}

function Shell({ onTour, children }: { onTour: () => void; children: ReactNode }) {
  const { t } = useT();
  const { session } = useSession();
  return (
    <>
      <TopBar onTour={onTour} />
      {session && (
        <nav className="screens" aria-label={t('nav.label')}>
          {nav.map(({ route }) => <NavLink key={route.path} to={route.path} end>{t(route.nav!.key)}</NavLink>)}
        </nav>
      )}
      <main>{children}</main>
    </>
  );
}

export default function App() {
  const { session, demoEmail } = useSession();
  const user = session?.user;
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
        {pages.map(({ route, default: Page }) => {
          const page = route.fullBleed ? <Page /> : <Shell onTour={startTour}><Page /></Shell>;
          return <Route key={route.path} path={route.path} element={route.public ? page : <RequireAuth>{page}</RequireAuth>} />;
        })}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {touring && user && !onPublic && <Tour onDone={endTour} />}
    </>
  );
}
