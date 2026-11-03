import { describe, expect, it } from 'vitest'
import {
  DARK_TEXT,
  NEUTRAL_COLOR,
  YEAR_PALETTE,
  adaptColor,
  autoYearColor,
  contrastRatio,
  ensureContrast,
  hexToOklch,
  hexToRgb,
  hubFill,
  monthColor,
  normalizeHex,
  oklchToHex,
  readableText,
  relativeLuminance,
  segmentedBorder,
  segmentedRing,
  withAlpha,
  yearColor,
} from './color'

function hueDistance(a: number, b: number) {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

describe('hex parsing', () => {
  it('normalises 3/6-digit hex to lower-case #rrggbb', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('abcdef')).toBe('#abcdef')
    expect(normalizeHex(' #3B82F6 ')).toBe('#3b82f6')
    expect(normalizeHex('#abcd')).toBeNull()
    expect(normalizeHex('blue')).toBeNull()
    expect(normalizeHex(null)).toBeNull()
  })

  it('never throws on invalid colours', () => {
    expect(hexToRgb('nope')).toEqual(hexToRgb('#94877c'))
    expect(() => ensureContrast('nope')).not.toThrow()
  })
})

describe('contrast', () => {
  it('follows the WCAG formulas', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#000000')).toBe(0)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBe(1)
  })

  it.each(['#fde047', '#a3e635', '#67e8f9', '#f9a8d4', '#fbbf24', '#ffffff', '#f59e0b', '#22c55e'])(
    'ensureContrast(%s) reaches 4.5:1 with white, keeping the hue',
    (color) => {
      const result = ensureContrast(color)
      expect(result).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrastRatio(result, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      const before = hexToOklch(color)
      const after = hexToOklch(result)
      expect(after.l).toBeLessThan(before.l)
      // Greys have no meaningful hue; coloured inputs must keep theirs.
      const keepsHue = before.c <= 0.05 || hueDistance(before.h, after.h) < 12
      expect(keepsHue).toBe(true)
    },
  )

  it('stays close to the original: just enough darkening', () => {
    const result = ensureContrast('#fde047')
    expect(contrastRatio(result, '#ffffff')).toBeLessThan(4.8)
  })

  it('returns colours that already pass unchanged (normalised)', () => {
    expect(ensureContrast('#1E3A8A')).toBe('#1e3a8a')
  })

  it('lightens the background for a dark foreground and supports other minimums', () => {
    const result = ensureContrast('#1e3a8a', '#2b2421', 4.5)
    expect(contrastRatio(result, '#2b2421')).toBeGreaterThanOrEqual(4.5)
    expect(relativeLuminance(result)).toBeGreaterThan(relativeLuminance('#1e3a8a'))
    expect(contrastRatio(ensureContrast('#fde047', '#ffffff', 3), '#ffffff')).toBeGreaterThanOrEqual(3)
  })

  it('readableText picks white or the dark text colour', () => {
    expect(readableText('#1e3a8a')).toBe('#ffffff')
    expect(readableText('#ffffff')).toBe(DARK_TEXT)
    expect(readableText('#fde047')).toBe(DARK_TEXT)
    // Large text only needs 3:1.
    expect(readableText('#3b82f6', true)).toBe('#ffffff')
  })
})

describe('OKLCH', () => {
  it.each(['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#000000', '#ffffff', '#94877c', '#fbf7f2', '#1c1816'])(
    'round-trips %s',
    (color) => {
      const { l, c, h } = hexToOklch(color)
      expect(oklchToHex(l, c, h)).toBe(color)
    },
  )

  it('gives sensible coordinates', () => {
    expect(hexToOklch('#ffffff').l).toBeCloseTo(1, 3)
    expect(hexToOklch('#000000').l).toBeCloseTo(0, 3)
    expect(hexToOklch('#808080').c).toBeLessThan(0.001)
    const blue = hexToOklch('#3b82f6')
    expect(blue.h).toBeGreaterThan(240)
    expect(blue.h).toBeLessThan(275)
  })

  it('clamps out-of-gamut colours by reducing chroma', () => {
    const hex = oklchToHex(0.92, 0.4, 145)
    expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(hexToOklch(hex).l).toBeCloseTo(0.92, 2)
    expect(oklchToHex(1.4, 0.2, 10)).toBe('#ffffff')
    expect(oklchToHex(-1, 0.2, 10)).toBe('#000000')
  })
})

describe('palette adaptation', () => {
  const tone = { lightness: [0.4, 0.72], chroma: 1 } as const

  it('only normalises without a tone (invalid colours → neutral)', () => {
    expect(adaptColor('#ABC', null)).toBe('#aabbcc')
    expect(adaptColor('3B82F6', undefined)).toBe('#3b82f6')
    expect(adaptColor('nope', null)).toBe(NEUTRAL_COLOR)
  })

  it('keeps colours inside the window exactly', () => {
    expect(adaptColor('#3B82F6', tone)).toBe('#3b82f6')
  })

  it.each([
    ['#fde047', 0.72],
    ['#1e3a8a', 0.4],
  ])('clamps the lightness of %s into the window, keeping its hue', (color, lightness) => {
    const before = hexToOklch(color)
    const after = hexToOklch(adaptColor(color, tone))
    expect(after.l).toBeCloseTo(lightness, 2)
    expect(hueDistance(before.h, after.h)).toBeLessThan(3)
  })

  it('scales the chroma', () => {
    const before = hexToOklch('#3b82f6')
    const after = hexToOklch(adaptColor('#3b82f6', { lightness: [0, 1], chroma: 0.5 }))
    expect(after.c).toBeCloseTo(before.c / 2, 2)
    expect(after.l).toBeCloseTo(before.l, 2)
    expect(hueDistance(before.h, after.h)).toBeLessThan(3)
  })
})

describe('year and month colours', () => {
  it('autoYearColor cycles the palette with 2026 = blue', () => {
    expect(autoYearColor(2026)).toBe('#3b82f6')
    expect(autoYearColor(2025)).toBe('#f43f5e')
    expect(autoYearColor(2024)).toBe('#6366f1')
    expect(autoYearColor(2027)).toBe('#f59e0b')
    expect(autoYearColor(2036)).toBe('#3b82f6')
    expect(autoYearColor(-4)).toBe(YEAR_PALETTE[0])
    expect(YEAR_PALETTE).toHaveLength(10)
  })

  it('yearColor prefers the admin override', () => {
    const overrides = [{ year: 2026, color: '#ABCDEF' }]
    expect(yearColor(2026, overrides)).toBe('#abcdef')
    expect(yearColor(2025, overrides)).toBe('#f43f5e')
    expect(yearColor(2025, null)).toBe('#f43f5e')
  })

  it.each(YEAR_PALETTE.map((color) => [color]))('monthColor(%s) is a monotonic ramp of the same hue', (year) => {
    const months = Array.from({ length: 12 }, (_, index) => monthColor(year, index + 1))
    const lightness = months.map((hex) => hexToOklch(hex).l)
    expect(lightness[0]).toBeCloseTo(0.84, 1)
    expect(lightness[11]).toBeCloseTo(0.5, 1)
    for (let index = 1; index < 12; index += 1) {
      expect(lightness[index]).toBeLessThan(lightness[index - 1])
      expect(relativeLuminance(months[index])).toBeLessThan(relativeLuminance(months[index - 1]))
    }
    const hue = hexToOklch(year).h
    for (const hex of months.slice(3)) expect(hueDistance(hexToOklch(hex).h, hue)).toBeLessThan(15)
  })

  it('clamps out-of-range months', () => {
    expect(monthColor('#3b82f6', 0)).toBe(monthColor('#3b82f6', 1))
    expect(monthColor('#3b82f6', 13)).toBe(monthColor('#3b82f6', 12))
  })
})

describe('CSS helpers', () => {
  it('segmentedRing builds equal hard-stop arcs from 12 o’clock', () => {
    expect(segmentedRing(['#F00', '#00ff00'])).toBe('conic-gradient(from 0deg, #ff0000 0% 50%, #00ff00 50% 100%)')
    expect(segmentedRing(['#ff0000'])).toBe('conic-gradient(from 0deg, #ff0000 0% 100%)')
    expect(segmentedRing(['#ff0000', '#00ff00', '#0000ff'])).toContain('#00ff00 33.333% 66.667%')
    expect(segmentedRing([])).toContain('0% 100%')
  })

  it('segmentedBorder uses a horizontal hard-stop gradient', () => {
    expect(segmentedBorder(['#ff0000', '#0000ff'])).toBe('linear-gradient(90deg, #ff0000 0% 50%, #0000ff 50% 100%)')
  })

  it('hubFill is a radial gradient around the colour', () => {
    const fill = hubFill('#3b82f6')
    expect(fill.startsWith('radial-gradient(')).toBe(true)
    expect(fill).toContain('#3b82f6 58%')
  })

  it('withAlpha returns rgba()', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
    expect(withAlpha('#000', 2)).toBe('rgba(0, 0, 0, 1)')
  })
})
