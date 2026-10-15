import { defineConfig } from '@playwright/test'

// Runs against the deployed Worker: BASE_URL=https://... npx playwright test (AC-26).
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: process.env.BASE_URL, launchOptions: { slowMo: 300 } },
})
