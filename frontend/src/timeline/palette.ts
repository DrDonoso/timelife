import type { CategoryOut, YearColorOut } from '../api/schema.gen'
import { DEFAULT_PALETTE, THEMES, type ResolvedTheme } from '../theme/themes'
import type { ThemeColors } from '../theme/useThemeColors'
import {
  contrastRatio,
  ensureContrast,
  hexToOklch,
  hubFill,
  monthColor,
  NEUTRAL_COLOR,
  normalizeHex,
  oklchToHex,
  readableText,
} from '../utils/color'

export interface HubColors {
  /** Base colour (year colour or its month shade). */
  color: string
  /** `hubFill()` gradient. */
  fill: string
  /** Number on the hub. */
  text: string
  /** Count badge number on the light / dark badge background. */
  badgeLight: string
  badgeDark: string
}

/**
 * Colours of a hub in `color`. `badge` is the palette's `--color-hub-badge-bg` per mode
 * (`THEMES[palette].hubBadge`): the count numbers must contrast with it.
 */
export function hubColors(color: string, badge: Readonly<Record<ResolvedTheme, string>> = THEMES[DEFAULT_PALETTE].hubBadge): HubColors {
  return {
    color,
    fill: hubFill(color),
    text: hubText(color),
    badgeLight: ensureContrast(color, badge.light),
    badgeDark: ensureContrast(color, badge.dark),
  }
}

/**
 * Number colour on a hub: white when it reads as large text (3:1), otherwise a deep shade of the
 * hub's own hue (so light January blues get navy numbers, not a generic brown).
 */
export function hubText(color: string): string {
  if (contrastRatio(color, '#ffffff') >= 3) return '#ffffff'
  const { c, h } = hexToOklch(color)
  const deep = oklchToHex(0.3, Math.min(c, 0.11), h)
  return contrastRatio(color, deep) >= 4.5 ? deep : readableText(color, true)
}

export interface TimelinePalette {
  year: (year: number) => HubColors
  month: (year: number, month: number) => HubColors
}

/**
 * Year colours for the theme's palette and mode (`useThemeColors()`): the admin override adapted to
 * it, or the palette's automatic colour; plus their month shades. Memoised per palette.
 */
export function createPalette(overrides: readonly YearColorOut[] | null | undefined, theme: ThemeColors): TimelinePalette {
  const badge = THEMES[theme.palette].hubBadge
  const years = new Map<number, HubColors>()
  const months = new Map<string, HubColors>()
  const year = (value: number) => {
    let colors = years.get(value)
    if (!colors) {
      colors = hubColors(theme.year(value, overrides), badge)
      years.set(value, colors)
    }
    return colors
  }
  return {
    year,
    month(yearValue, monthValue) {
      const key = `${yearValue}-${monthValue}`
      let colors = months.get(key)
      if (!colors) {
        colors = hubColors(monthColor(year(yearValue).color, monthValue), badge)
        months.set(key, colors)
      }
      return colors
    },
  }
}

/**
 * Ring / border colours of an event: its categories in order (neutral when there are none),
 * repainted with `adapt` (`useThemeColors().adapt`; by default as chosen).
 */
export function categoryColors(
  categories: readonly Pick<CategoryOut, 'color'>[],
  adapt: (hex: string) => string = (hex) => hex,
): string[] {
  const colors = categories.map((category) => adapt(normalizeHex(category.color) ?? NEUTRAL_COLOR))
  return colors.length > 0 ? colors : [adapt(NEUTRAL_COLOR)]
}
