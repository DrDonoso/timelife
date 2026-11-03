import { useCallback } from 'react'
import { ApiError } from '../api/client'
import { useI18n } from './I18nProvider'

/** Backend/client error code of any thrown value (`unknown` when it isn't an ApiError). */
export function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : 'unknown'
}

/**
 * `(error) => message` translating `errors.<code>` (falls back to `errors.unknown`). `*_in_use`
 * errors that carry the number of milestones (`detail.events`) use `errors.inUse.<code>`, with
 * proper plurals.
 */
export function useErrorMessage(): (error: unknown) => string {
  const { t, hasMessage } = useI18n()
  return useCallback(
    (error: unknown) => {
      const code = errorCode(error)
      const events = error instanceof ApiError ? error.detail?.events : undefined
      const counted = `errors.inUse.${code}`
      if (typeof events === 'number' && Number.isInteger(events) && events > 0 && hasMessage(counted)) {
        return t(counted, { count: events })
      }
      const key = `errors.${code}`
      return hasMessage(key) ? t(key) : t('errors.unknown')
    },
    [t, hasMessage],
  )
}

/**
 * `(error) => { field: message }` for `invalid_request` responses (pydantic error types are
 * translated with `errors.validation.*`). Empty object for any other error.
 */
export function useFieldErrors(): (error: unknown) => Record<string, string> {
  const { t, hasMessage } = useI18n()
  return useCallback(
    (error: unknown) => {
      if (!(error instanceof ApiError) || !error.fields) return {}
      return Object.fromEntries(
        Object.entries(error.fields).map(([field, type]) => {
          const key = `errors.validation.${type}`
          return [field, hasMessage(key) ? t(key) : t('errors.validation.default')]
        }),
      )
    },
    [t, hasMessage],
  )
}
