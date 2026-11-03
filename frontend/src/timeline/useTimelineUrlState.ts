import { useCallback, useLayoutEffect, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { parseNodeKey } from './model'
import type { TimelineViewChange } from './Timeline'
import { isZoomLevel, type ZoomLevel } from './types'

export interface TimelineUrlState {
  /** URL `zoom`, else the default level. */
  level: ZoomLevel
  /** Valid URL `focus` (`y2026`, `m2026-03`, `e123`) or `null`. */
  focus: string | null
  /**
   * Writes `zoom` + `focus`, keeping every other parameter (filters, …) and the router state
   * (e.g. the event detail's `originRect`).
   */
  setView: (view: TimelineViewChange) => void
}

/** Timeline zoom level and focused node, synced with the URL (`zoom`, `focus`). */
export function useTimelineUrlState(defaultLevel: ZoomLevel): TimelineUrlState {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const routerState = useRef<unknown>(location.state)
  useLayoutEffect(() => {
    routerState.current = location.state
  })
  const zoom = params.get('zoom')
  const rawFocus = params.get('focus')
  const setView = useCallback(
    ({ level, focus }: TimelineViewChange) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          next.set('zoom', level)
          if (focus) next.set('focus', focus)
          else next.delete('focus')
          return next
        },
        { replace: true, preventScrollReset: true, state: routerState.current },
      ),
    [setParams],
  )
  return {
    level: isZoomLevel(zoom) ? zoom : defaultLevel,
    focus: parseNodeKey(rawFocus) ? rawFocus : null,
    setView,
  }
}
