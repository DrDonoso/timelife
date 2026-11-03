const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

/**
 * A byte count for people ("1,5 GB" / "1.5 GB"), with `formatNumber` from `useI18n()`: steps of
 * 1024, one decimal from MB up, "B" for plain bytes in every language.
 */
export function formatBytes(formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string, bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  // Intl writes plain bytes as "10 byte" in English: "B" reads the same in both languages.
  if (unit === 0) return `${formatNumber(Math.round(value))} B`
  return formatNumber(value, {
    style: 'unit',
    unit: UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit >= 2 ? 1 : 0,
  })
}
