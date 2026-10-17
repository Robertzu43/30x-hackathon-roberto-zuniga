import { defineConfig } from 'vitest/config';

// Two projects: the Worker in node, the SPA in jsdom. `npm test` runs both.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'worker', include: ['src/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'scripts', include: ['scripts/**/*.test.mjs'], environment: 'node', testTimeout: 60_000, hookTimeout: 60_000 } },
      { test: { name: 'web', include: ['web/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['web/test/setup.ts'] } },
    ],
  },
});
