import { getLocalTimeZone, parseDate, today, type CalendarDate } from '@internationalized/date'
import { IconCalendar, IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { use, type ReactNode } from 'react'
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DatePicker,
  DatePickerStateContext,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Popover,
} from 'react-aria-components'
import { useI18n } from '../i18n'
import { isISODate } from '../utils/dates'
import styles from './DateField.module.css'
import { FieldDescription, FieldErrorMessage, FieldLabel } from './Field'
import fieldStyles from './Field.module.css'
import overlay from './Overlay.module.css'
import { cx } from './utils'

export interface DateFieldProps {
  label?: ReactNode
  /** Accessible name when there is no visible label. */
  'aria-label'?: string
  /** `YYYY-MM-DD` or null. */
  value: string | null
  onChange: (value: string | null) => void
  description?: ReactNode
  errorMessage?: ReactNode
  isRequired?: boolean
  isDisabled?: boolean
  /** Inclusive bounds, `YYYY-MM-DD`. */
  minValue?: string | null
  maxValue?: string | null
  name?: string
  autoFocus?: boolean
  size?: 'sm' | 'md'
  className?: string
}

function toCalendarDate(value: string | null | undefined): CalendarDate | null {
  return value && isISODate(value) ? parseDate(value) : null
}

function CalendarFooter({ canClear }: { canClear: boolean }) {
  const { t } = useI18n()
  const state = use(DatePickerStateContext)
  if (!state) return null
  return (
    <div className={styles.footer}>
      {canClear && state.value && (
        <AriaButton
          className={styles.footerButton}
          onPress={() => {
            state.setValue(null)
            state.close()
          }}
        >
          {t('components.dateField.clear')}
        </AriaButton>
      )}
      <AriaButton
        className={cx(styles.footerButton, styles.today)}
        onPress={() => {
          state.setValue(today(getLocalTimeZone()))
          state.close()
        }}
      >
        {t('components.dateField.today')}
      </AriaButton>
    </div>
  )
}

/** Date input (segments, locale order dd/mm/yyyy) with a calendar popover. Value is `YYYY-MM-DD`. */
export function DateField({
  label,
  'aria-label': ariaLabel,
  value,
  onChange,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  minValue,
  maxValue,
  name,
  autoFocus,
  size = 'md',
  className,
}: DateFieldProps) {
  const { t } = useI18n()
  return (
    <DatePicker
      aria-label={ariaLabel}
      value={toCalendarDate(value)}
      onChange={(date) => onChange(date ? date.toString() : null)}
      minValue={toCalendarDate(minValue) ?? undefined}
      maxValue={toCalendarDate(maxValue) ?? undefined}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isInvalid={errorMessage ? true : undefined}
      name={name}
      autoFocus={autoFocus}
      granularity="day"
      shouldForceLeadingZeros
      className={cx(fieldStyles.field, size === 'sm' && fieldStyles.sm, className)}
    >
      {label && <FieldLabel isRequired={isRequired}>{label}</FieldLabel>}
      <Group className={cx(fieldStyles.control, styles.group)}>
        <DateInput className={styles.input}>
          {(segment) => <DateSegment segment={segment} className={styles.segment} />}
        </DateInput>
        <AriaButton className={styles.trigger} aria-label={t('components.dateField.openCalendar')}>
          <IconCalendar size={18} aria-hidden="true" />
        </AriaButton>
      </Group>
      <FieldDescription>{description}</FieldDescription>
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
      <Popover className={cx(overlay.popover, styles.popover)} placement="bottom start" offset={6}>
        <Dialog className={styles.dialog}>
          <Calendar className={styles.calendar}>
            <header className={styles.header}>
              <AriaButton slot="previous" className={styles.nav} aria-label={t('components.dateField.previousMonth')}>
                <IconChevronLeft size={18} aria-hidden="true" />
              </AriaButton>
              <Heading className={styles.heading} />
              <AriaButton slot="next" className={styles.nav} aria-label={t('components.dateField.nextMonth')}>
                <IconChevronRight size={18} aria-hidden="true" />
              </AriaButton>
            </header>
            <CalendarGrid className={styles.grid} weekdayStyle="short">
              <CalendarGridHeader>
                {(day) => <CalendarHeaderCell className={styles.weekday}>{day}</CalendarHeaderCell>}
              </CalendarGridHeader>
              <CalendarGridBody>{(date) => <CalendarCell date={date} className={styles.cell} />}</CalendarGridBody>
            </CalendarGrid>
          </Calendar>
          <CalendarFooter canClear={!isRequired} />
        </Dialog>
      </Popover>
    </DatePicker>
  )
}
