const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

const formats = new Map<string, Intl.RelativeTimeFormat>()

/** "hace 5 minutos" / "ayer" / "in 2 days": the largest unit that fits, rounded. */
export function relativeTime(value: string | Date, locale: string, now: number = Date.now()): string {
  const time = typeof value === 'string' ? Date.parse(value) : value.getTime()
  if (Number.isNaN(time)) return ''
  let format = formats.get(locale)
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    formats.set(locale, format)
  }
  const seconds = (time - now) / 1000
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return format.format(0, 'second')
}
