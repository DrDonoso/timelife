import { shiftISODate, todayISO, yearOf } from '../utils/dates'

/** Quick date ranges offered by the filter panel. */
export type RangePreset = 'thisYear' | 'last12Months' | 'lastYear'

export const RANGE_PRESETS: readonly RangePreset[] = ['thisYear', 'last12Months', 'lastYear']

export interface DateRange {
  from: string
  to: string
}

/** Inclusive `YYYY-MM-DD` bounds of a preset relative to `today` (local calendar date). */
export function presetRange(preset: RangePreset, today: string = todayISO()): DateRange {
  const year = yearOf(today)
  switch (preset) {
    case 'thisYear':
      return { from: `${year}-01-01`, to: `${year}-12-31` }
    case 'last12Months':
      // 12 whole months ending today: 2026-10-20 → 2025-10-21 … 2026-10-20.
      return { from: shiftISODate(today, { months: -12, days: 1 }), to: today }
    case 'lastYear':
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }
  }
}

/** The preset whose bounds are exactly `from`…`to`, if any. */
export function matchingPreset(from: string | null, to: string | null, today: string = todayISO()): RangePreset | null {
  if (!from || !to) return null
  return RANGE_PRESETS.find((preset) => {
    const range = presetRange(preset, today)
    return range.from === from && range.to === to
  }) ?? null
}
