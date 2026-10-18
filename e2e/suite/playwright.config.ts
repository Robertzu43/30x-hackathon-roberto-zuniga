// e2e suite (QA, Task 72): `npm run e2e` (E2E_BASE=<url>, default http://127.0.0.1:8787). Reports go to .wrangler/e2e-report (gitignored).
const vp = { m390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, d1440: { viewport: { width: 1440, height: 900 } } };
const projects = [];
for (const [size, use] of Object.entries(vp)) for (const lang of ['es', 'en']) projects.push({ name: `${size}-${lang}`, use: { ...use, lang, locale: lang === 'es' ? 'es-CO' : 'en-US' } });
export default {
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 180000,
  expect: { timeout: 15000 },
  workers: 2,
  retries: 1,
  fullyParallel: false,
  outputDir: '../../.wrangler/e2e-report/artifacts',
  reporter: [['list'], ['html', { outputFolder: '../../.wrangler/e2e-report/html', open: 'never' }], ['json', { outputFile: '../../.wrangler/e2e-report/results.json' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'off' },
  projects,
};
