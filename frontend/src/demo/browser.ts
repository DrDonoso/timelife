/**
 * Starts the demo's API: the Mock Service Worker (public/mockServiceWorker.js) with the handlers.
 * main.tsx awaits it before the first render, because the app requests /api/auth/session at once
 * and a request that escaped the worker would reach the static host and get index.html back.
 */
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export async function startDemo(): Promise<void> {
  // Browsers only run service workers in a secure context (HTTPS or localhost) and not in some
  // private windows (Firefox): without one the demo has no API at all.
  if (!('serviceWorker' in navigator)) throw new Error('Service workers are not available in this browser context')
  await setupWorker(...handlers).start({
    serviceWorker: { url: '/mockServiceWorker.js' },
    quiet: true,
    // Scripts, styles, fonts and icons come from the static host; /api never gets here (catch-all).
    onUnhandledRequest: 'bypass',
  })
}
