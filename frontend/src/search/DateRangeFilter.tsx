import { useEffect, useId, useRef, useState } from 'react'
import { ToggleButton } from 'react-aria-components'
import { DateField } from '../components/DateField'
import { useI18n } from '../i18n'
import { todayISO, yearOf } from '../utils/dates'
import { RANGE_PRESETS, matchingPreset, presetRange } from './datePresets'
import styles from './FilterPanel.module.css'
import { MAX_FILTER_YEAR, MIN_FILTER_YEAR } from './useTimelineFilters'

/** Typed dates apply after this pause, so typing "10/05/2026" doesn't refetch per segment/digit. */
export const DATE_APPLY_DELAY_MS = 350

export interface DateRangeFilterProps {
  /** Applied bounds (`YYYY-MM-DD` or null). */
  from: string | null
  to: string | null
  onChange: (from: string | null, to: string | null) => void
}

interface Draft {
  from: string | null
  to: string | null
}

type DateIssue = 'incomplete' | 'outOfRange' | null

/** react-aria reports a value for every typed year digit (0002, 0020, 0202, 2026). */
function dateIssue(value: string | null): DateIssue {
  if (!value) return null
  const year = yearOf(value)
  if (year < 1000) return 'incomplete'
  return year < MIN_FILTER_YEAR || year > MAX_FILTER_YEAR ? 'outOfRange' : null
}

function isReversed({ from, to }: Draft): boolean {
  return Boolean(from && to && from > to)
}

function canApply(draft: Draft): boolean {
  return !dateIssue(draft.from) && !dateIssue(draft.to) && !isReversed(draft)
}

/**
 * "Desde" / "Hasta" date fields plus quick presets. Typed edits apply shortly after the last
 * change; an invalid draft (reversed range, implausible year) stays local with an error and the
 * URL keeps the last valid range. Presets apply at once and toggle off when pressed again.
 */
export function DateRangeFilter({ from, to, onChange }: DateRangeFilterProps) {
  const { t } = useI18n()
  const headingId = useId()
  const [draft, setDraft] = useState<Draft>({ from, to })
  const [applied, setApplied] = useState<Draft>({ from, to })
  const [editing, setEditing] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  if (applied.from !== from || applied.to !== to) {
    // Changed from outside (preset, "clear filters", URL): drop any draft.
    setApplied({ from, to })
    setDraft({ from, to })
  }
  // A pending edit must not override a newer range applied from elsewhere.
  useEffect(() => () => window.clearTimeout(timer.current), [from, to])

  function edit(next: Draft) {
    setDraft(next)
    window.clearTimeout(timer.current)
    if (canApply(next)) timer.current = window.setTimeout(() => onChange(next.from, next.to), DATE_APPLY_DELAY_MS)
  }

  function applyPreset(range: Draft) {
    window.clearTimeout(timer.current)
    onChange(range.from, range.to)
  }

  const yearMessage = t('search.panel.yearRange', { min: MIN_FILTER_YEAR, max: MAX_FILTER_YEAR })
  const issueMessage = (issue: DateIssue) =>
    issue === 'outOfRange' || (issue === 'incomplete' && !editing) ? yearMessage : undefined
  const reversed = !dateIssue(draft.from) && !dateIssue(draft.to) && isReversed(draft)
  const activePreset = matchingPreset(from, to, todayISO())

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.sectionTitle}>
        {t('search.panel.datesTitle')}
      </h3>
      <div
        className={styles.dateGrid}
        onFocus={() => setEditing(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false)
        }}
      >
        <DateField
          label={t('search.panel.from')}
          value={draft.from}
          onChange={(value) => edit({ ...draft, from: value })}
          errorMessage={issueMessage(dateIssue(draft.from))}
          size="sm"
        />
        <DateField
          label={t('search.panel.to')}
          value={draft.to}
          onChange={(value) => edit({ ...draft, to: value })}
          errorMessage={reversed ? t('search.panel.rangeError') : issueMessage(dateIssue(draft.to))}
          size="sm"
        />
      </div>
      <div className={styles.presets} role="group" aria-label={t('search.panel.presets.label')}>
        {RANGE_PRESETS.map((preset) => (
          <ToggleButton
            key={preset}
            className={styles.preset}
            isSelected={activePreset === preset}
            onChange={(isSelected) => applyPreset(isSelected ? presetRange(preset, todayISO()) : { from: null, to: null })}
          >
            {t(`search.panel.presets.${preset}`)}
          </ToggleButton>
        ))}
      </div>
    </section>
  )
}
