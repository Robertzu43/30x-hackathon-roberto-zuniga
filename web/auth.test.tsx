import { screen, waitFor } from '@testing-library/react';
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

test('tour starts for a user who has not seen it, not after it was seen, and always for the demo user (R-17)', () => {
  expect(shouldStartTour(fakeSession('ana@empresa.co').user, DEMO_EMAIL)).toBe(true);
  expect(shouldStartTour(fakeSession('ana@empresa.co', { tour_seen: true }).user, DEMO_EMAIL)).toBe(false);
  expect(shouldStartTour(fakeSession(DEMO_EMAIL, { tour_seen: true }).user, DEMO_EMAIL)).toBe(true);
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

test('a language picked in this browser is stored on the user (AC-41)', async () => {
  localStorage.setItem('lang', 'en');
  signedInAs('ana@empresa.co', { lang: 'es' });
  renderAt(<Lang />);
  await waitFor(() => expect(fakeAuth.updateUser).toHaveBeenCalledWith({ data: { lang: 'en' } }));
  expect(screen.getByText('lang:en')).toBeTruthy();
});
