import { createContext, lazy, Suspense, use, useMemo, useState, type ComponentType } from 'react'
import { Outlet } from 'react-router'
import type { WhatsNewProps } from './WhatsNew'

export interface WhatsNewMenu {
  /** Shows every note, newest first (the account menu's «Novedades»). */
  openAll: () => void
}

const WhatsNewMenuContext = createContext<WhatsNewMenu | null>(null)

/** The account menu's «Novedades» (null outside the signed-in pages). */
export function useWhatsNewMenu(): WhatsNewMenu | null {
  return use(WhatsNewMenuContext)
}

// Loaded after the page, so the notes never delay it. Should the file be gone (a new version
// replaced it), the app simply goes on without them.
const WhatsNew = lazy(() =>
  import('./WhatsNew').then(
    (module): { default: ComponentType<WhatsNewProps> } => ({ default: module.WhatsNew }),
    (): { default: ComponentType<WhatsNewProps> } => ({ default: () => null }),
  ),
)

/**
 * Signed-in pages: whoever opens Timelife after it changed is told what is new since they last
 * looked (see WhatsNew), and the account menu shows every note again.
 */
export function WhatsNewLayout() {
  const [allOpen, setAllOpen] = useState(false)
  const menu = useMemo<WhatsNewMenu>(() => ({ openAll: () => setAllOpen(true) }), [])
  return (
    <WhatsNewMenuContext value={menu}>
      <Outlet />
      <Suspense fallback={null}>
        <WhatsNew allOpen={allOpen} onAllOpenChange={setAllOpen} />
      </Suspense>
    </WhatsNewMenuContext>
  )
}
