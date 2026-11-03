import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { BASE_URL, E2E_PORT } from './e2e/server'

// End-to-end suite: `npm run build`, then `npm run e2e`. Playwright boots an isolated backend with
// fresh demo data that also serves the built SPA (scripts/e2e_server.py).
const repoRoot = path.resolve(import.meta.dirname, '..')
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 45_000,
  expect: { timeout: 10_000, toPass: { timeout: 15_000 } },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Signs the development admin and viewer in once; the other projects reuse their sessions.
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    // Read-only suites (the a11y trash check only adds and purges its own event of the second
    // child): they run in parallel with everything.
    { name: 'desktop', use: desktop, dependencies: ['setup'], testMatch: /(timeline|a11y)\.spec\.ts$/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, dependencies: ['setup'], testMatch: /timeline\.spec\.ts$/ },
    // Suites that sign in/out or change data run one at a time: they share the server's database
    // and its per-client limit of concurrent mutations.
    {
      name: 'flows',
      use: desktop,
      dependencies: ['setup'],
      testMatch: /(auth|event-flow|media|admin)\.spec\.ts$/,
      workers: 1,
    },
  ],
  webServer: {
    command: `uv run --no-sync python scripts/e2e_server.py --port ${E2E_PORT}`,
    cwd: repoRoot,
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
})
