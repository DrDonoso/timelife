import { IconAdjustmentsHorizontal } from '@tabler/icons-react'
import { motion } from 'motion/react'
import { IconButton } from '../components/IconButton'
import { cx } from '../components/utils'
import { useI18n } from '../i18n'
import { useFilterPanel } from './FilterPanelContext'
import styles from './FilterToggleButton.module.css'
import { useTimelineFilters } from './useTimelineFilters'

/** Header button that opens/closes the filter panel; the badge counts the active filters. */
export function FilterToggleButton() {
  const { t, formatNumber } = useI18n()
  const { isOpen, toggle, panelId, triggerRef } = useFilterPanel()
  const { activeCount } = useTimelineFilters()
  const label = activeCount ? t('search.toggle.active', { count: activeCount }) : t('search.toggle.label')
  return (
    <IconButton
      ref={triggerRef}
      label={label}
      icon={IconAdjustmentsHorizontal}
      className={cx(styles.toggle, activeCount > 0 && styles.active)}
      badge={
        activeCount > 0 ? (
          <motion.span
            key={activeCount}
            className={styles.count}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 600, damping: 22 }}
          >
            {activeCount > 9 ? '9+' : formatNumber(activeCount)}
          </motion.span>
        ) : undefined
      }
      aria-expanded={isOpen}
      aria-controls={isOpen ? panelId : undefined}
      onPress={toggle}
    />
  )
}
