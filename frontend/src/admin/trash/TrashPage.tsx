import { IconAlertTriangle, IconCalendar, IconMovie, IconPhoto, IconRestore, IconTrash, IconTrashX } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useCategories } from '../../api/queries'
import type { TrashItemOut } from '../../api/schema.gen'
import { Button, LinkButton } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { LoadingState } from '../../components/Spinner'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useI18n } from '../../i18n'
import { categoriesById, pickCategories } from '../../utils/categories'
import { mediaCount } from '../../utils/mediaCount'
import { useDocumentTitle } from '../../utils/useDocumentTitle'
import { usePurgeEvent, useRestoreEvent, useTrash } from '../events/adminEventsApi'
import { RingThumb } from '../events/RingThumb'
import styles from './TrashPage.module.css'

/** `/admin/trash`: soft-deleted events → restore or delete permanently. */
export function TrashPage() {
  const { t, formatDate } = useI18n()
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const trash = useTrash()
  const categories = useCategories()
  const restore = useRestoreEvent()
  const purge = usePurgeEvent()
  const [toPurge, setToPurge] = useState<TrashItemOut | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useDocumentTitle(t('admin.nav.trash'), t('admin.title'))

  const categoryMap = useMemo(() => categoriesById(categories.data), [categories.data])

  async function restoreItem(item: TrashItemOut) {
    try {
      await restore.mutateAsync(item.id)
      toast.show({
        tone: 'success',
        message: t('adminTrash.restored', { title: item.title }),
        action: { label: t('adminTrash.edit'), to: `/admin/events/${item.id}` },
      })
    } catch (error) {
      toast.show({ tone: 'error', message: errorMessage(error) })
    }
  }

  let content
  if (trash.isPending) {
    content = <LoadingState message={t('common.loading')} />
  } else if (trash.isError) {
    content = (
      <EmptyState
        icon={IconAlertTriangle}
        tone="error"
        title={t('adminTrash.loadError')}
        description={errorMessage(trash.error)}
        actions={
          <Button variant="primary" onPress={() => void trash.refetch()}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  } else if (trash.data.length === 0) {
    content = (
      <EmptyState
        icon={IconTrash}
        title={t('adminTrash.empty.title')}
        description={t('adminTrash.empty.description')}
        actions={
          <LinkButton href="/admin/events" variant="secondary">
            {t('adminTrash.empty.action')}
          </LinkButton>
        }
      />
    )
  } else {
    content = (
      <>
        <p className={styles.count} aria-live="polite">
          {t('adminTrash.count', { count: trash.data.length })}
        </p>
        <ul className={styles.list} aria-label={t('adminTrash.listLabel')}>
          {trash.data.map((item) => {
            const deletedAt = formatDate(item.deleted_at, 'dateTime')
            const isRestoring = restore.isPending && restore.variables === item.id
            return (
              <li key={item.id} className={styles.row}>
                <RingThumb
                  className={styles.thumb}
                  src={item.cover?.thumb_url}
                  placeholder={item.cover?.dominant_color}
                  categories={pickCategories(item.category_ids, categoryMap)}
                  size={60}
                />
                <div className={styles.main}>
                  <p className={styles.title} title={item.title}>
                    {item.title}
                  </p>
                  <p className={styles.meta}>
                    <span className={styles.metaItem}>
                      <IconCalendar size={15} aria-hidden="true" />
                      <time dateTime={item.date}>{formatDate(item.date, 'medium')}</time>
                    </span>
                    <span className={styles.metaItem}>
                      {item.video_count > 0 ? <IconMovie size={15} aria-hidden="true" /> : <IconPhoto size={15} aria-hidden="true" />}
                      {mediaCount(t, item.image_count, item.video_count)}
                    </span>
                  </p>
                  <p className={styles.deleted}>
                    <IconTrash size={15} aria-hidden="true" />
                    <span>
                      {item.deleted_by
                        ? t('adminTrash.deletedBy', { date: deletedAt, name: item.deleted_by })
                        : t('adminTrash.deletedAt', { date: deletedAt })}
                    </span>
                  </p>
                </div>
                <div className={styles.actions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={IconRestore}
                    isLoading={isRestoring}
                    isDisabled={purge.isPending && purge.variables === item.id}
                    aria-label={t('adminTrash.restoreLabel', { title: item.title })}
                    onPress={() => void restoreItem(item)}
                  >
                    {t('adminTrash.restore')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={IconTrashX}
                    className={styles.purge}
                    isDisabled={isRestoring}
                    aria-label={t('adminTrash.purgeLabel', { title: item.title })}
                    onPress={() => {
                      setToPurge(item)
                      setConfirmOpen(true)
                    }}
                  >
                    {t('adminTrash.purge')}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      </>
    )
  }

  return (
    <>
      <PageHeader icon={IconTrash} title={t('admin.nav.trash')} description={t('adminTrash.description')} />
      {content}
      <ConfirmDialog
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('adminTrash.purgeTitle')}
        confirmLabel={t('adminTrash.purgeConfirm')}
        onConfirm={async () => {
          if (!toPurge) return
          await purge.mutateAsync(toPurge.id)
          toast.show({ tone: 'success', message: t('adminTrash.purged', { title: toPurge.title }) })
        }}
      >
        {toPurge && toPurge.video_count > 0
          ? t('adminTrash.purgeMediaMessage', { count: toPurge.image_count, title: toPurge.title })
          : t('adminTrash.purgeMessage', { count: toPurge?.image_count ?? 0, title: toPurge?.title ?? '' })}
      </ConfirmDialog>
    </>
  )
}
