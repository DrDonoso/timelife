import { IconSearch, IconX } from '@tabler/icons-react'
import { useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Button as AriaButton,
  Input,
  ListBox,
  ListBoxItem,
  SearchField,
  type Selection,
} from 'react-aria-components'
import { CategoryIcon } from '../icons/CategoryIcon'
import { searchCategoryIcons } from '../icons/registry'
import { useI18n } from '../i18n'
import { useThemeColors } from '../theme/useThemeColors'
import { ensureContrast } from '../utils/color'
import { StaticFieldDescription, StaticFieldError, StaticFieldLabel } from './Field'
import fieldStyles from './Field.module.css'
import styles from './IconPicker.module.css'
import { cx } from './utils'

export interface IconPickerProps {
  label: ReactNode
  /** Selected registry key. */
  value: string
  onChange: (icon: string) => void
  /** Category colour used for the selected tile, adapted to the palette (default: primary). */
  color?: string
  description?: ReactNode
  errorMessage?: ReactNode
  isRequired?: boolean
  isDisabled?: boolean
  className?: string
}

function iconLabel(key: string): string {
  return key.replaceAll('-', ' ')
}

/** Searchable icon grid over the curated category icons (Spanish/English keywords). */
export function IconPicker({
  label,
  value,
  onChange,
  color,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  className,
}: IconPickerProps) {
  const { t } = useI18n()
  const { adapt } = useThemeColors()
  const id = useId()
  const labelId = `${id}-label`
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = errorMessage ? `${id}-error` : undefined
  const [query, setQuery] = useState('')
  const keys = useMemo(() => searchCategoryIcons(query), [query])
  const items = useMemo(() => keys.map((key) => ({ id: key })), [keys])
  const selectedBg = color ? ensureContrast(adapt(color)) : undefined

  return (
    <div
      className={cx(fieldStyles.field, styles.picker, className)}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
      data-invalid={errorMessage ? true : undefined}
      style={selectedBg ? ({ '--icon-selected-bg': selectedBg } as CSSProperties) : undefined}
    >
      <StaticFieldLabel id={labelId} isRequired={isRequired}>
        {label}
      </StaticFieldLabel>
      <div className={styles.panel}>
        <SearchField
          value={query}
          onChange={setQuery}
          aria-label={t('components.iconPicker.search')}
          isDisabled={isDisabled}
          className={styles.search}
        >
          <IconSearch size={18} aria-hidden="true" className={styles.searchIcon} />
          <Input className={styles.searchInput} placeholder={t('components.iconPicker.search')} />
          {query && (
            <AriaButton className={styles.clear} aria-label={t('common.clear')}>
              <IconX size={16} aria-hidden="true" />
            </AriaButton>
          )}
        </SearchField>
        <ListBox
          aria-labelledby={labelId}
          layout="grid"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={value ? [value] : []}
          onSelectionChange={(selection: Selection) => {
            if (selection === 'all') return
            const [next] = selection
            if (next !== undefined) onChange(String(next))
          }}
          items={items}
          className={styles.grid}
          renderEmptyState={() => (
            <p className={styles.empty}>{t('components.iconPicker.noResults', { query: query.trim() })}</p>
          )}
        >
          {(item) => (
            <ListBoxItem
              id={item.id}
              textValue={iconLabel(item.id)}
              aria-label={iconLabel(item.id)}
              isDisabled={isDisabled}
              className={styles.option}
            >
              <CategoryIcon icon={item.id} size={22} stroke={1.8} />
            </ListBoxItem>
          )}
        </ListBox>
        <p className={styles.count} aria-live="polite">
          {t('components.iconPicker.results', { count: keys.length })}
        </p>
      </div>
      <StaticFieldDescription id={descriptionId}>{description}</StaticFieldDescription>
      <StaticFieldError id={errorId}>{errorMessage}</StaticFieldError>
    </div>
  )
}
