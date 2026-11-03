import { IconCalendarPlus, IconChevronDown, IconPlus } from '@tabler/icons-react'
import { useMemo, useState, type CSSProperties, type FormEvent, type Ref } from 'react'
import { Button as AriaButton, ComboBox, Form, Group, Input, ListBox, ListBoxItem, Popover } from 'react-aria-components'
import { Button } from '../../components/Button'
import { FieldErrorMessage, FieldLabel } from '../../components/Field'
import fieldStyles from '../../components/Field.module.css'
import overlay from '../../components/Overlay.module.css'
import { cx, renderIcon } from '../../components/utils'
import { useI18n } from '../../i18n'
import { useThemeColors } from '../../theme/useThemeColors'
import styles from './AppearancePage.module.css'

export const MIN_YEAR = 1900
export const MAX_YEAR = 2200

interface Suggestion {
  id: number
}

export interface YearPickerProps {
  /** Years with milestones that still use their automatic colour, newest first. */
  suggestions: readonly number[]
  /** Years with their own colour. */
  custom: ReadonlySet<number>
  /** Years already being added (unsaved cards). */
  pending: ReadonlySet<number>
  onAdd: (year: number) => void
  inputRef?: Ref<HTMLInputElement>
}

/**
 * «Añadir año»: a numeric combo box suggesting the years with milestones that still use their
 * automatic colour (with a dot of it); any other year between MIN_YEAR and MAX_YEAR can be typed.
 * Picking a suggestion adds it at once; a typed year is added with «Añadir» (or Enter).
 */
export function YearPicker({ suggestions, custom, pending, onAdd, inputRef }: YearPickerProps) {
  const { t } = useI18n()
  const { autoYear } = useThemeColors()
  const [text, setText] = useState('')
  /** Opened with the button or the arrow keys: every suggestion, whatever is typed. */
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [placeholder] = useState(() => String(new Date().getFullYear() + 1))

  // While typing, the suggestions that start with the digits (a complete year needs no completion,
  // so Enter adds it straight away).
  const items = useMemo<Suggestion[]>(
    () =>
      suggestions
        .filter((year) => showAll || (String(year).startsWith(text) && String(year) !== text))
        .map((year) => ({ id: year })),
    [suggestions, text, showAll],
  )

  function add(year: number) {
    if (custom.has(year)) {
      setError(t('adminAppearance.years.addHasColor', { year }))
      return
    }
    if (pending.has(year)) {
      setError(t('adminAppearance.years.addPending', { year }))
      return
    }
    setError(null)
    setText('')
    setShowAll(false)
    onAdd(year)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const year = Number(text)
    if (!/^\d{4}$/.test(text) || year < MIN_YEAR || year > MAX_YEAR) {
      setError(t('adminAppearance.years.addInvalid', { min: MIN_YEAR, max: MAX_YEAR }))
      return
    }
    add(year)
  }

  return (
    <Form className={styles.addYear} validationBehavior="aria" onSubmit={submit}>
      <ComboBox
        className={cx(fieldStyles.field, styles.addYearField)}
        items={items}
        value={null}
        onChange={(key) => {
          if (key !== null) add(Number(key))
        }}
        inputValue={text}
        onInputChange={(next) => {
          setText(next.replace(/\D/g, '').slice(0, 4))
          setShowAll(false)
          setError(null)
        }}
        onOpenChange={(isOpen, trigger) => setShowAll(isOpen && trigger === 'manual')}
        allowsCustomValue
        isInvalid={Boolean(error)}
      >
        <FieldLabel>{t('adminAppearance.years.addLabel')}</FieldLabel>
        <Group className={fieldStyles.control}>
          <span className={fieldStyles.leadingIcon}>{renderIcon(IconCalendarPlus, 18)}</span>
          <Input ref={inputRef} className={fieldStyles.input} placeholder={placeholder} inputMode="numeric" maxLength={4} />
          {suggestions.length > 0 && (
            <AriaButton className={styles.comboButton}>
              <IconChevronDown size={18} aria-hidden="true" className={styles.comboChevron} />
            </AriaButton>
          )}
        </Group>
        <FieldErrorMessage>{error}</FieldErrorMessage>
        <Popover className={overlay.popover} offset={6} placement="bottom start">
          <ListBox<Suggestion> className={overlay.list} aria-label={t('adminAppearance.years.suggestions')}>
            {(item) => (
              <ListBoxItem id={item.id} textValue={String(item.id)} className={cx(overlay.option, styles.yearOption)}>
                <span className={styles.yearDot} style={{ '--dot': autoYear(item.id) } as CSSProperties} aria-hidden="true" />
                {item.id}
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </ComboBox>
      <Button type="submit" icon={IconPlus} className={styles.addYearButton}>
        {t('adminAppearance.years.add')}
      </Button>
    </Form>
  )
}
