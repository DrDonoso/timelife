import { IconCalendarSearch, IconChevronDown, IconFilterOff } from '@tabler/icons-react'
import { useState } from 'react'
import { Button as AriaButton, Dialog, DialogTrigger, Popover } from 'react-aria-components'
import { Button } from '../../components/Button'
import fieldStyles from '../../components/Field.module.css'
import overlay from '../../components/Overlay.module.css'
import selectStyles from '../../components/Select.module.css'
import { cx } from '../../components/utils'
import { useI18n } from '../../i18n'
import { matchingPreset } from '../../search/datePresets'
import { DateRangeFilter } from '../../search/DateRangeFilter'
import { todayISO } from '../../utils/dates'
import styles from './DateRangeButton.module.css'

export interface DateRangeButtonProps {
  /** Applied inclusive bounds (`YYYY-MM-DD` or null). */
  from: string | null
  to: string | null
  onChange: (from: string | null, to: string | null) => void
  className?: string
}

/**
 * Toolbar filter showing the applied date range ("Este año", "1 ene 2025 – 31 mar 2025", "Todas las
 * fechas"); it opens the timeline's "Desde / Hasta" fields and presets in a popover.
 */
export function DateRangeButton({ from, to, onChange, className }: DateRangeButtonProps) {
  const { t, formatDate } = useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const preset = matchingPreset(from, to, todayISO())
  let summary: string
  if (preset) summary = t(`search.panel.presets.${preset}`)
  else if (from && to) summary = t('adminEvents.toolbar.dateRange', { from: formatDate(from, 'medium'), to: formatDate(to, 'medium') })
  else if (from) summary = t('adminEvents.toolbar.dateFrom', { date: formatDate(from, 'medium') })
  else if (to) summary = t('adminEvents.toolbar.dateTo', { date: formatDate(to, 'medium') })
  else summary = t('adminEvents.toolbar.allDates')
  const active = Boolean(from || to)

  return (
    <div className={cx(fieldStyles.field, className)}>
      <DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
        <AriaButton
          className={cx(fieldStyles.control, selectStyles.trigger, styles.trigger)}
          aria-label={t('adminEvents.toolbar.dates', { range: summary })}
          data-active={active || undefined}
        >
          <span className={selectStyles.value}>
            <span className={selectStyles.valueIcon}>
              <IconCalendarSearch size={18} aria-hidden="true" />
            </span>
            <span className={selectStyles.valueText}>{summary}</span>
          </span>
          <IconChevronDown size={18} aria-hidden="true" className={selectStyles.chevron} />
        </AriaButton>
        <Popover className={cx(overlay.popover, styles.popover)} placement="bottom end" offset={6}>
          <Dialog className={styles.dialog} aria-label={t('adminEvents.toolbar.datesTitle')}>
            <DateRangeFilter from={from} to={to} onChange={onChange} />
            <div className={styles.footer}>
              <Button
                variant="ghost"
                size="sm"
                icon={IconFilterOff}
                isDisabled={!active}
                onPress={() => {
                  // Done filtering: the popover closes and focus goes back to the trigger (the
                  // button disables itself, so focus would otherwise be lost).
                  onChange(null, null)
                  setIsOpen(false)
                }}
              >
                {t('adminEvents.toolbar.clearDates')}
              </Button>
            </div>
          </Dialog>
        </Popover>
      </DialogTrigger>
    </div>
  )
}
