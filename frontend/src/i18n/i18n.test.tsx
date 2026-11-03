import { act, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { I18nProvider, readStoredLang, useI18n } from './I18nProvider'
import { useErrorMessage, useFieldErrors } from './errors'
import { en } from './locales/en'
import { es } from './locales/es'
import { DICTIONARIES, LOCALES, formatDate, translate } from './translate'
import { LANGS } from './types'

/** Languages translated from the Spanish source. */
const TRANSLATIONS = LANGS.filter((lang) => lang !== 'es')

/** Every message path, plural forms included (`common.milestones.one`). */
function keyPaths(tree: unknown, prefix = ''): string[] {
  if (typeof tree !== 'object' || tree === null) return [prefix]
  const record = tree as Record<string, unknown>
  return Object.keys(record).flatMap((key) => keyPaths(record[key], prefix ? `${prefix}.${key}` : key))
}

function leaves(tree: unknown): unknown[] {
  if (typeof tree !== 'object' || tree === null) return [tree]
  return Object.values(tree as Record<string, unknown>).flatMap(leaves)
}

/** Node at a dotted path (`undefined` when any step is missing). */
function read(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree)
}

const BACKEND_ERROR_CODES = [
  'internal_error', 'invalid_request', 'not_found', 'invalid_origin', 'invalid_host', 'request_too_large',
  'request_busy', 'request_timeout', 'frontend_not_built', 'authentication_required', 'admin_required',
  'login_throttled', 'request_throttled', 'invalid_credentials', 'password_change_required', 'password_unchanged',
  'current_password_invalid', 'password_not_set', 'password_reset_invalid', 'setup_closed', 'google_disabled',
  'google_invalid_flow', 'google_invalid_identity', 'google_not_invited', 'account_disabled', 'google_cancelled',
  'google_unavailable', 'user_exists', 'user_not_found', 'last_admin', 'cannot_modify_self', 'child_not_found',
  'slug_taken', 'child_in_use', 'category_not_found', 'category_in_use', 'invalid_order', 'upload_too_large',
  'unsupported_image', 'unsupported_media', 'unsupported_video', 'video_too_long', 'invalid_live_photo',
  'video_processing_failed', 'video_unavailable', 'image_dimensions_too_large', 'image_not_found', 'invalid_image',
  'invalid_cover', 'invalid_purpose', 'event_not_found', 'event_stale', 'event_not_deleted', 'invalid_child',
  'invalid_category', 'invalid_year', 'backup_busy', 'import_busy', 'import_not_found', 'import_not_uploading',
  'import_offset_mismatch', 'import_size_mismatch', 'import_no_space', 'import_not_ready', 'import_not_running',
  'import_running', 'invalid_import', 'import_version_unsupported', 'import_file_missing', 'import_file_unreadable',
  'import_interrupted', 'import_cancelled', 'import_failed',
]

describe('dictionaries', () => {
  it('has a dictionary and a locale for every language', () => {
    expect(Object.keys(DICTIONARIES).toSorted()).toEqual([...LANGS].toSorted())
    expect(LOCALES).toEqual({ es: 'es-ES', en: 'en-GB', pt: 'pt-PT' })
  })

  it.each(TRANSLATIONS)('%s has exactly the same keys and plural forms as Spanish in every namespace', (lang) => {
    const dictionary = DICTIONARIES[lang]
    expect(Object.keys(dictionary).toSorted()).toEqual(Object.keys(es).toSorted())
    const shape = (tree: unknown) =>
      Object.fromEntries(Object.keys(es).map((namespace) => [namespace, keyPaths(read(tree, namespace)).toSorted()]))
    expect(shape(dictionary)).toEqual(shape(es))
  })

  it.each(LANGS)('%s has no empty messages', (lang) => {
    for (const value of leaves(DICTIONARIES[lang])) {
      expect(typeof value).toBe('string')
      expect((value as string).trim()).not.toBe('')
    }
  })

  it.each(LANGS)('%s translates every backend error code plus unknown and network', (lang) => {
    const errors = DICTIONARIES[lang].errors
    const missing = [...BACKEND_ERROR_CODES, 'unknown', 'network'].filter((code) => !(code in errors))
    expect(missing).toEqual([])
  })

  it.each(TRANSLATIONS)('%s keeps the Spanish placeholders', (lang) => {
    const placeholders = (text: unknown) =>
      [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).toSorted().join()
    const mismatched = keyPaths(es).filter(
      (path) => placeholders(read(DICTIONARIES[lang], path)) !== placeholders(read(es, path)),
    )
    expect(mismatched).toEqual([])
  })
})

describe('translate', () => {
  it('interpolates parameters and leaves unknown placeholders', () => {
    expect(translate('es', 'shell.childSwitcher.current', { name: 'Ana' })).toBe('Viendo a Ana')
    expect(translate('en', 'shell.childSwitcher.current', { name: 'Ana' })).toBe('Viewing Ana')
    expect(translate('pt', 'shell.childSwitcher.current', { name: 'Ana' })).toBe('A ver Ana')
    expect(translate('es', 'shell.childSwitcher.current')).toBe('Viendo a {name}')
    expect(translate('es', 'admin.version', { version: 2026 })).toBe('Versión 2026')
  })

  it('selects plural forms from count (with an exact-zero form)', () => {
    expect(translate('es', 'common.milestones', { count: 0 })).toBe('Sin hitos')
    expect(translate('es', 'common.milestones', { count: 1 })).toBe('1 hito')
    expect(translate('es', 'common.milestones', { count: 4 })).toBe('4 hitos')
    expect(translate('en', 'common.milestones', { count: 1 })).toBe('1 milestone')
    expect(translate('en', 'common.milestones', { count: 2 })).toBe('2 milestones')
    expect(translate('en', 'common.milestones', { count: 1234 })).toBe('1,234 milestones')
    expect(translate('pt', 'common.milestones', { count: 0 })).toBe('Sem marcos')
    expect(translate('pt', 'common.milestones', { count: 1 })).toBe('1 marco')
    expect(translate('pt', 'common.milestones', { count: 2 })).toBe('2 marcos')
    expect(translate('pt', 'common.milestones', { count: 12345 })).toBe('12\u00a0345 marcos')
    expect(translate('es', 'common.milestones')).toBe('{count} hitos')
  })

  it('returns the key for unknown messages', () => {
    expect(translate('es', 'common.doesNotExist')).toBe('common.doesNotExist')
  })
})

describe('formatDate', () => {
  // pt-PT's CLDR patterns with abbreviated months are numeric: `medium` d/MM/y, `dayMonth` d/MM.
  it.each([
    ['long', '12 de marzo de 2026', '12 March 2026', '12 de março de 2026'],
    ['medium', '12 mar 2026', '12 Mar 2026', '12/03/2026'],
    ['short', '12/03/2026', '12/03/2026', '12/03/2026'],
    ['dayMonth', '12 mar', '12 Mar', '12/03'],
    ['monthYear', 'marzo 2026', 'March 2026', 'março 2026'],
    ['monthYearLong', 'marzo de 2026', 'March 2026', 'março de 2026'],
    ['monthLong', 'marzo', 'March', 'março'],
    ['monthAbbr', 'MAR', 'MAR', 'MAR'],
    ['monthNumber', '03', '03', '03'],
    ['year', '2026', '2026', '2026'],
  ] as const)('%s', (style, spanish, english, portuguese) => {
    expect(formatDate('es', '2026-03-12', style)).toBe(spanish)
    expect(formatDate('en', '2026-03-12', style)).toBe(english)
    expect(formatDate('pt', '2026-03-12', style)).toBe(portuguese)
  })

  it('dateTime', () => {
    const date = new Date(2026, 2, 12, 14, 5)
    expect(formatDate('es', date, 'dateTime')).toBe('12 mar 2026, 14:05')
    expect(formatDate('en', date, 'dateTime')).toBe('12 Mar 2026, 14:05')
    expect(formatDate('pt', date, 'dateTime')).toBe('12/03/2026, 14:05')
  })

  it('abbreviates every month to its first three letters', () => {
    const months = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}-01`)
    expect(months.map((date) => formatDate('es', date, 'monthAbbr'))).toEqual([
      'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC',
    ])
    expect(months.map((date) => formatDate('en', date, 'monthAbbr'))).toEqual([
      'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
    ])
    expect(months.map((date) => formatDate('pt', date, 'monthAbbr'))).toEqual([
      'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ',
    ])
  })

  it('accepts Date objects and rejects invalid input', () => {
    expect(formatDate('es', new Date(2026, 0, 5), 'short')).toBe('05/01/2026')
    expect(formatDate('pt', new Date(2026, 0, 5), 'short')).toBe('05/01/2026')
    expect(formatDate('pt', new Date(2026, 0, 5), 'medium')).toBe('5/01/2026')
    expect(formatDate('es', 'nope', 'long')).toBe('')
  })
})

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>
}

describe('I18nProvider', () => {
  it('defaults to Spanish and sets <html lang>', () => {
    const { result } = renderHook(() => useI18n(), { wrapper })
    expect(result.current.lang).toBe('es')
    expect(result.current.t('common.save')).toBe('Guardar')
    expect(document.documentElement.lang).toBe('es')
  })

  it('switches language, persists it and updates <html lang>', () => {
    const { result } = renderHook(() => useI18n(), { wrapper })
    act(() => result.current.setLang('en'))
    expect(result.current.t('common.save')).toBe('Save')
    expect(result.current.formatDate('2026-03-12', 'long')).toBe('12 March 2026')
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('timelife.lang')).toBe('en')
  })

  it('switches to European Portuguese', () => {
    const { result } = renderHook(() => useI18n(), { wrapper })
    act(() => result.current.setLang('pt'))
    expect(result.current.lang).toBe('pt')
    expect(result.current.locale).toBe('pt-PT')
    expect(result.current.t('common.tagline')).toBe('Os marcos da nossa família')
    expect(result.current.t('common.milestones', { count: 1 })).toBe('1 marco')
    expect(result.current.formatDate('2026-03-12', 'long')).toBe('12 de março de 2026')
    expect(result.current.formatNumber(12345)).toBe('12\u00a0345')
    expect(document.documentElement.lang).toBe('pt')
    expect(localStorage.getItem('timelife.lang')).toBe('pt')
  })

  it.each([
    ['en', 'Our family milestones'],
    ['pt', 'Os marcos da nossa família'],
  ])('reads the stored language (%s)', (stored, tagline) => {
    localStorage.setItem('timelife.lang', stored)
    function Probe() {
      const { t } = useI18n()
      return <p>{t('common.tagline')}</p>
    }
    render(<Probe />, { wrapper })
    expect(screen.getByText(tagline)).toBeInTheDocument()
  })

  it('ignores an unknown stored language', () => {
    localStorage.setItem('timelife.lang', 'pt-BR')
    expect(readStoredLang()).toBe('es')
  })

  it('translates API errors (with usage counts) and field errors', () => {
    const { result } = renderHook(() => ({ message: useErrorMessage(), fields: useFieldErrors() }), { wrapper })
    expect(result.current.message(new ApiError({ status: 409, code: 'slug_taken' }))).toBe(es.errors.slug_taken)
    expect(result.current.message(new ApiError({ status: 418, code: 'teapot' }))).toBe(es.errors.unknown)
    expect(result.current.message(new Error('boom'))).toBe(es.errors.unknown)
    expect(result.current.message(new ApiError({ status: 0, code: 'network' }))).toBe(es.errors.network)
    expect(
      result.current.fields(new ApiError({ status: 422, code: 'invalid_request', fields: { title: 'string_too_long', x: 'weird' } })),
    ).toEqual({ title: es.errors.validation.string_too_long, x: es.errors.validation.default })
  })

  it('words "in use" errors with the number of milestones, in every language', () => {
    const { result } = renderHook(() => ({ message: useErrorMessage(), i18n: useI18n() }), { wrapper })
    const inUse = (code: string, events?: unknown) =>
      result.current.message(new ApiError({ status: 409, code, detail: events === undefined ? undefined : { events } }))

    expect(inUse('category_in_use', 3)).toBe('No se puede eliminar porque 3 hitos usan esta categoría (la papelera también cuenta).')
    expect(inUse('category_in_use', 1)).toBe('No se puede eliminar porque 1 hito usa esta categoría (la papelera también cuenta).')
    expect(inUse('child_in_use', 1)).toBe('No se puede eliminar porque tiene 1 hito asociado (la papelera también cuenta).')
    expect(inUse('child_in_use', 12)).toBe('No se puede eliminar porque tiene 12 hitos asociados (la papelera también cuenta).')
    // Without a usable count: the general message.
    expect(inUse('category_in_use')).toBe(es.errors.category_in_use)
    expect(inUse('child_in_use', 'many')).toBe(es.errors.child_in_use)

    act(() => result.current.i18n.setLang('en'))
    expect(inUse('category_in_use', 1)).toBe('This category cannot be deleted because 1 milestone uses it (the trash counts too).')
    expect(inUse('child_in_use', 2)).toBe('This child cannot be deleted because they have 2 milestones (the trash counts too).')
    expect(inUse('child_in_use')).toBe(en.errors.child_in_use)

    act(() => result.current.i18n.setLang('pt'))
    expect(inUse('category_in_use', 1)).toBe('Não é possível eliminar porque 1 marco usa esta categoria (o lixo também conta).')
    expect(inUse('child_in_use', 2)).toBe('Não é possível eliminar porque tem 2 marcos associados (o lixo também conta).')
    expect(inUse('child_in_use')).toBe(DICTIONARIES.pt.errors.child_in_use)
  })
})
