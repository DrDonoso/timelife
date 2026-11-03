import { createContext, use, useCallback, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'

export interface FilterPanelValue {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  /** Id of the panel element (the toggle button's `aria-controls`). */
  panelId: string
  /** The FilterToggleButton; focus returns to it when the panel is closed from inside. */
  triggerRef: RefObject<HTMLButtonElement | null>
}

/**
 * Horizontal space the desktop panel covers at the right edge of the viewport (360 px panel +
 * 12 px margins), below the header. Floating timeline controls can shift by this much while
 * `useFilterPanel().isOpen` is true on desktop.
 */
export const FILTER_PANEL_INSET = 384

const FilterPanelContext = createContext<FilterPanelValue | null>(null)

/** Open state of the timeline filter panel (rendered by AppShell around the header and the page). */
export function FilterPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false)
  const panelId = `filter-panel-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const open = useCallback(() => setOpen(true), [])
  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen((current) => !current), [])
  const value = useMemo(
    () => ({ isOpen, open, close, toggle, panelId, triggerRef }),
    [isOpen, open, close, toggle, panelId],
  )
  return <FilterPanelContext value={value}>{children}</FilterPanelContext>
}

export function useFilterPanel(): FilterPanelValue {
  const context = use(FilterPanelContext)
  if (!context) throw new Error('useFilterPanel must be used inside <FilterPanelProvider>')
  return context
}