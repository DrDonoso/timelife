import { describe, expect, it } from 'vitest'
import { COLOR_PRESETS, NEUTRAL_COLOR, YEAR_PALETTE, autoYearColor, contrastRatio, hexToOklch, normalizeHex, yearColor } from '../utils/color'
import { DEFAULT_PALETTE, THEME_PALETTES, THEMES, isThemePalette, type ResolvedTheme } from './themes'
import { getThemeColors } from './useThemeColors'

const MODES: readonly ResolvedTheme[] = ['light', 'dark']
const NEW_PALETTES = THEME_PALETTES.filter((palette) => palette !== 'sunset')
const HEX = /^#[0-9a-f]{6}$/

/** Colours people may choose: the presets plus very light, very dark and grey ones. */
const CHOSEN = [...COLOR_PRESETS, NEUTRAL_COLOR, '#fde047', '#a3e635', '#67e8f9', '#f9a8d4', '#1e3a8a', '#7f1d1d', '#365314', '#111827', '#000000', '#ffffff']

function hueDistance(a: number, b: number) {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

function oklabDistance(a: string, b: string) {
  const [x, y] = [hexToOklch(a), hexToOklch(b)].map(({ l, c, h }) => {
    const rad = (h * Math.PI) / 180
    return [l, c * Math.cos(rad), c * Math.sin(rad)]
  })
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

function closestPair(colors: readonly string[]) {
  let best = { distance: Infinity, pair: '' }
  colors.forEach((a, index) => {
    for (const b of colors.slice(index + 1)) {
      const distance = oklabDistance(a, b)
      if (distance < best.distance) best = { distance, pair: `${a} ~ ${b}` }
    }
  })
  return best
}

/**
 * Minimum contrast of painted colours (rings, hubs, lines) against the page background. Sunset's
 * own year palette goes down to 1.85:1 on its light background (lime), so the new palettes ask for
 * a little more: 2:1 on light backgrounds and 2.5:1 on dark ones (thin lines need more there).
 */
const MIN_CONTRAST: Readonly<Record<ResolvedTheme, number>> = { light: 2, dark: 2.5 }

describe('palette registry', () => {
  it('lists the five palettes in picker order, sunset first and by default', () => {
    expect(THEME_PALETTES).toEqual(['sunset', 'ocean', 'forest', 'lavender', 'graphite'])
    expect(DEFAULT_PALETTE).toBe('sunset')
    expect(Object.keys(THEMES).toSorted()).toEqual([...THEME_PALETTES].toSorted())
    for (const palette of THEME_PALETTES) expect(THEMES[palette].id).toBe(palette)
  })

  it('recognises palette ids only', () => {
    for (const palette of THEME_PALETTES) expect(isThemePalette(palette)).toBe(true)
    for (const value of ['Ocean', 'neon', '', '__proto__', 'toString', null, undefined, 3, {}]) expect(isThemePalette(value)).toBe(false)
  })

  it('defines ten year colours, eight lane colours and the picker swatches for every palette', () => {
    for (const { swatches, background, hubBadge, years, lanes } of Object.values(THEMES)) {
      expect(years).toHaveLength(10)
      expect(lanes).toHaveLength(8)
      expect(swatches).toHaveLength(3)
      for (const color of [...swatches, ...years, ...lanes, ...Object.values(background), ...Object.values(hubBadge)]) expect(color).toMatch(HEX)
    }
  })

  it('keeps sunset exactly as it was', () => {
    expect(THEMES.sunset.years).toEqual(YEAR_PALETTE)
    expect(THEMES.sunset.lanes).toEqual(['#5b8def', '#d45f88', '#2f9e8f', '#e9963a', '#a66dd4', '#7f9c3a', '#e3734f', '#c9784a'])
    expect(THEMES.sunset.tone).toEqual({ light: null, dark: null })
    for (const mode of MODES) {
      const colors = getThemeColors('sunset', mode)
      for (const color of [...CHOSEN, '#ABC', 'F59E0B']) expect(colors.adapt(color)).toBe(normalizeHex(color))
      expect(colors.adapt('not a colour')).toBe(NEUTRAL_COLOR)
      const overrides = [{ year: 2026, color: '#ABCDEF' }]
      for (const year of [2019, 2024, 2025, 2026, 2027, 2036]) {
        expect(colors.autoYear(year)).toBe(autoYearColor(year))
        expect(colors.year(year, overrides)).toBe(yearColor(year, overrides))
      }
    }
  })

  it.each(NEW_PALETTES)('%s repaints chosen colours keeping their hue', (palette) => {
    for (const mode of MODES) {
      const { adapt } = getThemeColors(palette, mode)
      const shifted = CHOSEN.flatMap((color) => {
        const before = hexToOklch(color)
        const after = hexToOklch(adapt(color))
        // Greys have no meaningful hue.
        return before.c > 0.05 && hueDistance(before.h, after.h) >= 3 ? [`${mode} ${color} → ${adapt(color)}`] : []
      })
      expect(shifted).toEqual([])
    }
  })

  it.each(NEW_PALETTES)('%s keeps chosen and automatic colours visible on its backgrounds', (palette) => {
    for (const mode of MODES) {
      const colors = getThemeColors(palette, mode)
      const background = THEMES[palette].background[mode]
      const painted = [
        ...[...COLOR_PRESETS, NEUTRAL_COLOR].map((color) => ({ label: `${color} adapted`, color: colors.adapt(color) })),
        ...THEMES[palette].years.map((color) => ({ label: 'year', color })),
        ...THEMES[palette].lanes.map((color) => ({ label: 'lane', color })),
      ]
      const faint = painted
        .filter(({ color }) => contrastRatio(color, background) < MIN_CONTRAST[mode])
        .map(({ label, color }) => `${mode}: ${label} ${color} = ${contrastRatio(color, background).toFixed(2)}:1`)
      expect(faint).toEqual([])
    }
  })

  it('keeps every palette’s automatic year colours distinguishable', () => {
    for (const palette of THEME_PALETTES) {
      const { distance, pair } = closestPair(THEMES[palette].years)
      expect({ palette, pair, distinct: distance >= 0.05 }).toEqual({ palette, pair, distinct: true })
    }
  })

  /**
   * Year hubs print the year in white when the colour reaches 3:1 against it, otherwise in a deep
   * shade of the hue. The hub's pearl highlight makes the area behind white numbers lighter than
   * the colour itself: sunset's blue (3.68:1) reads at about 3:1 that way. The new palettes avoid
   * the band in between, so white numbers get at least 3.7:1 and the others the deep shade.
   */
  it.each(NEW_PALETTES)('%s keeps the numbers of its year hubs as readable as sunset’s', (palette) => {
    const borderline = THEMES[palette].years
      .map((color) => ({ color, ratio: contrastRatio(color, '#ffffff') }))
      .filter(({ ratio }) => ratio >= 3 && ratio < 3.7)
      .map(({ color, ratio }) => `${color} = ${ratio.toFixed(2)}:1 with white`)
    expect(borderline).toEqual([])
  })

  // Sunset keeps its original lane colours, whose two oranges are 0.047 apart.
  it.each(NEW_PALETTES)('%s keeps its lane colours distinguishable', (palette) => {
    const { distance, pair } = closestPair(THEMES[palette].lanes)
    expect({ pair, distinct: distance >= 0.05 }).toEqual({ pair, distinct: true })
  })
})
