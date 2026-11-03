import { createContext, use, useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_PALETTE, THEMES, isThemePalette, type ResolvedTheme, type ThemePalette } from '../theme/themes'
import { useMediaQuery } from '../utils/useMediaQuery'
import { STORAGE_KEYS, readStorage, writeStorage } from '../utils/storage'

export type ThemePreference = 'system' | 'light' | 'dark'
export type { ResolvedTheme, ThemePalette }

/**
 * Browser UI colours of the default palette: the theme-color metas of index.html and (light only)
 * public/manifest.webmanifest. Every palette's are `THEMES[palette].background` (= its --color-bg).
 */
export const THEME_COLORS: Readonly<Record<ResolvedTheme, string>> = THEMES[DEFAULT_PALETTE].background

export interface ThemeContextValue {
  /** Light / dark mode choice. */
  preference: ThemePreference
  resolved: ResolvedTheme
  /** Colour palette (src/theme/themes.ts). */
  palette: ThemePalette
  setPreference: (preference: ThemePreference) => void
  setPalette: (palette: ThemePalette) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function readStoredTheme(): ThemePreference {
  const stored = readStorage(STORAGE_KEYS.theme)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function readStoredPalette(): ThemePalette {
  const stored = readStorage(STORAGE_KEYS.palette)
  return isThemePalette(stored) ? stored : DEFAULT_PALETTE
}

/**
 * Applies the theme to <html> (data-theme + color-scheme, data-palette) and paints the theme-color
 * metas with the palette's background.
 */
export function applyTheme(preference: ThemePreference, resolved: ResolvedTheme, palette: ThemePalette = DEFAULT_PALETTE): void {
  const root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.palette = palette
  root.style.colorScheme = resolved
  const colors = THEMES[palette].background
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media') ?? ''
    // "System" restores the per-scheme metas; an explicit choice paints both with that theme.
    const target: ResolvedTheme =
      preference === 'system' && media ? (media.includes('dark') ? 'dark' : 'light') : resolved
    meta.setAttribute('content', colors[target])
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredTheme)
  const [palette, setPaletteState] = useState<ThemePalette>(readStoredPalette)
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const resolved: ResolvedTheme = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference

  // Layout effect: switch before paint so components never render with the previous palette.
  useLayoutEffect(() => {
    applyTheme(preference, resolved, palette)
  }, [preference, resolved, palette])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    writeStorage(STORAGE_KEYS.theme, next)
  }, [])

  const setPalette = useCallback((next: ThemePalette) => {
    if (!isThemePalette(next)) return
    setPaletteState(next)
    writeStorage(STORAGE_KEYS.palette, next)
  }, [])

  const value = useMemo(
    () => ({ preference, resolved, palette, setPreference, setPalette }),
    [preference, resolved, palette, setPreference, setPalette],
  )
  return <ThemeContext value={value}>{children}</ThemeContext>
}

export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>')
  return context
}

/** The theme, or `null` outside a <ThemeProvider> (components rendered on their own paint the default). */
export function useOptionalTheme(): ThemeContextValue | null {
  return use(ThemeContext)
}
