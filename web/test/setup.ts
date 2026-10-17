import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { mockApi } from './utils';
import { resetFakeAuth } from './supabase';

vi.mock('@supabase/supabase-js', async () => {
  const { fakeAuth } = await import('./supabase');
  return { createClient: () => ({ auth: fakeAuth }) };
});

Element.prototype.scrollIntoView = () => {}; // not implemented by jsdom
configure({ asyncUtilTimeout: 3000 }); // findBy*/waitFor: parallel builders load the machine; 1 s flaked

beforeEach(() => {
  mockApi(); // answers GET /api/config; a test calls mockApi(routes) again to add its own routes
});

afterEach(() => {
  cleanup();
  resetFakeAuth();
  vi.unstubAllGlobals();
  vi.restoreAllMocks(); // spies only (vi.spyOn)
  localStorage.clear();
  sessionStorage.clear();
});
