import type { YearColorOut } from '../api/schema.gen'

/**
 * Colour helpers shared by the timeline, the admin previews and the design system.
 *
 * Every function accepts loosely formatted hex input (`#abc`, `ABCDEF`, `#AbCdEf`) and never throws:
 * invalid colours fall back to {@link NEUTRAL_COLOR} so a bad value can't break rendering.
 * OKLCH math follows Björn Ottosson's OKLab definition (sRGB D65).
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Oklch {
  /** Perceptual lightness 0..1. */
  l: number
  /** Chroma, 0 (grey) .. ~0.37 (most saturated sRGB colours). */
  c: number
  /** Hue in degrees 0..360 (0 for greys). */
  h: number
}

/** Fallback for invalid or missing colours (warm grey). */
export const NEUTRAL_COLOR = '#94877c'

/** Dark text colour paired with light backgrounds (same as the light theme's --color-text). */
export const DARK_TEXT = '#2b211c'

/**
 * Automatic year colours of the default palette (index = (year + 4) mod 10, so 2026 → blue). Each
 * palette has its own in `THEMES[palette].years` (src/theme/themes.ts); paint with `useThemeColors()`.
 */
export const YEAR_PALETTE = [
  '#3b82f6',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#f97316',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#6366f1',
  '#f43f5e',
] as const

/** Swatches offered by colour pickers: the seed category colours, then the year palette. */
export const COLOR_PRESETS: readonly string[] = [
  ...new Set([
    '#64748b',
    '#4f46e5',
    '#14b8a6',
    '#f59e0b',
    '#8b5cf6',
    '#ef4444',
    '#f97316',
    '#3b82f6',
    '#ec4899',
    '#22c55e',
    '#06b6d4',
    ...YEAR_PALETTE,
    '#b9475f',
  ]),
]

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Lower-case `#rrggbb`, or `null` when the input is not a 3/6-digit hex colour. */
export function normalizeHex(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const match = HEX_PATTERN.exec(value.trim())
  if (!match) return null
  let digits = match[1].toLowerCase()
  if (digits.length === 3) digits = [...digits].map((digit) => digit + digit).join('')
  return `#${digits}`
}

export function isHexColor(value: string | null | undefined): boolean {
  return normalizeHex(value) !== null
}

function safeHex(value: string | null | undefined): string {
  return normalizeHex(value) ?? NEUTRAL_COLOR
}

/** 0..255 channels. Invalid input → the neutral fallback colour. */
export function hexToRgb(hex: string): Rgb {
  const digits = safeHex(hex).slice(1)
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  }
}

function channelHex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, '0')
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`
}

function toLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function fromLinear(value: number): number {
  const c = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
  return c * 255
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/** WCAG contrast ratio between two colours (1..21, order-independent). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function hexToOklch(hex: string): Oklch {
  const { r, g, b } = hexToRgb(hex)
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const c = Math.hypot(A, B)
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
  return { l: L, c, h }
}

function oklchToLinear(l: number, c: number, h: number): [number, number, number] {
  const rad = (h * Math.PI) / 180
  const A = c * Math.cos(rad)
  const B = c * Math.sin(rad)
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

const GAMUT_EPSILON = 1e-6

function inGamut(rgb: [number, number, number]): boolean {
  return rgb.every((channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON)
}

/** OKLCH → `#rrggbb`. Out-of-gamut colours keep L and h and lose chroma until they fit sRGB. */
export function oklchToHex(l: number, c: number, h: number): string {
  const lightness = Math.min(1, Math.max(0, l))
  if (lightness === 0) return '#000000'
  if (lightness === 1) return '#ffffff'
  let chroma = Math.max(0, c)
  let rgb = oklchToLinear(lightness, chroma, h)
  if (!inGamut(rgb)) {
    let low = 0
    let high = chroma
    for (let step = 0; step < 24; step += 1) {
      const mid = (low + high) / 2
      if (inGamut(oklchToLinear(lightness, mid, h))) low = mid
      else high = mid
    }
    chroma = low
    rgb = oklchToLinear(lightness, chroma, h)
  }
  const [r, g, b] = rgb.map((channel) => fromLinear(Math.min(1, Math.max(0, channel))))
  return rgbToHex({ r, g, b })
}

/**
 * Adjusts `bg` along OKLCH lightness (same hue, chroma clamped to sRGB) until `fg` on top of it
 * reaches `min` contrast, staying as close as possible to the original colour. With a light `fg`
 * (the default white) the background is darkened; with a dark `fg` it is lightened instead.
 * Colours that already pass are returned unchanged (normalised).
 */
export function ensureContrast(bg: string, fg = '#ffffff', min = 4.5): string {
  const base = safeHex(bg)
  const text = safeHex(fg)
  if (contrastRatio(base, text) >= min) return base
  const { l, c, h } = hexToOklch(base)
  const darken = relativeLuminance(text) >= relativeLuminance(base)
  const passes = (lightness: number) => contrastRatio(oklchToHex(lightness, c, h), text) >= min
  const end = darken ? 0 : 1
  if (!passes(end)) return oklchToHex(end, c, h)
  let failing = l
  let passing = end
  for (let step = 0; step < 28; step += 1) {
    const mid = (failing + passing) / 2
    if (passes(mid)) passing = mid
    else failing = mid
  }
  return oklchToHex(passing, c, h)
}

/**
 * How a palette mode repaints colours that people choose (category colours, year overrides, a
 * child's own line colour) so they read well on its background: the OKLCH lightness is clamped
 * into `lightness` and the chroma scaled by `chroma`. The hue never changes.
 */
export interface ColorTone {
  /** OKLCH lightness window `[min, max]` (0..1). */
  lightness: readonly [min: number, max: number]
  /** Chroma multiplier (1 = unchanged; out-of-gamut results lose chroma until they fit sRGB). */
  chroma: number
}

/**
 * `hex` repainted with `tone` (see {@link ColorTone}); without a tone it is only normalised.
 * Colours already inside the window keep their exact value when the chroma is unchanged.
 */
export function adaptColor(hex: string | null | undefined, tone: ColorTone | null | undefined): string {
  const base = safeHex(hex)
  if (!tone) return base
  const { l, c, h } = hexToOklch(base)
  const [min, max] = tone.lightness
  const lightness = Math.min(max, Math.max(min, l))
  if (lightness === l && tone.chroma === 1) return base
  return oklchToHex(lightness, c * tone.chroma, h)
}

/** White when it reads well on `bg` (4.5:1, or 3:1 for large text), otherwise the dark text colour. */
export function readableText(bg: string, large = false): string {
  const white = contrastRatio(bg, '#ffffff')
  if (white >= (large ? 3 : 4.5)) return '#ffffff'
  return contrastRatio(bg, DARK_TEXT) > white ? DARK_TEXT : '#ffffff'
}

/**
 * Automatic colour of a year in the default palette: 2026 → blue, 2025 → rose, 2024 → indigo,
 * 2027 → amber (`useThemeColors().autoYear` follows the chosen palette).
 */
export function autoYearColor(year: number): string {
  return YEAR_PALETTE[(((year + 4) % 10) + 10) % 10]
}

/** Admin override for the year when there is one, else {@link autoYearColor}. */
export function yearColor(year: number, overrides: readonly YearColorOut[] | null | undefined): string {
  const override = overrides?.find((item) => item.year === year)
  return normalizeHex(override?.color) ?? autoYearColor(year)
}

const MONTH_LIGHTNESS_FIRST = 0.84
const MONTH_LIGHTNESS_LAST = 0.5

/** Month colour: same hue as the year, OKLCH lightness from ≈0.84 (January) to ≈0.50 (December). */
export function monthColor(yearHex: string, month: number): string {
  const { c, h } = hexToOklch(yearHex)
  const index = Math.min(12, Math.max(1, Math.round(month))) - 1
  const lightness = MONTH_LIGHTNESS_FIRST + ((MONTH_LIGHTNESS_LAST - MONTH_LIGHTNESS_FIRST) * index) / 11
  return oklchToHex(lightness, c, h)
}

/** Lighter / darker variant in OKLCH (positive `amount` lightens). */
export function shiftLightness(hex: string, amount: number): string {
  const { l, c, h } = hexToOklch(hex)
  return oklchToHex(l + amount, c, h)
}

/** Soft "pearl" fill for hubs: highlight top-left, the colour itself, slightly deeper rim. */
export function hubFill(hex: string): string {
  const base = safeHex(hex)
  const { l, c, h } = hexToOklch(base)
  const highlight = oklchToHex(Math.min(l + 0.13, 0.97), c * 0.85, h)
  const rim = oklchToHex(Math.max(l - 0.07, 0.04), c, h)
  return `radial-gradient(circle at 34% 28%, ${highlight} 0%, ${base} 58%, ${rim} 100%)`
}

function percent(value: number): string {
  return `${Number(value.toFixed(3))}%`
}

function hardStops(colors: readonly string[]): string {
  const list = colors.map((color) => safeHex(color))
  if (list.length === 0) list.push(NEUTRAL_COLOR)
  const step = 100 / list.length
  return list.map((color, index) => `${color} ${percent(index * step)} ${percent((index + 1) * step)}`).join(', ')
}

/** Ring split in equal arcs (first colour starts at 12 o'clock, clockwise). */
export function segmentedRing(colors: readonly string[]): string {
  return `conic-gradient(from 0deg, ${hardStops(colors)})`
}

/** Border split in equal horizontal segments (use with `border-image` or a padded background). */
export function segmentedBorder(colors: readonly string[]): string {
  return `linear-gradient(90deg, ${hardStops(colors)})`
}

/** `rgba()` string for a hex colour; `alpha` is clamped to 0..1. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  const a = Math.min(1, Math.max(0, alpha))
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`
}
