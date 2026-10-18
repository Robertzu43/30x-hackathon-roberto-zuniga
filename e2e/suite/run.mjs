/* global process */
// `npm run e2e`: runs e2e/suite with the local @playwright/test when installed, else the global Playwright (`npm root -g`).
import { spawnSync, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
let dir = process.env.PLAYWRIGHT_DIR;
if (!dir) { try { dir = req.resolve('@playwright/test/package.json').replace(/[\\/]package\.json$/, ''); } catch { dir = execSync('npm root -g').toString().trim() + '/playwright'; } }
const r = spawnSync(process.execPath, [`${dir}/cli.js`, 'test', '-c', 'e2e/suite/playwright.config.ts', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_DIR: dir } });
process.exit(r.status ?? 1);
