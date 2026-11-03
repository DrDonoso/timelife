import type { es } from './locales/es'

export type Lang = 'es' | 'en' | 'pt'

export const LANGS: readonly Lang[] = ['es', 'en', 'pt']

/**
 * Plural message selected with `Intl.PluralRules` from `params.count` (`zero` is an optional exact-0
 * override). Never name a regular message group key `other`: objects with an `other` string are
 * treated as plurals.
 */
export interface PluralMessage {
  readonly zero?: string
  readonly one?: string
  readonly two?: string
  readonly few?: string
  readonly many?: string
  readonly other: string
}

/** Shape a translation must have to mirror the Spanish source `T` (same keys, string leaves). */
export type Messages<T> = {
  readonly [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends { readonly other: string }
      ? PluralMessage
      : Messages<T[K]>
}

type Join<P extends string, K extends string> = P extends '' ? K : `${P}.${K}`

/** Dotted paths of every message in `T` (`'common.save'`, `'errors.network'`, …). */
export type LeafKeys<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? Join<P, K>
    : T[K] extends { readonly other: string }
      ? Join<P, K>
      : LeafKeys<T[K], Join<P, K>>
}[keyof T & string]

export type Dictionary = typeof es

export type Namespace = keyof Dictionary

export type TranslationKey = LeafKeys<Dictionary>

/** `{name}` placeholders. `count` also selects plural forms and is formatted for the locale. */
export type TranslationParams = Readonly<Record<string, string | number>>

/**
 * `long` 12 de marzo de 2026 · `medium` 12 mar 2026 · `short` 12/03/2026 · `dayMonth` 12 mar ·
 * `monthYear` marzo 2026 · `monthYearLong` marzo de 2026 · `monthLong` marzo · `monthAbbr` MAR ·
 * `monthNumber` 03 · `year` 2026 · `dateTime` 12 mar 2026, 14:05
 */
export type DateStyle =
  | 'long'
  | 'medium'
  | 'short'
  | 'dayMonth'
  | 'monthYear'
  | 'monthYearLong'
  | 'monthLong'
  | 'monthAbbr'
  | 'monthNumber'
  | 'year'
  | 'dateTime'
