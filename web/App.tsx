import { NavLink, Route, Routes } from 'react-router-dom';
import { useT } from './i18n';

const screens = [
  { path: '/', key: 'screen.inbox' },
  { path: '/invoices/:id', key: 'screen.invoice' },
  { path: '/policy', key: 'screen.policy' },
  { path: '/beneficiaries', key: 'screen.beneficiaries' },
  { path: '/period', key: 'screen.period' },
  { path: '/login', key: 'screen.login' },
  { path: '/demo', key: 'screen.demo' },
  { path: '/approve/:token', key: 'screen.approve' },
];

export default function App() {
  const { t, lang, setLang } = useT();
  return (
    <>
      <header className="topbar">
        <strong>{t('app.name')}</strong>
        <span className="muted">{t('app.tagline')}</span>
        <nav aria-label="idioma" className="lang">
          {(['es', 'en'] as const).map((l) => (
            <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {l}
            </button>
          ))}
        </nav>
      </header>
      <nav className="screens">
        {screens.filter((s) => !s.path.includes(':')).map((s) => (
          <NavLink key={s.path} to={s.path} end>
            {t(s.key)}
          </NavLink>
        ))}
      </nav>
      <main>
        <Routes>
          {screens.map((s) => (
            <Route
              key={s.path}
              path={s.path}
              element={
                <>
                  <h1>{t(s.key)}</h1>
                  <p className="muted">{t('screen.pending')}</p>
                </>
              }
            />
          ))}
        </Routes>
      </main>
    </>
  );
}
