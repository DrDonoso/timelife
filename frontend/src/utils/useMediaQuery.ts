import { useCallback, useSyncExternalStore } from 'react'

/** Matches the CSS breakpoint `@media (max-width: 767px)`. */
export const MOBILE_QUERY = '(max-width: 767px)'

function getMediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(query)
}

/** Live result of a CSS media query (re-renders when it changes). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = getMediaQueryList(query)
      if (!list) return () => {}
      list.addEventListener('change', onChange)
      // Width queries also follow window resizes (the test stub evaluates against innerWidth).
      window.addEventListener('resize', onChange)
      return () => {
        list.removeEventListener('change', onChange)
        window.removeEventListener('resize', onChange)
      }
    },
    [query],
  )
  const getSnapshot = useCallback(() => getMediaQueryList(query)?.matches ?? false, [query])
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/** `true` below 768 px (vertical timeline, compact header, full-screen modals). */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}

/** `true` when the primary pointer can hover (mouse / trackpad). */
export function useCanHover(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)')
}
