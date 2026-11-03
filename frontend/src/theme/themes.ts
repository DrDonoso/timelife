import { YEAR_PALETTE, type ColorTone } from '../utils/color'

/**
 * Colour palettes ("themes"), each with a light and a dark version; everyone picks one per device
 * (`useTheme().palette`, stored as `timelife.palette`). The CSS tokens of every palette and mode
 * live in src/styles/tokens.css (sunset, the default) and src/styles/themes.css; this registry
 * holds what JavaScript paints: automatic year and lane colours, how chosen colours are repainted
 * and the values that must match the CSS (src/styles/tokens.test.ts checks them).
 */

/** The light or the dark version of a palette (the mode preference resolved against the system). */
export type ResolvedTheme = 'light' | 'dark'

export type ThemePalette = 'sunset' | 'ocean' | 'forest' | 'lavender' | 'graphite'

/** In picker order. */
export const THEME_PALETTES: readonly ThemePalette[] = ['sunset', 'ocean', 'forest', 'lavender', 'graphite']

/** The original look (gold → coral → rose of the logo on warm cream). */
export const DEFAULT_PALETTE: ThemePalette = 'sunset'

export function isThemePalette(value: unknown): value is ThemePalette {
  return typeof value === 'string' && (THEME_PALETTES as readonly string[]).includes(value)
}

export interface ThemeDefinition {
  id: ThemePalette
  /** Three colours that stand for the palette in the picker: background, primary, accent. */
  swatches: readonly [string, string, string]
  /** `--color-bg` per mode: also the browser UI colour (theme-color metas, public/theme-init.js). */
  background: Readonly<Record<ResolvedTheme, string>>
  /** `--color-hub-badge-bg` per mode: the count numbers of year and month hubs contrast with it. */
  hubBadge: Readonly<Record<ResolvedTheme, string>>
  /** Ten automatic year colours (index = (year + 4) mod 10, so 2026 takes the first one). */
  years: readonly string[]
  /** Eight automatic colours of the family timeline's lines, by the child's position. */
  lanes: readonly string[]
  /**
   * How colours chosen by people (categories, year overrides, a child's own line colour) are
   * repainted per mode so they read well on the palette's background; `null` = as chosen.
   */
  tone: Readonly<Record<ResolvedTheme, ColorTone | null>>
}

export const THEMES: Readonly<Record<ThemePalette, ThemeDefinition>> = {
  sunset: {
    id: 'sunset',
    swatches: ['#efe5da', '#b9475f', '#f3a637'],
    background: { light: '#fbf7f2', dark: '#1c1816' },
    hubBadge: { light: '#ffffff', dark: '#2b2421' },
    years: YEAR_PALETTE,
    lanes: ['#5b8def', '#d45f88', '#2f9e8f', '#e9963a', '#a66dd4', '#7f9c3a', '#e3734f', '#c9784a'],
    tone: { light: null, dark: null },
  },
  ocean: {
    id: 'ocean',
    swatches: ['#dbe9f0', '#0e6a83', '#2bb5ab'],
    background: { light: '#f2f7fa', dark: '#0d171e' },
    hubBadge: { light: '#ffffff', dark: '#182730' },
    years: ['#1d6fd8', '#f2765e', '#0f9488', '#d99c2f', '#7e5acf', '#0ea5c9', '#d9577f', '#4fae6e', '#3d4fc4', '#3dbfa8'],
    lanes: ['#2784d5', '#df6862', '#12a195', '#d19936', '#8264c8', '#5aa75e', '#ca5794', '#3baece'],
    // Clean and fresh: pale colours deepen on the light background, deep ones lift on the dark one.
    tone: { light: { lightness: [0.4, 0.72], chroma: 1 }, dark: { lightness: [0.62, 0.86], chroma: 0.95 } },
  },
  forest: {
    id: 'forest',
    swatches: ['#e3e9d9', '#2e6a4e', '#cc7550'],
    background: { light: '#f4f6ef', dark: '#101712' },
    hubBadge: { light: '#ffffff', dark: '#1b261e' },
    years: ['#4f8a2b', '#c8693d', '#2a8c82', '#c99a2e', '#8a4f8f', '#3f88c5', '#2f7a4f', '#a8463f', '#858925', '#b0457a'],
    lanes: ['#57914a', '#c66846', '#4188b6', '#ca9d33', '#985593', '#258b86', '#969841', '#a3484b'],
    // Natural: a little earthier (less chroma).
    tone: { light: { lightness: [0.4, 0.7], chroma: 0.85 }, dark: { lightness: [0.62, 0.85], chroma: 0.85 } },
  },
  lavender: {
    id: 'lavender',
    swatches: ['#e8e3f2', '#6a4ea2', '#ec8cbf'],
    background: { light: '#f8f6fc', dark: '#15121d' },
    hubBadge: { light: '#ffffff', dark: '#231f2e' },
    years: ['#8a5cd8', '#d65792', '#109299', '#ef8a5a', '#4f7fe0', '#b84fc0', '#52ab69', '#d9a03a', '#5a54c9', '#d75d5e'],
    lanes: ['#816bd8', '#d863a0', '#289da9', '#e58b55', '#477ed8', '#b75cbd', '#56a76a', '#caa144'],
    // Soft: never too dark, a little less saturated.
    tone: { light: { lightness: [0.45, 0.72], chroma: 0.9 }, dark: { lightness: [0.64, 0.87], chroma: 0.9 } },
  },
  graphite: {
    id: 'graphite',
    swatches: ['#e6e6e4', '#2f3b52', '#8fa3d9'],
    background: { light: '#f6f6f5', dark: '#121212' },
    hubBadge: { light: '#ffffff', dark: '#202022' },
    years: ['#4a6fa5', '#c46a4a', '#56906f', '#c9a23a', '#8a5a8f', '#3f8f96', '#c45a7a', '#7f8a3f', '#817fb5', '#a8553a'],
    lanes: ['#4a6fa5', '#c45a7a', '#5f9a78', '#c9a23a', '#8a5a8f', '#8d8cc2', '#c46a4a', '#7f8a3f'],
    // Sober: muted colours, so the photos stand out.
    tone: { light: { lightness: [0.38, 0.7], chroma: 0.75 }, dark: { lightness: [0.62, 0.85], chroma: 0.75 } },
  },
}
