import { defineConfig, devices } from '@playwright/test'

// Smoke test of the public demo: `npm run e2e:demo` builds it (`build:demo`) and serves the static
// bundle with `vite preview`, the same files Cloudflare serves. No backend, no database: the API
// is the MSW service worker, which browsers allow on localhost without HTTPS.
const PORT = 4180
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  testMatch: /demo\.spec\.ts$/,
  outputDir: './test-results/demo',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report/demo' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /demo\.spec\.ts$/, grep: /@mobile/ },
  ],
  webServer: {
    command: `npm run build:demo && npm run preview:demo -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
