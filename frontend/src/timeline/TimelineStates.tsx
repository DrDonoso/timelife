import { IconAlertTriangle, IconFilterOff, IconPlus, IconSparkles } from '@tabler/icons-react'
import { Button, LinkButton } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { useErrorMessage, useI18n } from '../i18n'
import styles from './TimelineStates.module.css'

/**
 * The timeline has no milestones at all (`childName`: whose; `null` for the family timeline).
 * `createHref` (administrators): where the shortcut to create the first one goes (the editor in a
 * modal over the timeline).
 */
export function TimelineEmpty({ childName, createHref }: { childName: string | null; createHref: string | null }) {
  const { t } = useI18n()
  return (
    <div className={styles.state}>
      <EmptyState
        size="lg"
        icon={IconSparkles}
        title={childName === null ? t('timeline.family.empty') : t('timeline.empty.title', { name: childName })}
        description={createHref ? t('timeline.empty.descriptionAdmin') : t('timeline.empty.descriptionViewer')}
        actions={
          createHref && (
            <LinkButton href={createHref} variant="primary" size="lg" icon={IconPlus}>
              {t('timeline.empty.action')}
            </LinkButton>
          )
        }
      />
    </div>
  )
}

/** Milestones exist but none matches the search / filters. */
export function TimelineNoResults({ onClear }: { onClear: () => void }) {
  const { t } = useI18n()
  return (
    <div className={styles.state}>
      <EmptyState
        icon={IconFilterOff}
        title={t('timeline.noResults.title')}
        description={t('timeline.noResults.description')}
        actions={
          <Button variant="primary" onPress={onClear}>
            {t('timeline.noResults.action')}
          </Button>
        }
      />
    </div>
  )
}

export function TimelineError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n()
  const errorMessage = useErrorMessage()
  return (
    <div className={styles.state}>
      <EmptyState
        tone="error"
        icon={IconAlertTriangle}
        title={t('timeline.error.title')}
        description={errorMessage(error)}
        actions={
          <Button variant="primary" onPress={onRetry}>
            {t('timeline.error.retry')}
          </Button>
        }
      />
    </div>
  )
}
