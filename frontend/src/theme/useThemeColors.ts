import { createContext, createElement, use, useMemo, type ReactNode } from 'react'
import type { YearColorOut } from '../api/schema.gen'
import { useOptionalTheme } from '../contexts/ThemeContext'
import { adaptColor, normalizeHex } from '../utils/color'
import { DEFAULT_PALETTE, THEMES, type ResolvedTheme, type ThemePalette } from './themes'

/** What the JavaScript-painted colours (timeline, categories, previews) are for one palette and mode. */
export interface ThemeColors {
  palette: ThemePalette
  mode: ResolvedTheme
  /** A colour people chose (category, year override, a child's line) repainted for this palette and mode. */
  adapt(hex: string | null | undefined): string
  /** Automatic colour of a year in this palette. */
  autoYear(year: number): string
  /** The year's override (adapted) or its automatic colour. */
  year(year: number, overrides?: readonly YearColorOut[] | null): string
  /** A child's own line colour (adapted) or the palette's lane colour for its position. */
  lane(index: number, own?: string | null): string
  /** `--color-hub-badge-bg` of this palette and mode. */
  hubBadgeBg: string
}

/** Repainted colours kept per palette and mode (colour pickers can produce many). */
const MAX_ADAPTED = 512

function createThemeColors(palette: ThemePalette, mode: ResolvedTheme): ThemeColors {
  const theme = THEMES[palette]
  const tone = theme.tone[mode]
  const adapted = new Map<string, string>()
  const pick = (list: readonly string[], index: number) => list[((index % list.length) + list.length) % list.length]

  function adapt(hex: string | null | undefined): string {
    if (!tone) return adaptColor(hex, null)
    const key = normalizeHex(hex) ?? ''
    let color = adapted.get(key)
    if (color === undefined) {
      color = adaptColor(hex, tone)
      if (adapted.size >= MAX_ADAPTED) adapted.clear()
      adapted.set(key, color)
    }
    return color
  }

  function autoYear(year: number): string {
    return pick(theme.years, Math.trunc(year) + 4)
  }

  return {
    palette,
    mode,
    adapt,
    autoYear,
    year(year, overrides) {
      const override = normalizeHex(overrides?.find((item) => item.year === year)?.color)
      return override ? adapt(override) : autoYear(year)
    },
    lane(index, own) {
      const color = normalizeHex(own)
      return color ? adapt(color) : pick(theme.lanes, index)
    },
    hubBadgeBg: theme.hubBadge[mode],
  }
}

const cache = new Map<string, ThemeColors>()

/** Pure and memoised: the same object (and functions) for the same palette and mode. */
export function getThemeColors(palette: ThemePalette, mode: ResolvedTheme): ThemeColors {
  const key = `${palette}:${mode}`
  let colors = cache.get(key)
  if (!colors) {
    colors = createThemeColors(palette, mode)
    cache.set(key, colors)
  }
  return colors
}

interface ThemeScopeValue {
  palette?: ThemePalette
  mode?: ResolvedTheme
}

const ThemeScopeContext = createContext<ThemeScopeValue | null>(null)

export interface ThemeScopeProps extends ThemeScopeValue {
  children: ReactNode
}

/**
 * Paints its subtree for another palette and/or mode (e.g. a light preview inside a dark page).
 * The element around it must carry the same `data-palette` and `data-theme` so the CSS tokens
 * follow too.
 */
export function ThemeScope({ palette, mode, children }: ThemeScopeProps) {
  const outer = use(ThemeScopeContext)
  const value = useMemo(
    () => ({ palette: palette ?? outer?.palette, mode: mode ?? outer?.mode }),
    [palette, mode, outer],
  )
  return createElement(ThemeScopeContext, { value }, children)
}

/**
 * Theme colours of the current palette and mode (sunset light outside a <ThemeProvider>), memoised
 * per palette + mode so their functions are stable dependencies.
 */
export function useThemeColors(): ThemeColors {
  const theme = useOptionalTheme()
  const scope = use(ThemeScopeContext)
  return getThemeColors(scope?.palette ?? theme?.palette ?? DEFAULT_PALETTE, scope?.mode ?? theme?.resolved ?? 'light')
}
