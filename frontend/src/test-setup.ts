import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Most tests render the whole app (router, react-query, react-aria, motion) in jsdom while ~30
// workers share the CPU: one async step (mocked fetch → render) can take well over the default
// 1 s, above all in the first test of a file. A failing wait still reports its own error, well
// before the test timeout (vite.config.ts).
configure({ asyncUtilTimeout: 4000 })

// The timeline's opening sweep plays once per browser session: tests start as if it had been seen
// already (the sweep's own tests clear the flag).
beforeEach(() => {
  sessionStorage.setItem('timelife.intro', '1')
})

// Vitest globals are off, so Testing Library cannot register its automatic cleanup on its own.
// Storage is cleared too: theme, language and child preferences must not leak between tests, and
// fake timers never outlive the test that installed them (even when it failed half-way).
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
  sessionStorage.clear()
})

// ---------------------------------------------------------------------------------------------
// Browser APIs that jsdom does not implement. Tests can still override any of them with
// vi.spyOn / vi.stubGlobal.

// matchMedia: width features are evaluated against window.innerWidth (jsdom defaults to 1024,
// i.e. desktop; set `window.innerWidth = 375` before rendering to get the mobile layout). User
// preferences report light / no-preference and the device has a fine, hover-capable pointer.
function evaluateMediaQuery(query: string): boolean {
  const width = window.innerWidth
  return query.split(',').some((part) =>
    Array.from(part.matchAll(/\(\s*([a-z-]+)\s*(?::\s*([^)]*))?\)/gi)).every(
      ([, feature = '', rawValue = '']) => {
        const value = rawValue.trim().toLowerCase()
        const pixels = Number.parseFloat(value) * (value.endsWith('em') ? 16 : 1)
        switch (feature.toLowerCase()) {
          case 'min-width':
            return width >= pixels
          case 'max-width':
            return width <= pixels
          case 'hover':
          case 'any-hover':
            return value === '' || value === 'hover'
          case 'pointer':
          case 'any-pointer':
            return value === '' || value === 'fine'
          case 'prefers-color-scheme':
            return value === 'light'
          case 'prefers-reduced-motion':
          case 'prefers-contrast':
          case 'prefers-reduced-transparency':
            return value === 'no-preference'
          default:
            return false
        }
      },
    ),
  )
}

type MediaQueryListener = ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null

class MediaQueryListStub extends EventTarget implements MediaQueryList {
  readonly media: string
  readonly matches: boolean
  onchange: MediaQueryListener = null

  constructor(query: string) {
    super()
    this.media = query
    this.matches = evaluateMediaQuery(query)
  }

  // Deprecated aliases that some libraries still call.
  addListener(listener: MediaQueryListener) {
    this.addEventListener('change', listener as EventListener | null)
  }

  removeListener(listener: MediaQueryListener) {
    this.removeEventListener('change', listener as EventListener | null)
  }
}

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => new MediaQueryListStub(query),
  })
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// Never reports intersections: lazy content stays in its initial state unless a test drives it.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    readonly root = null
    readonly rootMargin = '0px'
    readonly scrollMargin = '0px'
    readonly thresholds: readonly number[] = [0]
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }
}

function scrollElement(element: Element, left: number | undefined, top: number | undefined) {
  if (left !== undefined && Number.isFinite(left)) element.scrollLeft = left
  if (top !== undefined && Number.isFinite(top)) element.scrollTop = top
}

if (typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = function scrollTo(
    this: Element,
    x?: ScrollToOptions | number,
    y?: number,
  ) {
    if (typeof x === 'object') scrollElement(this, x.left, x.top)
    else scrollElement(this, x, y)
  }
}

if (typeof Element.prototype.scrollBy !== 'function') {
  Element.prototype.scrollBy = function scrollBy(
    this: Element,
    x?: ScrollToOptions | number,
    y?: number,
  ) {
    const delta = typeof x === 'object' ? x : { left: x, top: y }
    scrollElement(this, this.scrollLeft + (delta.left ?? 0), this.scrollTop + (delta.top ?? 0))
  }
}

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

// jsdom defines these but only logs "Not implemented"; make them silent no-ops.
window.scrollTo = () => {}
window.scrollBy = () => {}

if (typeof Element.prototype.setPointerCapture !== 'function') {
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.hasPointerCapture = () => false
}

// Neither jsdom nor Node can turn jsdom Blobs/Files into object URLs (upload previews).
let objectUrlCount = 0
URL.createObjectURL = () => `blob:http://localhost/timelife-test-${++objectUrlCount}`
URL.revokeObjectURL = () => {}

// jsdom does not play media (it only logs "Not implemented"): play() resolves at once and fires
// `play`/`playing`, pause() fires `pause` (as browsers do when the element was playing). Tests can
// spy on them, e.g. to reject play() with NotAllowedError like an autoplay policy.
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  writable: true,
  value: function play(this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false })
    this.dispatchEvent(new Event('play'))
    this.dispatchEvent(new Event('playing'))
    return Promise.resolve()
  },
})
Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  writable: true,
  value: function pause(this: HTMLMediaElement) {
    const wasPlaying = !this.paused
    Object.defineProperty(this, 'paused', { configurable: true, value: true })
    if (wasPlaying) this.dispatchEvent(new Event('pause'))
  },
})
Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, writable: true, value: () => {} })
