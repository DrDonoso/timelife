import { createContext, lazy, Suspense, use, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import { Outlet } from 'react-router'
import type { WhatsNewProps } from './WhatsNew'

export interface WhatsNewMenu {
  /** Shows every note, newest first (the account menu's «Novedades»). */
  openAll: () => void
}

const WhatsNewMenuContext = createContext<WhatsNewMenu | null>(null)
const WhatsNewQuietContext = createContext(true)

/** The account menu's «Novedades» (null outside the signed-in pages). */
export function useWhatsNewMenu(): WhatsNewMenu | null {
  return use(WhatsNewMenuContext)
}

/**
 * True once what is new has nothing (more) to show on its own and no list of notes is open: other
 * news (the memories) can be told then without stepping on it.
 */
export function useWhatsNewQuiet(): boolean {
  return use(WhatsNewQuietContext)
}

/** Stands in for the notes when they cannot be loaded: there is nothing to tell. */
function NoNews({ onSettled }: WhatsNewProps) {
  useEffect(() => onSettled(), [onSettled])
  return null
}

// Loaded after the page, so the notes never delay it. Should the file be gone (a new version
// replaced it), the app simply goes on without them.
const WhatsNew = lazy(() =>
  import('./WhatsNew').then(
    (module): { default: ComponentType<WhatsNewProps> } => ({ default: module.WhatsNew }),
    (): { default: ComponentType<WhatsNewProps> } => ({ default: NoNews }),
  ),
)

/**
 * Signed-in pages: whoever opens Timelife after it changed is told what is new since they last
 * looked (see WhatsNew), and the account menu shows every note again.
 */
export function WhatsNewLayout() {
  const [allOpen, setAllOpen] = useState(false)
  const [settled, setSettled] = useState(false)
  const settle = useCallback(() => setSettled(true), [])
  const menu = useMemo<WhatsNewMenu>(() => ({ openAll: () => setAllOpen(true) }), [])
  return (
    <WhatsNewMenuContext value={menu}>
      <WhatsNewQuietContext value={settled && !allOpen}>
        <Outlet />
      </WhatsNewQuietContext>
      <Suspense fallback={null}>
        <WhatsNew allOpen={allOpen} onAllOpenChange={setAllOpen} onSettled={settle} />
      </Suspense>
    </WhatsNewMenuContext>
  )
}
