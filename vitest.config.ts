import { defineConfig } from 'vitest/config';

// Two projects: the Worker in node, the SPA in jsdom. `npm test` runs both.
export default defineConfig({
  test: {
    projects: [
      // 'cloudflare:workers' exists only in workerd; PortalApi's base class gets a stand-in (src/__fixtures__).
      { resolve: { alias: { 'cloudflare:workers': new URL('./src/__fixtures__/cloudflare-workers.ts', import.meta.url).pathname } },
        test: { name: 'worker', include: ['src/**/*.test.ts', 'portal/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'scripts', include: ['scripts/**/*.test.mjs'], environment: 'node', testTimeout: 60_000, hookTimeout: 60_000 } },
      { test: { name: 'web', include: ['web/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['web/test/setup.ts'] } },
    ],
  },
});
