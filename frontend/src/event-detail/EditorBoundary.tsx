import { IconAlertTriangle } from '@tabler/icons-react'
import { Component, type ReactNode } from 'react'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { useI18n } from '../i18n'

function EditorFailure({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  return (
    <EmptyState
      icon={IconAlertTriangle}
      tone="error"
      headingLevel={3}
      title={t('detail.editorError.title')}
      description={t('detail.editorError.description')}
      actions={
        <>
          <Button variant="primary" onPress={() => window.location.reload()}>
            {t('common.reload')}
          </Button>
          <Button onPress={onBack}>{t('detail.editorError.back')}</Button>
        </>
      }
    />
  )
}

interface EditorBoundaryProps {
  children: ReactNode
  /** Returns to the card. */
  onBack: () => void
}

/**
 * Keeps a failure of the lazily loaded editor (chunk download after a deploy or offline, or a
 * render error) inside the modal instead of replacing the whole page.
 */
export class EditorBoundary extends Component<EditorBoundaryProps, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    console.error('Timelife: the event editor failed to load', error)
  }

  override render() {
    return this.state.failed ? <EditorFailure onBack={this.props.onBack} /> : this.props.children
  }
}
