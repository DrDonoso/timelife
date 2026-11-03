import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle, IconCake, IconMoodKid, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { api } from '../../api/client'
import { qk, useChildren } from '../../api/queries'
import type { ChildOut } from '../../api/schema.gen'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { IconButton } from '../../components/IconButton'
import { PageHeader } from '../../components/PageHeader'
import { LoadingState } from '../../components/Spinner'
import { useToast } from '../../contexts/ToastContext'
import { useErrorMessage, useI18n } from '../../i18n'
import { useDocumentTitle } from '../../utils/useDocumentTitle'
import { useIsMobile } from '../../utils/useMediaQuery'
import { DragHandle, MoveButtons, OrderStatusText, SortableList } from '../categories/SortableList'
import { useOrderSaver } from '../categories/useOrderSaver'
import { childAge } from './age'
import { ChildFormModal } from './ChildFormModal'
import styles from './ChildrenPage.module.css'

interface FormTarget {
  /** Remounts the form (fresh state) every time it opens. */
  key: number
  child: ChildOut | null
}

function BirthLine({ child }: { child: ChildOut }) {
  const { t, formatDate } = useI18n()
  if (!child.birth_date) return <p className={styles.birth}>{t('adminChildren.card.noBirthDate')}</p>
  const age = childAge(child.birth_date)
  return (
    <p className={styles.birth}>
      <IconCake size={16} stroke={1.9} aria-hidden="true" className={styles.birthIcon} />
      <span>
        {t('adminChildren.card.born', { date: formatDate(child.birth_date, 'medium') })}
        {age && (
          <span className={styles.age}>
            {' · '}
            {age.unit === 'months'
              ? t('adminChildren.card.ageMonths', { count: age.count })
              : t('adminChildren.card.ageYears', { count: age.count })}
          </span>
        )}
      </span>
    </p>
  )
}

export function ChildrenPage() {
  const { t } = useI18n()
  useDocumentTitle(t('admin.nav.children'), t('admin.title'))
  const queryClient = useQueryClient()
  const { show } = useToast()
  const errorMessage = useErrorMessage()
  const isMobile = useIsMobile()
  const children = useChildren()
  const list = children.data ?? []
  const { reorder, status } = useOrderSaver<ChildOut>({ queryKey: qk.children, path: '/api/admin/children/order' })

  const [form, setForm] = useState<FormTarget | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [deleting, setDeleting] = useState<ChildOut | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const remove = useMutation({
    mutationFn: (child: ChildOut) => api.del(`/api/admin/children/${child.id}`),
    onSuccess: async (_, child) => {
      queryClient.setQueryData<ChildOut[]>(qk.children, (current) => current?.filter((item) => item.id !== child.id))
      show({ tone: 'success', message: t('adminChildren.toast.deleted', { name: child.name }) })
      await queryClient.invalidateQueries({ queryKey: qk.children })
    },
  })

  function openForm(child: ChildOut | null) {
    setForm((current) => ({ key: (current?.key ?? 0) + 1, child }))
    setFormOpen(true)
  }

  function askDelete(child: ChildOut) {
    setDeleting(child)
    setDeleteOpen(true)
  }

  const createButton = (
    <Button variant="primary" icon={IconPlus} onPress={() => openForm(null)}>
      {t('adminChildren.new')}
    </Button>
  )

  let content
  if (children.isPending) {
    content = <LoadingState message={t('common.loading')} />
  } else if (children.isError) {
    content = (
      <EmptyState
        tone="error"
        icon={IconAlertTriangle}
        title={t('adminChildren.loadError')}
        description={errorMessage(children.error)}
        actions={<Button onPress={() => void children.refetch()}>{t('common.retry')}</Button>}
      />
    )
  } else if (list.length === 0) {
    content = (
      <EmptyState
        icon={IconMoodKid}
        title={t('adminChildren.empty.title')}
        description={t('adminChildren.empty.description')}
        actions={createButton}
      />
    )
  } else {
    content = (
      <section aria-labelledby="children-list-heading">
        <header className={styles.listHeader}>
          <h2 id="children-list-heading" className={styles.listTitle}>
            {t('adminChildren.count', { count: list.length })}
          </h2>
          {list.length > 1 && <p className={styles.listHint}>{t('adminChildren.reorder.hint')}</p>}
          <OrderStatusText
            status={status}
            savingLabel={t('adminChildren.reorder.saving')}
            savedLabel={t('adminChildren.reorder.saved')}
            className={styles.listStatus}
          />
        </header>
        <SortableList
          aria-label={t('adminChildren.listLabel')}
          layout="grid"
          items={list}
          textValue={(child) => child.name}
          onReorder={reorder}
          onAction={(child) => openForm(child)}
          describeMove={(child, position, total) => t('adminChildren.reorder.moved', { name: child.name, position, total })}
          itemClassName={styles.item}
        >
          {(child, controls) => (
            <div className={styles.card}>
              <span className={styles.cardHandle}>
                <DragHandle label={t('adminChildren.card.drag', { name: child.name })} />
              </span>
              <span className={styles.cardActions}>
                <IconButton
                  size="sm"
                  icon={IconPencil}
                  label={t('adminChildren.card.edit', { name: child.name })}
                  onPress={() => openForm(child)}
                />
                <IconButton
                  size="sm"
                  variant="danger"
                  icon={IconTrash}
                  label={t('adminChildren.card.delete', { name: child.name })}
                  onPress={() => askDelete(child)}
                />
              </span>
              <Avatar
                name={child.name}
                image={child.avatar}
                size={isMobile ? 64 : 88}
                decorative
                className={styles.avatar}
              />
              <div className={styles.info}>
                <h3 className={styles.name}>{child.name}</h3>
                <BirthLine child={child} />
              </div>
              {list.length > 1 && (
                <MoveButtons
                  controls={controls}
                  orientation={isMobile ? 'vertical' : 'horizontal'}
                  earlierLabel={t('adminChildren.card.moveEarlier', { name: child.name })}
                  laterLabel={t('adminChildren.card.moveLater', { name: child.name })}
                  className={styles.move}
                />
              )}
            </div>
          )}
        </SortableList>
      </section>
    )
  }

  return (
    <>
      <PageHeader
        icon={IconMoodKid}
        title={t('admin.nav.children')}
        description={t('adminChildren.description')}
        actions={list.length > 0 ? createButton : undefined}
      />
      {content}
      {form && <ChildFormModal key={form.key} isOpen={formOpen} onOpenChange={setFormOpen} child={form.child} />}
      <ConfirmDialog
        isOpen={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('adminChildren.delete.title', { name: deleting?.name ?? '' })}
        confirmLabel={t('adminChildren.delete.confirm')}
        onConfirm={() => (deleting ? remove.mutateAsync(deleting) : undefined)}
      >
        {t('adminChildren.delete.message')}
      </ConfirmDialog>
    </>
  )
}
