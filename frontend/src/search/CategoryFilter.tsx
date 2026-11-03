import { IconCheck } from '@tabler/icons-react'
import { AnimatePresence, motion } from 'motion/react'
import { useId, useMemo, type CSSProperties } from 'react'
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components'
import { useCategories } from '../api/queries'
import type { CategoryOut } from '../api/schema.gen'
import { Button } from '../components/Button'
import { Spinner } from '../components/Spinner'
import { CategoryIcon } from '../icons/CategoryIcon'
import { useI18n } from '../i18n'
import { useThemeColors } from '../theme/useThemeColors'
import { categoryName } from '../utils/categories'
import { ensureContrast } from '../utils/color'
import styles from './FilterPanel.module.css'

function CategoryChip({ category }: { category: CategoryOut }) {
  const { lang } = useI18n()
  const { adapt } = useThemeColors()
  // Adapted to the palette, then deepened so white text/icons keep 4.5:1 on the filled (selected) chip.
  const color = useMemo(() => ensureContrast(adapt(category.color)), [adapt, category.color])
  return (
    <ToggleButton id={category.id} className={styles.chip} style={{ '--chip-color': color } as CSSProperties}>
      {({ isSelected }) => (
        <>
          <span className={styles.chipIcon} aria-hidden="true">
            <CategoryIcon icon={category.icon} size={15} stroke={2.2} />
          </span>
          <span className={styles.chipLabel}>{categoryName(category, lang)}</span>
          <AnimatePresence initial={false}>
            {isSelected && (
              <motion.span
                key="check"
                className={styles.chipCheck}
                initial={{ width: 0, opacity: 0, scale: 0.4 }}
                animate={{ width: 'auto', opacity: 1, scale: 1 }}
                exit={{ width: 0, opacity: 0, scale: 0.4 }}
                transition={{ type: 'spring', stiffness: 520, damping: 32 }}
              >
                <IconCheck size={14} stroke={3} aria-hidden="true" />
              </motion.span>
            )}
          </AnimatePresence>
        </>
      )}
    </ToggleButton>
  )
}

export interface CategoryFilterProps {
  selected: readonly number[]
  onChange: (ids: number[]) => void
}

/** Category toggle chips (any of them matches), in the admin order. */
export function CategoryFilter({ selected, onChange }: CategoryFilterProps) {
  const { t } = useI18n()
  const headingId = useId()
  const categories = useCategories()

  let content
  if (categories.data) {
    content =
      categories.data.length === 0 ? (
        <p className={styles.note}>{t('search.panel.categoriesEmpty')}</p>
      ) : (
        <ToggleButtonGroup
          aria-labelledby={headingId}
          selectionMode="multiple"
          selectedKeys={selected}
          onSelectionChange={(keys) => onChange([...keys].map(Number))}
          className={styles.chips}
        >
          {categories.data.map((category) => (
            <CategoryChip key={category.id} category={category} />
          ))}
        </ToggleButtonGroup>
      )
  } else if (categories.isError) {
    content = (
      <div className={styles.note} role="alert">
        <span>{t('search.panel.categoriesError')}</span>
        <Button variant="ghost" size="sm" onPress={() => void categories.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  } else {
    content = (
      <div className={styles.note}>
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.sectionTitle}>
        {t('search.panel.categoriesTitle')}
      </h3>
      {content}
    </section>
  )
}
