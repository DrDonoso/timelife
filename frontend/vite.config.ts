import react from '@vitejs/plugin-react'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// Backend that `vite` (and `vite preview`) forwards /api to. Every agent and developer runs their
// own uvicorn, e.g. `$env:VITE_API_TARGET="http://127.0.0.1:7801"; npx vite --port 5181 --strictPort`.
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:7779'

/**
 * Security headers of the static demo: `CONTENT_SECURITY_POLICY` and `SECURITY_HEADERS` of
 * src/timelife/middleware.py (keep them in step), plus `worker-src` for the MSW service worker and
 * `media-src blob:` for the videos read in the browser (their poster frames).
 */
const DEMO_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

/**
 * Cloudflare `_headers` for `dist-demo/`. Emitted here rather than kept in public/, which is also
 * copied into the production bundle. The SPA fallback lives in wrangler.jsonc
 * (`not_found_handling`): a `/* /index.html 200` rule in `_redirects` is rejected by Cloudflare as
 * an infinite loop.
 */
function demoStaticHostHeaders(outDir: string): Plugin {
  const headers = [
    // The worker IS the demo's API: never serve a stale copy.
    '/mockServiceWorker.js',
    '  Cache-Control: no-cache',
    '',
    // Content-hashed by Vite.
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/*',
    `  Content-Security-Policy: ${DEMO_CSP}`,
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: no-referrer',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '',
  ].join('\n')
  return {
    name: 'timelife:demo-static-host-headers',
    apply: 'build',
    async closeBundle() {
      await writeFile(path.resolve(import.meta.dirname, outDir, '_headers'), headers, 'utf8')
    },
  }
}

/** public/mockServiceWorker.js is copied into every build: only the demo may ship it. */
function withoutMockServiceWorker(outDir: string): Plugin {
  return {
    name: 'timelife:without-mock-service-worker',
    apply: 'build',
    async closeBundle() {
      await rm(path.resolve(import.meta.dirname, outDir, 'mockServiceWorker.js'), { force: true })
    },
  }
}

/** The demo data is in English, so its page is too (the visitor can still switch to Spanish). */
function demoIndexHtml(): Plugin {
  return {
    name: 'timelife:demo-index-html',
    transformIndexHtml: (html) =>
      html
        .replace('<html lang="es">', '<html lang="en">')
        .replace(
          '<meta name="description" content="Los hitos de nuestra familia" />',
          '<meta name="description" content="Timelife demo: a family milestones timeline with sample data" />',
        )
        .replace('<title>Timelife</title>', '<title>Timelife demo</title>'),
  }
}

export default defineConfig(({ mode }) => {
  // `--mode demo` (frontend/.env.demo): the static public demo, built into its own folder so it
  // never overwrites the production bundle.
  const demo = mode === 'demo'
  const outDir = demo ? 'dist-demo' : 'dist'
  return {
    plugins: [react(), ...(demo ? [demoIndexHtml(), demoStaticHostHeaders(outDir)] : [withoutMockServiceWorker(outDir)])],
    define: {
      // Shown as the demo's "version" date (src/demo/handlers.ts).
      __DEMO_BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    build: {
      outDir,
      rolldownOptions: {
        output: {
          // Long-lived vendor chunks (cached across app releases). The react-aria and icon groups only
          // take what the first page needs (`$initial`); the rest stays with the lazy routes (admin,
          // event detail, editor). Each group also takes the dependencies of the modules it captures.
          codeSplitting: {
            groups: [
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 40 },
              {
                name: 'react-aria',
                test: /node_modules[\\/](react-aria|react-aria-components|react-stately|@internationalized)[\\/]/,
                tags: ['$initial'],
                priority: 30,
              },
              { name: 'motion', test: /node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/, priority: 20 },
              { name: 'query', test: /node_modules[\\/]@tanstack[\\/]/, priority: 20 },
              { name: 'icons', test: /node_modules[\\/]@tabler[\\/]/, tags: ['$initial'], priority: 10 },
              // The demo's picture painter (src/demo/art), apart from its mock API.
              ...(demo ? [{ name: 'demo-art', test: /[\\/]src[\\/]demo[\\/]art[\\/]/, priority: 10 }] : []),
            ],
          },
        },
      },
    },
    server: demo
      ? {}
      : {
          proxy: {
            '/api': {
              target: apiTarget,
              // Rewrites only the Host header (the backend accepts loopback hosts). The browser's Origin
              // header is forwarded untouched, so the backend's CSRF check compares it with PUBLIC_ORIGIN,
              // which must list this dev server's origin(s). Do not enable `rewriteWsOrigin`.
              changeOrigin: true,
            },
          },
        },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // Interaction-heavy full-app tests take a few seconds when the whole suite runs in parallel;
      // findBy*/waitFor give up after 4 s (src/test-setup.ts), well before this.
      testTimeout: 20_000,
      // Isolation between tests: spies restored, mock call history cleared, vi.stubGlobal/stubEnv undone.
      restoreMocks: true,
      clearMocks: true,
      unstubGlobals: true,
      unstubEnvs: true,
      // CSS is not processed in tests; CSS Module imports resolve to a proxy returning the class
      // name unchanged (`styles.card === 'card'`), so components render and selectors stay readable.
      css: { modules: { classNameStrategy: 'non-scoped' } },
    },
  }
})
