import { IconPlus } from '@tabler/icons-react'
import { LinkButton } from '../components/Button'
import { useI18n } from '../i18n'
import styles from './NewMilestoneButton.module.css'

/**
 * Administrators' floating "Nuevo hito" button over the timeline (bottom-left on desktop; a round
 * button above the zoom control on phones). `href` opens the editor in a modal over the timeline.
 */
export function NewMilestoneButton({ href }: { href: string }) {
  const { t } = useI18n()
  const label = t('timeline.create.action')
  return (
    <LinkButton href={href} variant="primary" icon={IconPlus} aria-label={label} className={styles.create}>
      <span className={styles.text}>{label}</span>
    </LinkButton>
  )
}
