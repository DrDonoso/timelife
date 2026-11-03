import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { I18nProvider as AriaI18nProvider } from 'react-aria-components'
import { IS_DEMO } from '../demo/config'
import { STORAGE_KEYS, readStorage, writeStorage } from '../utils/storage'
import { LOCALES, formatDate, formatNumber, hasMessage, translate } from './translate'
import { LANGS, type DateStyle, type Lang, type TranslationKey, type TranslationParams } from './types'

export interface I18nContextValue {
  lang: Lang
  /** BCP 47 locale for Intl APIs (`es-ES` / `en-GB` / `pt-PT`). */
  locale: string
  setLang: (lang: Lang) => void
  t: (key: TranslationKey, params?: TranslationParams) => string
  /** For keys built at runtime (e.g. `errors.${code}`). */
  hasMessage: (key: string) => key is TranslationKey
  formatDate: (value: string | Date, style?: DateStyle) => string
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

/** Language without a stored preference: Spanish, or English in the demo (its data is in English). */
export const DEFAULT_LANG: Lang = IS_DEMO ? 'en' : 'es'

function isLang(value: string | null): value is Lang {
  return (LANGS as readonly (string | null)[]).includes(value)
}

/** Stored language preference (one of {@link LANGS}), else {@link DEFAULT_LANG}. */
export function readStoredLang(): Lang {
  const stored = readStorage(STORAGE_KEYS.lang)
  return isLang(stored) ? stored : DEFAULT_LANG
}

export interface I18nProviderProps {
  children: ReactNode
  /** Initial language (defaults to the stored preference, else {@link DEFAULT_LANG}). */
  initialLang?: Lang
}

export function I18nProvider({ children, initialLang }: I18nProviderProps) {
  const [lang, setLangState] = useState<Lang>(() => initialLang ?? readStoredLang())

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    writeStorage(STORAGE_KEYS.lang, next)
  }, [])

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      locale: LOCALES[lang],
      setLang,
      t: (key, params) => translate(lang, key, params),
      hasMessage: (key): key is TranslationKey => hasMessage(lang, key),
      formatDate: (date, style) => formatDate(lang, date, style),
      formatNumber: (number, options) => formatNumber(lang, number, options),
    }),
    [lang, setLang],
  )

  return (
    <I18nContext value={value}>
      <AriaI18nProvider locale={LOCALES[lang]}>{children}</AriaI18nProvider>
    </I18nContext>
  )
}

export function useI18n(): I18nContextValue {
  const context = use(I18nContext)
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>')
  return context
}
