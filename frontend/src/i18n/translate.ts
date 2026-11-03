import { parseISODate } from '../utils/dates'
import { en } from './locales/en'
import { es } from './locales/es'
import { pt } from './locales/pt'
import type { DateStyle, Dictionary, Lang, Messages, PluralMessage, TranslationParams } from './types'

export const DICTIONARIES: Readonly<Record<Lang, Messages<Dictionary>>> = { es, en, pt }

/** BCP 47 locale used for Intl formatting and react-aria (day-first dates in every language). */
export const LOCALES: Readonly<Record<Lang, string>> = { es: 'es-ES', en: 'en-GB', pt: 'pt-PT' }

function isPlural(value: unknown): value is PluralMessage {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { other?: unknown }).other === 'string'
  )
}

function resolve(tree: unknown, key: string): string | PluralMessage | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  if (typeof node === 'string' || isPlural(node)) return node
  return undefined
}

export function hasMessage(lang: Lang, key: string): boolean {
  return resolve(DICTIONARIES[lang], key) !== undefined || resolve(DICTIONARIES.es, key) !== undefined
}

const pluralRules = new Map<Lang, Intl.PluralRules>()
const numberFormats = new Map<Lang, Intl.NumberFormat>()

function selectPlural(lang: Lang, message: PluralMessage, count: number | undefined): string {
  if (count === undefined || !Number.isFinite(count)) return message.other
  if (count === 0 && message.zero !== undefined) return message.zero
  let rules = pluralRules.get(lang)
  if (!rules) {
    rules = new Intl.PluralRules(LOCALES[lang])
    pluralRules.set(lang, rules)
  }
  const form = rules.select(count) as keyof PluralMessage
  return message[form] ?? message.other
}

export function formatNumber(lang: Lang, value: number, options?: Intl.NumberFormatOptions): string {
  if (options) return new Intl.NumberFormat(LOCALES[lang], options).format(value)
  let format = numberFormats.get(lang)
  if (!format) {
    format = new Intl.NumberFormat(LOCALES[lang])
    numberFormats.set(lang, format)
  }
  return format.format(value)
}

function interpolate(lang: Lang, template: string, params: TranslationParams | undefined): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name]
    if (value === undefined) return placeholder
    // Only `count` is locale-formatted: years or ids must never become "2,026".
    if (name === 'count' && typeof value === 'number') return formatNumber(lang, value)
    return String(value)
  })
}

function warnMissing(key: string) {
  if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
    console.warn(`Timelife i18n: missing message "${key}"`)
  }
}

/** Message for a dotted key in `lang` (Spanish fallback, then the key itself). */
export function translate(lang: Lang, key: string, params?: TranslationParams): string {
  const message = resolve(DICTIONARIES[lang], key) ?? resolve(DICTIONARIES.es, key)
  if (message === undefined) {
    warnMissing(key)
    return key
  }
  const count = typeof params?.count === 'number' ? params.count : undefined
  const template = typeof message === 'string' ? message : selectPlural(lang, message, count)
  return interpolate(lang, template, params)
}

type IntlStyle = Exclude<DateStyle, 'monthYear' | 'monthAbbr' | 'monthNumber' | 'year'>

const DATE_OPTIONS: Readonly<Record<IntlStyle, Intl.DateTimeFormatOptions>> = {
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  short: { day: '2-digit', month: '2-digit', year: 'numeric' },
  dayMonth: { day: 'numeric', month: 'short' },
  monthYearLong: { month: 'long', year: 'numeric' },
  monthLong: { month: 'long' },
  dateTime: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
}

const dateFormats = new Map<string, Intl.DateTimeFormat>()

function dateFormat(lang: Lang, style: IntlStyle): Intl.DateTimeFormat {
  const cacheKey = `${lang}:${style}`
  let format = dateFormats.get(cacheKey)
  if (!format) {
    format = new Intl.DateTimeFormat(LOCALES[lang], DATE_OPTIONS[style])
    dateFormats.set(cacheKey, format)
  }
  return format
}

/**
 * Formats an API date (`YYYY-MM-DD`, read as a local date), an ISO datetime or a `Date`.
 * Invalid input → empty string.
 */
export function formatDate(lang: Lang, value: string | Date, style: DateStyle = 'medium'): string {
  const date = typeof value === 'string' ? parseISODate(value) : value
  if (Number.isNaN(date.getTime())) return ''
  switch (style) {
    case 'monthAbbr':
      // First three letters of the full name (Intl's short months vary: "sept", "Sept.").
      return Array.from(dateFormat(lang, 'monthLong').format(date)).slice(0, 3).join('').toLocaleUpperCase(LOCALES[lang])
    case 'monthNumber':
      return String(date.getMonth() + 1).padStart(2, '0')
    case 'year':
      return String(date.getFullYear())
    case 'monthYear':
      return `${dateFormat(lang, 'monthLong').format(date)} ${date.getFullYear()}`
    default:
      return dateFormat(lang, style).format(date)
  }
}
