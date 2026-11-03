import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconDeviceFloppy, IconPaletteOff, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import { qk } from '../../api/queries'
import type { AppearanceOut } from '../../api/schema.gen'
import { Button } from '../../components/Button'
import { ColorInput } from '../../components/ColorInput'
import { IconButton } from '../../components/IconButton'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useI18n } from '../../i18n'
import { THEMES } from '../../theme/themes'
import { useThemeColors } from '../../theme/useThemeColors'
import { COLOR_PRESETS, normalizeHex } from '../../utils/color'
import styles from './AppearancePage.module.css'
import { MonthSwatches, YearHub } from './HubPreview'
import { YearPicker } from './YearPicker'

interface YearColorCardProps {
  year: number
  /** Its own colour, or null while the year is being added (not saved yet). */
  override: string | null
  /** Unsaved colour picked in the form. */
  draft: string | undefined
  hasEvents: boolean
  presets: readonly string[]
  onDraftChange: (year: number, color: string | undefined) => void
  /** Discarded before saving, or its colour removed: the card goes away. */
  onGone: (year: number, hadFocus: boolean) => void
}

function YearColorCard({ year, override, draft, hasEvents, presets, onDraftChange, onGone }: YearColorCardProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const { autoYear } = useThemeColors()
  const cardRef = useRef<HTMLElement>(null)
  const refocus = useRef(false)
  const isNew = override === null
  const saved = override ?? autoYear(year)
  const color = draft ?? saved
  const isDirty = isNew || (draft !== undefined && draft !== saved)

  // A saved draft is dropped once the new colour is in the cache (never flashes the old one).
  useEffect(() => {
    if (draft !== undefined && draft === saved) onDraftChange(year, undefined)
  }, [draft, saved, year, onDraftChange])

  // Saving or undoing removes the button that had focus: back to the colour field.
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    cardRef.current?.querySelector<HTMLInputElement>('input')?.focus()
  })

  function hasFocus() {
    return cardRef.current?.contains(document.activeElement) ?? false
  }

  function applied(data: AppearanceOut) {
    queryClient.setQueryData(qk.appearance, data)
    void queryClient.invalidateQueries({ queryKey: qk.appearance })
  }

  const save = useMutation({
    mutationFn: (value: string) => api.put<AppearanceOut>(`/api/admin/year-colors/${year}`, { color: value }),
    onSuccess: (data) => {
      refocus.current = hasFocus()
      applied(data)
      show({ tone: 'success', message: t('adminAppearance.years.saved', { year }) })
    },
    onError: (error) => show({ tone: 'error', message: errorMessage(error) }),
  })

  const remove = useMutation({
    mutationFn: () => api.del<AppearanceOut>(`/api/admin/year-colors/${year}`),
    onSuccess: (data) => {
      onGone(year, hasFocus())
      applied(data)
      show({ tone: 'success', message: t('adminAppearance.years.removed', { year }) })
    },
    onError: (error) => show({ tone: 'error', message: errorMessage(error) }),
  })

  const busy = save.isPending || remove.isPending

  return (
    <article ref={cardRef} className={styles.yearCard} data-year-card={year} aria-labelledby={`year-${year}-title`}>
      <YearHub year={year} color={color} />
      <div className={styles.yearBody}>
        <div className={styles.yearHeading}>
          <div className={styles.yearTitleGroup}>
            <h3 id={`year-${year}-title`} className={styles.yearTitle}>
              {year}
            </h3>
            {!hasEvents && <span className={styles.tag}>{t('adminAppearance.years.noEvents')}</span>}
            {isDirty && (
              <span className={styles.tag} data-tone="unsaved">
                {t('adminAppearance.years.unsaved')}
              </span>
            )}
          </div>
          {isNew ? (
            <IconButton
              size="sm"
              icon={IconX}
              label={t('adminAppearance.years.discard', { year })}
              isDisabled={save.isPending}
              onPress={() => onGone(year, true)}
              className={styles.yearRemove}
            />
          ) : (
            <IconButton
              size="sm"
              icon={IconPaletteOff}
              label={t('adminAppearance.years.removeColor', { year })}
              isLoading={remove.isPending}
              isDisabled={save.isPending}
              onPress={() => remove.mutate()}
              className={styles.yearRemove}
            />
          )}
        </div>
        <MonthSwatches year={year} color={color} />
        <div className={styles.yearControls}>
          <ColorInput
            label={t('adminAppearance.years.color', { year })}
            value={color}
            onChange={(hex) => onDraftChange(year, hex === saved ? undefined : hex)}
            presets={presets}
            isDisabled={busy}
            className={styles.yearColor}
          />
          {isDirty && (
            <div className={styles.yearActions}>
              <Button
                size="sm"
                variant="primary"
                icon={IconDeviceFloppy}
                isLoading={save.isPending}
                isDisabled={remove.isPending}
                onPress={() => save.mutate(normalizeHex(color) ?? color)}
                aria-label={t('adminAppearance.years.saveLabel', { year })}
              >
                {t('adminAppearance.years.save')}
              </Button>
              {draft !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={busy}
                  onPress={() => {
                    refocus.current = true
                    onDraftChange(year, undefined)
                  }}
                >
                  {t('adminAppearance.years.undo')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

/**
 * Years with their own colour (and the ones being added), newest first, plus «Añadir año». Every
 * other year uses its automatic colour from the theme.
 */
export function YearColorsSection({ appearance }: { appearance: AppearanceOut }) {
  const { t } = useI18n()
  const { palette } = useThemeColors()
  const [drafts, setDrafts] = useState<Readonly<Record<number, string>>>({})
  /** Years added here and not saved yet (a saved one leaves once its colour is in the cache). */
  const [added, setAdded] = useState<readonly number[]>([])
  const focusTarget = useRef<number | 'picker' | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLInputElement>(null)

  const overrides = useMemo(
    () => new Map(appearance.year_colors.map((item) => [item.year, normalizeHex(item.color) ?? item.color])),
    [appearance.year_colors],
  )
  const custom = useMemo(() => new Set(overrides.keys()), [overrides])
  const pending = useMemo(() => new Set(added.filter((year) => !custom.has(year))), [added, custom])
  const eventYears = useMemo(() => new Set(appearance.event_years), [appearance.event_years])
  const years = useMemo(() => [...custom, ...pending].toSorted((a, b) => b - a), [custom, pending])
  const suggestions = useMemo(
    () => [...eventYears].filter((year) => !custom.has(year) && !pending.has(year)).toSorted((a, b) => b - a),
    [eventYears, custom, pending],
  )
  /** The theme's year palette first (its automatic colours), then the category colours. */
  const presets = useMemo(() => [...new Set([...THEMES[palette].years, ...COLOR_PRESETS])], [palette])

  // Once its colour is saved (and in the cache), a year added here is one with its own colour.
  const [seenCustom, setSeenCustom] = useState(custom)
  if (seenCustom !== custom) {
    setSeenCustom(custom)
    if (added.some((year) => custom.has(year))) setAdded(added.filter((year) => !custom.has(year)))
  }

  // Focus the colour field of a year just added, or «Añadir año» when the focused card went away.
  useEffect(() => {
    const target = focusTarget.current
    if (target === null) return
    focusTarget.current = null
    if (target === 'picker') pickerRef.current?.focus()
    else listRef.current?.querySelector<HTMLInputElement>(`[data-year-card="${target}"] input`)?.focus()
  })

  const setDraft = useCallback((year: number, color: string | undefined) => {
    setDrafts((current) => {
      if (color === undefined) {
        if (!(year in current)) return current
        const next = { ...current }
        delete next[year]
        return next
      }
      return { ...current, [year]: color }
    })
  }, [])

  function add(year: number) {
    focusTarget.current = year
    setAdded((current) => [...current.filter((item) => item !== year), year])
  }

  function gone(year: number, hadFocus: boolean) {
    setDraft(year, undefined)
    setAdded((current) => current.filter((item) => item !== year))
    if (hadFocus) focusTarget.current = 'picker'
  }

  return (
    <section className={styles.card} aria-labelledby="year-colors-heading">
      <header className={styles.cardHeader}>
        <div>
          <h2 id="year-colors-heading" className={styles.cardTitle}>
            {t('adminAppearance.years.title')}
          </h2>
          <p className={styles.cardDescription}>{t('adminAppearance.years.description')}</p>
        </div>
        <YearPicker suggestions={suggestions} custom={custom} pending={pending} onAdd={add} inputRef={pickerRef} />
      </header>
      {years.length === 0 ? (
        <p className={styles.empty}>{t('adminAppearance.years.empty')}</p>
      ) : (
        <div ref={listRef} className={styles.yearList}>
          {years.map((year) => (
            <YearColorCard
              key={year}
              year={year}
              override={overrides.get(year) ?? null}
              draft={drafts[year]}
              hasEvents={eventYears.has(year)}
              presets={presets}
              onDraftChange={setDraft}
              onGone={gone}
            />
          ))}
        </div>
      )}
    </section>
  )
}
