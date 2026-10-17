import { act, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { RequireAuth, shouldStartTour, useSession } from './auth';
import { useT } from './i18n';
import { DEMO_EMAIL, fakeAuth, renderAt, signedInAs } from './test/utils';
import { fakeSession } from './test/supabase';

const guarded = (
  <Routes>
    <Route path="/login" element={<p>login page</p>} />
    <Route path="/" element={<RequireAuth><p>private page</p></RequireAuth>} />
  </Routes>
);

test('RequireAuth sends a visitor without a session to /login', async () => {
  renderAt(guarded);
  expect(await screen.findByText('login page')).toBeTruthy();
  expect(screen.queryByText('private page')).toBeNull();
});

test('RequireAuth renders the page for a signed-in user', async () => {
  signedInAs('ana@empresa.co');
  renderAt(guarded);
  expect(await screen.findByText('private page')).toBeTruthy();
});

test('useSession exposes the session and the demo email from /api/config', async () => {
  signedInAs('ana@empresa.co');
  function Probe() {
    const { session, demoEmail } = useSession();
    return <p>{`${session?.user.email} ${demoEmail}`}</p>;
  }
  renderAt(<Probe />);
  expect(await screen.findByText(`ana@empresa.co ${DEMO_EMAIL}`)).toBeTruthy();
});

test('tour starts for a user who has not seen it, not after it was seen, and never on its own for the demo user (R-62)', () => {
  expect(shouldStartTour(fakeSession('ana@empresa.co').user, DEMO_EMAIL)).toBe(true);
  expect(shouldStartTour(fakeSession('ana@empresa.co', { tour_seen: true }).user, DEMO_EMAIL)).toBe(false);
  expect(shouldStartTour(fakeSession(DEMO_EMAIL).user, DEMO_EMAIL)).toBe(false);
});

function Lang() {
  return <p>lang:{useT().lang}</p>;
}

test('a stored per-user language is applied when this browser has no choice yet (AC-41)', async () => {
  signedInAs('ana@empresa.co', { lang: 'en' });
  renderAt(<Lang />);
  expect(await screen.findByText('lang:en')).toBeTruthy();
  expect(fakeAuth.updateUser).not.toHaveBeenCalled();
});

test('a stale browser choice never beats the language the user saved, and is not written over it (AC-41)', async () => {
  localStorage.setItem('lang', 'es');
  signedInAs('ana@empresa.co', { lang: 'en' });
  renderAt(<Lang />);
  expect(await screen.findByText('lang:en')).toBeTruthy();
  expect(fakeAuth.updateUser).not.toHaveBeenCalled();
});

test('a user with no saved language keeps the browser language and nothing is written (AC-41)', async () => {
  localStorage.setItem('lang', 'en');
  signedInAs('ana@empresa.co');
  renderAt(<Lang />);
  expect(await screen.findByText('lang:en')).toBeTruthy();
  expect(fakeAuth.updateUser).not.toHaveBeenCalled();
});

test('a second user on the same browser inherits nothing from the first (AC-41)', async () => {
  signedInAs('ana@empresa.co', { lang: 'en' });
  renderAt(<Lang />);
  expect(await screen.findByText('lang:en')).toBeTruthy();
  const emit = fakeAuth.onAuthStateChange.mock.calls[0]![0];
  act(() => emit('SIGNED_OUT', null));
  act(() => emit('SIGNED_IN', fakeSession('bea@empresa.co', { lang: 'es' })));
  expect(await screen.findByText('lang:es')).toBeTruthy();
  expect(fakeAuth.updateUser).not.toHaveBeenCalled();
});

test('the shared demo user stored language is ignored: the tab keeps its own (R-78)', async () => {
  signedInAs(DEMO_EMAIL, { lang: 'en' });
  function Probe() {
    return <p>{`lang:${useT().lang} ${useSession().session?.user.email}`}</p>;
  }
  renderAt(<Probe />);
  await screen.findByText(`lang:es ${DEMO_EMAIL}`);
  await act(async () => {});
  expect(screen.getByText(`lang:es ${DEMO_EMAIL}`)).toBeTruthy();
});
