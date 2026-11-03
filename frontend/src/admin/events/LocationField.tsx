import { IconMapPin } from '@tabler/icons-react'
import { useMemo, type ReactNode } from 'react'
import { ComboBox, Group, Input, ListBox, ListBoxItem, Popover, Text } from 'react-aria-components'
import type { LocationOut } from '../../api/schema.gen'
import { FieldErrorMessage, FieldLabel } from '../../components/Field'
import fieldStyles from '../../components/Field.module.css'
import overlay from '../../components/Overlay.module.css'
import { cx, renderIcon } from '../../components/utils'
import { useI18n } from '../../i18n'
import styles from './LocationField.module.css'
import { suggestLocations } from './locations'

export interface LocationFieldProps {
  label: ReactNode
  placeholder?: string
  value: string
  onChange: (value: string) => void
  /** Places of the milestones, the most used first (`GET /api/admin/locations`). */
  places: readonly LocationOut[]
  maxLength?: number
  errorMessage?: ReactNode
}

/**
 * Free-text location with suggestions: while typing, the places other milestones already use whose
 * words contain what is typed (accents and case ignored), the most used first with their number of
 * milestones. Any text is still accepted.
 */
export function LocationField({ label, placeholder, value, onChange, places, maxLength, errorMessage }: LocationFieldProps) {
  const { t } = useI18n()
  const suggestions = useMemo(() => suggestLocations(places, value), [places, value])
  return (
    <ComboBox
      className={fieldStyles.field}
      items={suggestions}
      inputValue={value}
      onInputChange={onChange}
      allowsCustomValue
      menuTrigger="input"
      isInvalid={Boolean(errorMessage)}
    >
      <FieldLabel>{label}</FieldLabel>
      <Group className={fieldStyles.control}>
        <span className={fieldStyles.leadingIcon}>{renderIcon(IconMapPin, 18)}</span>
        <Input className={fieldStyles.input} placeholder={placeholder} maxLength={maxLength} />
      </Group>
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
      <Popover className={overlay.popover} offset={6} placement="bottom start">
        <ListBox<LocationOut> className={overlay.list} aria-label={t('adminEvents.editor.fields.locationSuggestions')}>
          {(place) => (
            <ListBoxItem id={place.name} textValue={place.name} className={cx(overlay.option, styles.option)}>
              <span className={styles.icon}>{renderIcon(IconMapPin, 16)}</span>
              <Text slot="label" className={styles.name}>
                {place.name}
              </Text>
              <Text slot="description" className={styles.count}>
                {t('common.milestones', { count: place.count })}
              </Text>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  )
}
